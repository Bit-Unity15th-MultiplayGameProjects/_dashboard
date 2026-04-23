#!/usr/bin/env python3
"""기존 리포트의 todos / backlogs / resolved_from_backlog 항목을
신규 객체 형식 (`{title, files?}`) 으로 일괄 변환.

string 항목에서 파일 경로를 휴리스틱으로 추출:
  1. 확장자가 있는 파일명 (cs/md/json/unity/prefab/asset/asmdef 등)
  2. 알려진 디렉토리 prefix (Assets, docs, documents, Packages,
     ProjectSettings, TutorialInfo, Resources) + 하위 경로
  3. 알려진 디렉토리만 단독 (`Assets/`, `TutorialInfo/`)

추출된 파일이 없으면 `files` 키 자체를 생략 (선택 필드).
이미 객체 형식인 항목은 그대로 둔다.

사용:
    python3 scripts/migrate-items-to-object.py [--dry-run] [path ...]

path 미지정 시 reports/*/*.md 전부.
"""
from __future__ import annotations

import argparse
import glob
import re
import sys
from typing import Any

import yaml


EXT = r"cs|md|yml|yaml|json|asset|unity|prefab|cginc|hlsl|shader|inputactions|asmdef|txt|csv|tsx|ts|html"
KNOWN_DIRS = (
    r"Assets|docs|documents|Packages|ProjectSettings|"
    r"TutorialInfo|Resources|src|scripts|reports"
)

PATTERNS = [
    # 확장자 있는 파일명 (한글/라틴/숫자/._/-).
    re.compile(
        rf"(?<![A-Za-z0-9_./-])"
        rf"([A-Za-z0-9_./가-힣-]+\.(?:{EXT}))"
        rf"(?![A-Za-z0-9_-])"
    ),
    # 알려진 디렉토리 + 하위 경로.
    re.compile(
        rf"(?<![A-Za-z0-9_./-])"
        rf"((?:{KNOWN_DIRS})/[A-Za-z0-9_./가-힣-]+/?)"
        rf"(?![A-Za-z0-9_-])"
    ),
    # 알려진 디렉토리 단독 (`Assets/` 같은).
    re.compile(
        rf"(?<![A-Za-z0-9_./-])"
        rf"((?:{KNOWN_DIRS})/)"
        rf"(?![A-Za-z0-9_./가-힣-])"
    ),
]


def _is_placeholder(path: str) -> bool:
    """`X.md`, `Y.cs` 같은 단일 대문자 stem 은 예시 placeholder 로 본다."""
    base = path.rsplit("/", 1)[-1]
    if "." not in base:
        return False
    stem = base.rsplit(".", 1)[0]
    return len(stem) == 1 and stem.isalpha() and stem.isupper()


def extract_files(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for pat in PATTERNS:
        for m in pat.finditer(text):
            f = m.group(1)
            if f in seen or _is_placeholder(f):
                continue
            seen.add(f)
            out.append(f)
    return out


# ─── YAML emit (기존 스타일 — 문자열은 ", 시퀀스 dash 들여쓰기) ─────────

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


# ─── frontmatter 내 특정 필드만 in-place 교체 ───────────────────────────

def _field_block_re(field: str) -> re.Pattern[str]:
    """frontmatter 안에서 `^{field}:` 로 시작해 다음 top-level key 직전까지의
    블록을 매칭. 빈 배열 (`field: []`) 은 한 줄로 끝나므로 lookahead 만 다름.
    """
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


# ─── 항목 변환 ──────────────────────────────────────────────────────────

def to_object_form(item: Any) -> dict[str, Any]:
    """단일 항목 변환. string → {title, files?}. 객체는 그대로."""
    if isinstance(item, str):
        files = extract_files(item)
        obj: dict[str, Any] = {"title": item}
        if files:
            obj["files"] = files
        return obj
    if isinstance(item, dict):
        return item
    raise TypeError(f"unexpected item type: {type(item).__name__}")


# ─── main ──────────────────────────────────────────────────────────────

FRONTMATTER_RE = re.compile(r"^(\s*---\n)(.*?)(\n---\n)(.*)", re.DOTALL)
ITEM_FIELDS = ("todos", "backlogs", "resolved_from_backlog")


def migrate_one(path: str, dry_run: bool) -> tuple[bool, dict[str, int]]:
    """반환: (changed?, {field: converted_count})."""
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    m = FRONTMATTER_RE.match(content)
    if not m:
        print(f"  SKIP (no frontmatter): {path}", file=sys.stderr)
        return False, {}

    open_fence, fm_raw, close_fence, body = m.groups()

    try:
        fm = yaml.safe_load(fm_raw) or {}
    except yaml.YAMLError as e:
        print(f"  SKIP (yaml parse error): {path}: {e}", file=sys.stderr)
        return False, {}

    if not isinstance(fm, dict):
        return False, {}

    counts: dict[str, int] = {}
    new_fm_text = fm_raw
    any_changed = False

    for field in ITEM_FIELDS:
        items = fm.get(field)
        if not isinstance(items, list) or not items:
            continue
        converted = [to_object_form(x) for x in items]
        if converted == items:
            continue
        n = sum(1 for orig in items if isinstance(orig, str))
        counts[field] = n
        new_fm_text, changed = replace_field(new_fm_text, field, converted)
        any_changed = any_changed or changed

    if not any_changed:
        return False, counts

    new_content = open_fence + new_fm_text + close_fence + body

    if dry_run:
        return True, counts

    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(new_content)
    return True, counts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="*", help="기본: reports/*/*.md")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    paths = args.paths or sorted(
        p for p in glob.glob("reports/*/*.md") if not p.endswith(".meta.json")
    )

    total_changed = 0
    for p in paths:
        changed, counts = migrate_one(p, args.dry_run)
        if changed:
            total_changed += 1
            summary = ", ".join(f"{k}:{v}" for k, v in counts.items())
            tag = "DRY" if args.dry_run else "OK "
            print(f"  [{tag}] {p}  ({summary})")

    print(
        f"\n{total_changed}/{len(paths)} report{'s' if len(paths) != 1 else ''} "
        f"{'would be' if args.dry_run else 'were'} updated."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
