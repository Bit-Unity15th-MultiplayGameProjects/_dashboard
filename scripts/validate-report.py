#!/usr/bin/env python3
"""리포트 frontmatter + body schema + secret 누출 validator.

사용:
    python3 scripts/validate-report.py <report.md> [--project REPO] [--strict]

--strict:
    위반이 하나라도 있으면 exit 1. CI (generate-reports.yml) 에서 cell 을
    실패시키는 용도.
default (no --strict):
    exit 0 + stderr 에 경고만. test-prompt.sh 로컬 디버깅용.

검증 항목:
  1. frontmatter (--- ... ---) 블록 존재 + body 와 올바르게 분리
  2. body 안에 추가 `---` 블록이 없음 (frontmatter 중복 방지)
  3. 필수 필드 11 개:
       project / date / commit_range / commit_count / risk_level / tags /
       summary / progress_estimate / doc_scores / todos / backlogs
     (resolved_from_backlog 는 선택 — 해결 항목이 없으면 빈 배열 또는 생략)
  4. commit_range 가 Astro zod regex `^[0-9a-f]{7,40}\\.\\.[0-9a-f]{7,40}$` 와 일치
  5. risk_level ∈ {low, medium, high}
  6. date 가 ISO 8601 with offset
  7. progress_estimate 는 0-100 정수
  8. doc_scores.{design,technical,spec} 는 각각 0-10 정수
  9. tags / todos / backlogs / resolved_from_backlog 는 문자열 배열
  10. (--project 지정 시) project 필드가 입력 repo 와 일치
  11. 본문 필수 6 개 섹션 헤딩. resolved_from_backlog 가 비어있지 않으면 § 7 도 필수
  12. content 어디에도 알려진 secret 패턴이 없어야 함 (Anthropic OAuth / GitHub PAT 등)

이 파일은 test-prompt.sh 와 generate-reports.yml 양쪽에서 재사용되므로
검증 로직이 한 곳에만 존재한다 (drift 방지).
"""
from __future__ import annotations

import argparse
import re
import sys

try:
    import yaml
except ImportError:
    print(
        "[validate-report] PyYAML 이 설치되어 있지 않음. "
        "`pip install pyyaml` 또는 apt 로 `python3-yaml` 설치 필요.",
        file=sys.stderr,
    )
    sys.exit(2)


SECRET_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"sk-ant-oat\w{10,}"),    "Anthropic OAuth token (sk-ant-oat...)"),
    (re.compile(r"ghp_\w{10,}"),          "GitHub classic PAT (ghp_...)"),
    (re.compile(r"github_pat_\w{10,}"),   "GitHub fine-grained PAT (github_pat_...)"),
    (re.compile(r"gho_\w{10,}"),          "GitHub OAuth token (gho_...)"),
    (re.compile(r"ghu_\w{10,}"),          "GitHub user token (ghu_...)"),
    (re.compile(r"ghs_\w{10,}"),          "GitHub server token (ghs_...)"),
    (re.compile(r"ghr_\w{10,}"),          "GitHub refresh token (ghr_...)"),
]

REQUIRED_HEADINGS: list[str] = [
    "## 1. 주요 변경사항",
    "## 2. 코드 품질 리뷰",
    "## 3. 진행도 평가",
    "## 4. 다음 권장사항",
    "## 5. 문서화 상태",
    "## 6. Backlog",
]

# resolved_from_backlog 가 있으면 추가 필수. 없으면 이 섹션 자체 생략 허용.
CONDITIONAL_HEADING: str = "## 7. 이전 Backlog 해결"

REQUIRED_FIELDS: list[str] = [
    "project", "date", "commit_range", "commit_count",
    "risk_level", "tags", "summary",
    "progress_estimate", "doc_scores", "todos", "backlogs",
]

COMMIT_RANGE_RE = re.compile(r"^[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$", re.IGNORECASE)
# ISO 8601 with offset: 2026-04-21T12:34:56Z 또는 2026-04-21T12:34:56+09:00 등
ISO_8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$"
)
FRONTMATTER_RE = re.compile(r"^\s*---\n(.*?)\n---\n(.*)", re.DOTALL)


def _is_int(v: object) -> bool:
    """bool 은 int 의 subclass 라 분리."""
    return isinstance(v, int) and not isinstance(v, bool)


def normalize(content: str) -> tuple[str, list[str]]:
    """Claude 출력의 흔한 1 급 실수를 자동 보정.

    현재 보정 대상:
      - 닫는 `---` 누락: opening fence 는 있는데 YAML 직후 본문 heading 이 바로
        시작하는 경우. 첫 `# <heading>` 라인 앞에 `---\\n\\n` 을 삽입.

    반환: (fixed_content, applied_fix_descriptions).
    빈 리스트면 원문 그대로.
    """
    fixes: list[str] = []

    opens = re.match(r"^\s*---\s*\n", content)
    if opens:
        after = content[opens.end():]
        closes = re.search(r"\n---\s*\n", after)
        if not closes:
            # 본문 heading (맨 앞이 `# `, `## ` 는 아님) 을 찾아 그 앞에 닫는 fence 를 주입.
            body = re.search(r"\n(# \S)", after)
            if body:
                insert_at = opens.end() + body.start(1)
                content = content[:insert_at] + "---\n\n" + content[insert_at:]
                fixes.append("closing `---` 누락 자동 보정 (본문 `# ` 헤딩 앞 삽입)")

    return content, fixes


def validate(content: str, expected_project: str | None = None) -> list[str]:
    errors: list[str] = []

    m = FRONTMATTER_RE.match(content)
    if not m:
        return ["frontmatter (--- ... ---) 블록을 찾을 수 없음"]

    fm_raw, body = m.group(1), m.group(2)

    # body 안 추가 `---` 블록 — Astro 파서가 깨질 수 있음
    if re.search(r"\n---\s*\n", body):
        errors.append("body 안에 추가 `---` 블록 감지 (frontmatter 중복 가능성)")

    # frontmatter YAML 파싱
    try:
        fm = yaml.safe_load(fm_raw)
    except yaml.YAMLError as e:
        return errors + [f"frontmatter YAML 파싱 실패: {e}"]

    if not isinstance(fm, dict):
        return errors + ["frontmatter 가 YAML 객체가 아님 (top-level dict 필요)"]

    # 필수 필드 존재
    for f in REQUIRED_FIELDS:
        if f not in fm:
            errors.append(f"frontmatter 필드 누락: {f}")

    # commit_range
    cr = fm.get("commit_range")
    if cr is not None and not COMMIT_RANGE_RE.match(str(cr)):
        errors.append(
            f"commit_range 형식 오류 (기대: `<7-40hex>..<7-40hex>`, got: {cr!r})"
        )

    # risk_level
    rl = fm.get("risk_level")
    if rl is not None and rl not in {"low", "medium", "high"}:
        errors.append(f"risk_level 값 오류 (got: {rl!r}, 기대: low/medium/high)")

    # date
    dt = fm.get("date")
    if dt is not None and not ISO_8601_RE.match(str(dt)):
        errors.append(f"date 가 ISO 8601 with offset 이 아님 (got: {dt!r})")

    # project 일치
    if expected_project is not None:
        pj = fm.get("project")
        if pj is not None and pj != expected_project:
            errors.append(
                f"project 값이 입력과 불일치 (got: {pj!r}, expected: {expected_project!r})"
            )

    # commit_count 정수
    cc = fm.get("commit_count")
    if cc is not None and (not _is_int(cc) or cc < 0):
        errors.append(f"commit_count 는 0 이상 정수여야 함 (got: {cc!r})")

    # progress_estimate 0-100 정수
    pe = fm.get("progress_estimate")
    if pe is not None and (not _is_int(pe) or pe < 0 or pe > 100):
        errors.append(f"progress_estimate 는 0-100 정수여야 함 (got: {pe!r})")

    # doc_scores 객체 + 세 축
    ds = fm.get("doc_scores")
    if ds is not None:
        if not isinstance(ds, dict):
            errors.append(f"doc_scores 는 객체여야 함 (got: {type(ds).__name__})")
        else:
            for axis in ("design", "technical", "spec"):
                if axis not in ds:
                    errors.append(f"doc_scores.{axis} 누락")
                else:
                    v = ds[axis]
                    if not _is_int(v) or v < 0 or v > 10:
                        errors.append(
                            f"doc_scores.{axis} 는 0-10 정수여야 함 (got: {v!r})"
                        )

    # tags / todos / backlogs / resolved_from_backlog — 문자열 배열
    for arr_field in ("tags", "todos", "backlogs", "resolved_from_backlog"):
        if arr_field in fm:
            v = fm[arr_field]
            if not isinstance(v, list):
                errors.append(
                    f"{arr_field} 는 배열이어야 함 (got: {type(v).__name__})"
                )
            else:
                for i, item in enumerate(v):
                    if not isinstance(item, str):
                        errors.append(
                            f"{arr_field}[{i}] 는 문자열이어야 함 "
                            f"(got: {type(item).__name__})"
                        )

    # 본문 필수 섹션 헤딩
    for h in REQUIRED_HEADINGS:
        if h not in body:
            errors.append(f"본문 섹션 헤딩 누락: {h}")

    # 조건부: resolved_from_backlog 이 비어있지 않으면 § 7 헤딩도 필요
    rfb = fm.get("resolved_from_backlog")
    if isinstance(rfb, list) and len(rfb) > 0 and CONDITIONAL_HEADING not in body:
        errors.append(
            f"resolved_from_backlog 에 항목이 있으면 본문에 `{CONDITIONAL_HEADING}` 섹션 필요"
        )

    # secret 누출 탐지 (전체 content — frontmatter·body 양쪽)
    for pat, name in SECRET_PATTERNS:
        if pat.search(content):
            errors.append(f"secret 패턴 탐지: {name}")

    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description="report schema + security validator")
    ap.add_argument("path", help="리포트 markdown 파일 경로")
    ap.add_argument("--project", default=None,
                    help="기대되는 project 값 (입력 repo 이름)")
    ap.add_argument("--strict", action="store_true",
                    help="위반 시 exit 1 (기본: exit 0 + 경고만)")
    args = ap.parse_args()

    try:
        with open(args.path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError as e:
        print(f"[validate-report] 파일 열 수 없음: {e}", file=sys.stderr)
        return 2

    # 흔한 1 급 출력 실수 자동 보정. 실제로 content 가 바뀌면 파일에 다시 쓴다
    # → Astro 빌드 시 고쳐진 내용을 본다.
    content, fixes = normalize(content)
    if fixes:
        try:
            with open(args.path, "w", encoding="utf-8") as f:
                f.write(content)
        except OSError as e:
            print(f"[validate-report] auto-fix write 실패: {e}", file=sys.stderr)
            return 2
        print("[validate-report] AUTO-FIXED:", file=sys.stderr)
        for f in fixes:
            print(f"  - {f}", file=sys.stderr)

    errors = validate(content, args.project)
    if errors:
        print("[validate-report] SCHEMA ISSUES:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1 if args.strict else 0

    print("[validate-report] OK", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
