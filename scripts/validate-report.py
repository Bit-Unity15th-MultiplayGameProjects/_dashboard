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
  3. 필수 필드 7 개 (project/date/commit_range/commit_count/risk_level/tags/summary)
  4. commit_range 가 Astro zod regex `^[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$` 와 일치
  5. risk_level ∈ {low, medium, high}
  6. date 가 ISO 8601 with offset
  7. (--project 지정 시) project 필드가 입력 repo 와 일치
  8. 본문 4 개 섹션 헤딩
  9. content 어디에도 알려진 secret 패턴이 없어야 함
     (Anthropic OAuth / GitHub PAT / OAuth / server tokens)

이 파일은 test-prompt.sh 와 generate-reports.yml 양쪽에서 재사용되므로
검증 로직이 한 곳에만 존재한다 (drift 방지).
"""
from __future__ import annotations

import argparse
import re
import sys


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
]

REQUIRED_FIELDS: list[str] = [
    "project", "date", "commit_range", "commit_count",
    "risk_level", "tags", "summary",
]

COMMIT_RANGE_RE = re.compile(r"^[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$", re.IGNORECASE)
# ISO 8601 with offset: 2026-04-21T12:34:56Z 또는 2026-04-21T12:34:56+09:00 등
ISO_8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$"
)
FRONTMATTER_RE = re.compile(r"^\s*---\n(.*?)\n---\n(.*)", re.DOTALL)


def _get_field(fm: str, name: str) -> str | None:
    """frontmatter 문자열에서 `name: value` 첫 매치를 리턴. YAML list·multiline 은
    여기서 다루지 않고 None 리턴 (tags 같은 배열은 별도 검증)."""
    m = re.search(rf'^{name}\s*:\s*"?([^"\n]*)"?\s*$', fm, re.MULTILINE)
    return m.group(1).strip() if m else None


def validate(content: str, expected_project: str | None = None) -> list[str]:
    errors: list[str] = []

    m = FRONTMATTER_RE.match(content)
    if not m:
        return ["frontmatter (--- ... ---) 블록을 찾을 수 없음"]

    fm, body = m.group(1), m.group(2)

    # 중복 frontmatter (body 안 `---` 블록) — 경고 수준이지만 Astro 가 깨질 수 있음
    if re.search(r"\n---\s*\n", body):
        errors.append("body 안에 추가 `---` 블록이 감지됨 (frontmatter 중복 가능성)")

    # 필수 필드 존재
    for f in REQUIRED_FIELDS:
        if not re.search(rf"^{f}\s*:", fm, re.MULTILINE):
            errors.append(f"frontmatter 필드 누락: {f}")

    # 개별 필드 값 검증
    cr = _get_field(fm, "commit_range")
    if cr is not None and not COMMIT_RANGE_RE.match(cr):
        errors.append(
            f"commit_range 형식 오류 (기대: `<7-40hex>..<7-40hex>`, got: {cr!r})"
        )

    rl = _get_field(fm, "risk_level")
    if rl is not None and rl not in {"low", "medium", "high"}:
        errors.append(f"risk_level 값 오류 (got: {rl!r}, 기대: low/medium/high)")

    dt = _get_field(fm, "date")
    if dt is not None and not ISO_8601_RE.match(dt):
        errors.append(f"date 가 ISO 8601 with offset 이 아님 (got: {dt!r})")

    if expected_project is not None:
        pj = _get_field(fm, "project")
        if pj is not None and pj != expected_project:
            errors.append(
                f"project 값이 입력과 불일치 (got: {pj!r}, expected: {expected_project!r})"
            )

    # 본문 섹션 헤딩
    for h in REQUIRED_HEADINGS:
        if h not in body:
            errors.append(f"본문 섹션 헤딩 누락: {h}")

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
