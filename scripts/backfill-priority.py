#!/usr/bin/env python3
"""기존 리포트의 todos / backlogs 항목에 priority 필드를 사후 부여.

각 리포트별로 Claude (Opus) 를 1 회 호출해 항목 순서대로 P0~P3 (critical /
high / medium / low) 를 분류받는다. 본문 재생성 없이 frontmatter 만 갱신.

사용:
    python3 scripts/backfill-priority.py [--dry-run] [--only PATTERN] [path ...]

--dry-run: Claude 호출 + 응답 파싱까지만, 파일 쓰기 안 함.
--only PATTERN: glob 으로 일부 리포트만 (예: `--only 'reports/HANPAN*'`).
path 미지정 + --only 없음: reports/*/*.md 전부.

이미 모든 todo/backlog 에 priority 가 있는 리포트는 자동 skip.
resolved_from_backlog 항목은 건드리지 않는다 (priority 금지 룰).
"""
from __future__ import annotations

import argparse
import glob
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml


CLAUDE_BIN = "claude"
MODEL = "claude-opus-4-7"
PRIORITIES = {"critical", "high", "medium", "low"}


# ─── YAML emit (migrate-items-to-object.py 와 동일 스타일) ──────────────

class _QStr(str):
    pass


class _IndentDumper(yaml.SafeDumper):
    def increase_indent(self, flow=False, indentless=False):  # type: ignore[override]
        return super().increase_indent(flow, False)


def _repr_qstr(dumper: yaml.Dumper, data: _QStr) -> Any:
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style='"')


_IndentDumper.add_representer(_QStr, _repr_qstr)


def _wrap(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _wrap(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_wrap(x) for x in obj]
    if isinstance(obj, str):
        return _QStr(obj)
    return obj


def dump_field_yaml(field: str, value: Any) -> str:
    block = yaml.dump(
        {field: _wrap(value)},
        Dumper=_IndentDumper,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
        width=10000,
    )
    return block.rstrip("\n")


def _field_block_re(field: str) -> re.Pattern[str]:
    return re.compile(
        rf"(^{field}:.*?)(?=\n[A-Za-z_][A-Za-z0-9_]*:|\Z)",
        re.MULTILINE | re.DOTALL,
    )


def replace_field(fm_text: str, field: str, new_value: Any) -> tuple[str, bool]:
    new_block = dump_field_yaml(field, new_value)
    pat = _field_block_re(field)
    m = pat.search(fm_text)
    if not m:
        return fm_text, False
    if m.group(1).strip() == new_block.strip():
        return fm_text, False
    return fm_text[: m.start()] + new_block + fm_text[m.end():], True


# ─── prompt 빌드 ───────────────────────────────────────────────────────

PROMPT_TEMPLATE = """역할: Unity 게임 프로젝트 코드리뷰 결과의 todo / backlog 항목에 P0~P3 우선순위를 사후 부여.

# 우선순위 기준 (Critical 남용 주의 — 학습용 게임 프로젝트라 진짜 P0 는 매우 드뭄)
- critical (P0): 서비스 장애, 데이터 손실, 보안 이슈 등 **즉시** 처리 필요
- high (P1): 주요 기능 영향, 이번 스프린트 내 처리
- medium (P2): 중요하지만 급하지 않음, 다음 스프린트 후보
- low (P3): 개선 사항, 여유 있을 때

대다수 항목은 high 또는 medium 입니다. 한 리포트에 critical 이 2 개 이상이면 정말 그 정도인지 다시 점검하세요.

# 컨텍스트
- 프로젝트: {project}
- 리포트 일자: {date}
- 전체 risk_level: {risk_level}
- summary: {summary}

# 분류 대상 항목 (입력 순서 유지)

## todos ({n_todos}개)
{todos_block}

## backlogs ({n_backlogs}개)
{backlogs_block}

# 출력 형식 (반드시 아래 두 줄만 — 머리말 / 설명 / 코드펜스 모두 금지)
todos: [v1, v2, ...]      # 입력 순서대로 정확히 {n_todos} 개. 값은 critical / high / medium / low 중 하나.
backlogs: [v1, v2, ...]   # 입력 순서대로 정확히 {n_backlogs} 개. 동일 enum.
"""


def _format_item_lines(items: list[Any]) -> str:
    if not items:
        return "(없음)"
    lines = []
    for i, it in enumerate(items, 1):
        if isinstance(it, str):
            title, files, details = it, [], None
        elif isinstance(it, dict):
            title = it.get("title", "")
            files = it.get("files", []) or []
            details = it.get("details")
        else:
            title, files, details = str(it), [], None
        lines.append(f"{i}. {title}")
        if files:
            files_str = ", ".join(files[:4])
            lines.append(f"   files: {files_str}")
        if details:
            lines.append(f"   details: {details}")
    return "\n".join(lines)


def build_prompt(fm: dict, todos: list[Any], backlogs: list[Any]) -> str:
    return PROMPT_TEMPLATE.format(
        project=fm.get("project", "(unknown)"),
        date=fm.get("date", "(unknown)"),
        risk_level=fm.get("risk_level", "(unknown)"),
        summary=fm.get("summary", "(none)"),
        n_todos=len(todos),
        n_backlogs=len(backlogs),
        todos_block=_format_item_lines(todos),
        backlogs_block=_format_item_lines(backlogs),
    )


# ─── claude 호출 + 응답 파싱 ───────────────────────────────────────────

def call_claude(prompt: str) -> str:
    proc = subprocess.run(
        [CLAUDE_BIN, "-p", "--output-format", "text", "--model", MODEL],
        input=prompt,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"claude CLI exit {proc.returncode}\nstderr:\n{proc.stderr}"
        )
    return proc.stdout


def parse_response(text: str, n_todos: int, n_backlogs: int) -> tuple[list[str], list[str]]:
    # 코드펜스가 섞여 들어오는 경우 제거.
    cleaned = re.sub(r"```[a-zA-Z]*\n?", "", text).replace("```", "").strip()
    # 'todos:' 와 'backlogs:' 두 줄만 남기도록 행 단위 필터.
    lines = []
    for ln in cleaned.splitlines():
        s = ln.strip()
        if s.startswith("todos:") or s.startswith("backlogs:"):
            lines.append(s)
    if not lines:
        raise ValueError(f"todos/backlogs 라인 없음. 원문:\n{text!r}")
    parsed = yaml.safe_load("\n".join(lines))
    if not isinstance(parsed, dict):
        raise ValueError(f"YAML 객체 아님: {parsed!r}")

    todos = parsed.get("todos", []) if n_todos > 0 else []
    backlogs = parsed.get("backlogs", []) if n_backlogs > 0 else []

    if not isinstance(todos, list) or not isinstance(backlogs, list):
        raise ValueError(f"배열 아님. todos={todos!r} backlogs={backlogs!r}")
    if len(todos) != n_todos:
        raise ValueError(f"todos 길이 mismatch: 기대 {n_todos}, 받음 {len(todos)}")
    if len(backlogs) != n_backlogs:
        raise ValueError(f"backlogs 길이 mismatch: 기대 {n_backlogs}, 받음 {len(backlogs)}")

    for arr_name, arr in (("todos", todos), ("backlogs", backlogs)):
        for i, v in enumerate(arr):
            if v not in PRIORITIES:
                raise ValueError(
                    f"{arr_name}[{i}] 값 오류: {v!r} (허용: {sorted(PRIORITIES)})"
                )

    return todos, backlogs


# ─── 항목에 priority 주입 ──────────────────────────────────────────────

def inject_priority(items: list[Any], priorities: list[str]) -> list[dict]:
    """기존 item 리스트의 각 원소에 priority 부여. 객체로 정규화 후 반환."""
    out: list[dict] = []
    for orig, prio in zip(items, priorities):
        if isinstance(orig, str):
            obj: dict[str, Any] = {"title": orig, "priority": prio}
        elif isinstance(orig, dict):
            obj = dict(orig)
            obj["priority"] = prio
            # 키 순서 정리: title → priority → files → details
            order = ["title", "priority", "files", "details"]
            obj = {k: obj[k] for k in order if k in obj} | {
                k: v for k, v in obj.items() if k not in order
            }
        else:
            obj = {"title": str(orig), "priority": prio}
        out.append(obj)
    return out


# ─── 한 리포트 처리 ────────────────────────────────────────────────────

FRONTMATTER_RE = re.compile(r"^(\s*---\n)(.*?)(\n---\n)(.*)", re.DOTALL)


def needs_backfill(items: list[Any]) -> bool:
    """priority 가 빠진 항목이 하나라도 있으면 True."""
    if not items:
        return False
    for it in items:
        if isinstance(it, str):
            return True
        if isinstance(it, dict) and "priority" not in it:
            return True
    return False


def process_one(path: Path, dry_run: bool) -> tuple[str, str]:
    """반환: (status, message). status ∈ {ok, skip, error, dry}."""
    raw = path.read_text(encoding="utf-8")
    m = FRONTMATTER_RE.match(raw)
    if not m:
        return "error", "frontmatter 없음"

    open_fence, fm_raw, close_fence, body = m.groups()
    try:
        fm = yaml.safe_load(fm_raw) or {}
    except yaml.YAMLError as e:
        return "error", f"frontmatter parse: {e}"
    if not isinstance(fm, dict):
        return "error", "frontmatter 가 dict 아님"

    todos = fm.get("todos") or []
    backlogs = fm.get("backlogs") or []
    if not isinstance(todos, list) or not isinstance(backlogs, list):
        return "error", "todos / backlogs 가 배열 아님"

    if not (needs_backfill(todos) or needs_backfill(backlogs)):
        return "skip", "이미 모든 항목에 priority 있음"

    prompt = build_prompt(fm, todos, backlogs)
    try:
        resp = call_claude(prompt)
    except Exception as e:
        return "error", f"claude 호출 실패: {e}"

    try:
        todo_prios, backlog_prios = parse_response(resp, len(todos), len(backlogs))
    except Exception as e:
        return "error", f"응답 파싱 실패: {e}\n응답 앞부분:\n{resp[:500]}"

    new_todos = inject_priority(todos, todo_prios) if todos else todos
    new_backlogs = inject_priority(backlogs, backlog_prios) if backlogs else backlogs

    new_fm_text = fm_raw
    changed_any = False
    for field, value in (("todos", new_todos), ("backlogs", new_backlogs)):
        if not value:
            continue
        new_fm_text, ch = replace_field(new_fm_text, field, value)
        changed_any = changed_any or ch

    if not changed_any:
        return "skip", "frontmatter 변경 없음 (대상 필드 부재?)"

    if dry_run:
        return "dry", f"todos: {todo_prios}, backlogs: {backlog_prios}"

    new_content = open_fence + new_fm_text + close_fence + body
    path.write_text(new_content, encoding="utf-8", newline="\n")
    return "ok", f"todos: {todo_prios}, backlogs: {backlog_prios}"


# ─── main ──────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default=None, help="glob 패턴")
    args = ap.parse_args()

    if args.paths:
        paths = [Path(p) for p in args.paths]
    elif args.only:
        paths = [Path(p) for p in glob.glob(args.only)]
    else:
        paths = [
            Path(p) for p in sorted(glob.glob("reports/*/*.md"))
            if not p.endswith(".meta.json")
        ]

    if not paths:
        print("[backfill-priority] 처리할 파일 없음", file=sys.stderr)
        return 1

    counts = {"ok": 0, "skip": 0, "error": 0, "dry": 0}
    for p in paths:
        print(f"\n=== {p} ===")
        status, msg = process_one(p, args.dry_run)
        counts[status] = counts.get(status, 0) + 1
        prefix = {"ok": "OK ", "skip": "SKIP", "error": "ERR", "dry": "DRY"}[status]
        print(f"  [{prefix}] {msg}")

    print(
        f"\n=== 합계 ===\n"
        f"  ok={counts['ok']}  skip={counts['skip']}  "
        f"dry={counts['dry']}  error={counts['error']}  total={len(paths)}"
    )
    return 0 if counts["error"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
