#!/usr/bin/env python3
"""리포트 frontmatter + body schema + secret 누출 validator.

사용:
    python3 scripts/validate-report.py <report.md> [--project REPO] [--strict] [--new-report]

--strict:
    위반이 하나라도 있으면 exit 1.
--new-report:
    신규 Codex 산출물 전용 규칙을 적용한다. 기존 리포트 호환 검증에는 붙이지 않는다.
default (no --strict):
    exit 0 + stderr 에 경고만. test-prompt.sh 로컬 디버깅용.

검증 항목:
  1. frontmatter (--- ... ---) 블록 존재 + body 와 올바르게 분리
  2. body 안에 추가 `---` 블록이 없음 (frontmatter 중복 방지)
  3. 필수 필드 11 개:
       project / date / commit_range / commit_count / risk_level / tags /
       summary / progress_estimate / doc_scores / todos / backlogs
     (--new-report 에서는 resolved_from_backlog 도 필수)
  4. commit_range 가 Astro zod regex `^[0-9a-f]{7,40}\\.\\.[0-9a-f]{7,40}$` 와 일치
  5. risk_level ∈ {low, medium, high}
  6. date 가 ISO 8601 with offset
  7. progress_estimate 는 0-100 정수
  8. doc_scores.{design,technical,spec} 는 각각 0-10 정수
  9. tags 는 3-6개 문자열 배열, summary 는 60자 이내.
     (--new-report 에서는) todos 는 3-10개 객체 배열이며 priority 내림차순이어야 한다.
     (--new-report 에서는) todos / backlogs 항목에는 priority 가 필수이고,
     resolved_from_backlog 항목에는 details / priority 가 금지된다.
  10. (--project 지정 시) project 필드가 입력 repo 와 일치
  11. 본문 필수 6 개 섹션 헤딩. resolved_from_backlog 가 비어있지 않으면 § 7 도 필수
  12. content 어디에도 알려진 secret 패턴이 없어야 함 (OpenAI/Codex/Anthropic/GitHub 등)

이 파일은 test-prompt.sh 와 generate-reports.yml 양쪽에서 재사용되므로
검증 로직이 한 곳에만 존재한다 (drift 방지).
"""
from __future__ import annotations

import argparse
from difflib import SequenceMatcher
import re
import sys
from pathlib import Path

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
    (re.compile(r"sk-proj-[A-Za-z0-9_-]{10,}"), "OpenAI project API key (sk-proj-...)"),
    (re.compile(r"sk-(?!ant-oat)[A-Za-z0-9_-]{20,}"), "OpenAI API key (sk-...)"),
    (
        re.compile(r'"(access_token|refresh_token|id_token)"\s*:\s*"[^"]{10,}"'),
        "Codex auth.json token field",
    ),
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

NEW_REPORT_REQUIRED_FIELDS: list[str] = [
    "resolved_from_backlog",
]

TAG_MIN = 3
TAG_MAX = 6
SUMMARY_MAX_CHARS = 60
TODO_MIN = 3
TODO_MAX = 10
FILES_MAX = 4
PRIORITY_ORDER: dict[str, int] = {
    "critical": 0,
    "high": 1,
    "medium": 2,
    "low": 3,
}
TITLE_SIMILARITY_THRESHOLD = 0.58
LEDGER_TITLE_SIMILARITY_THRESHOLD = 0.82
TITLE_STOP_WORDS = {
    "및", "과", "와", "이", "가", "은", "는", "을", "를", "에", "에서",
    "으로", "로", "의", "도", "또", "또한", "아직", "현재", "기반",
    "관련", "필요", "부재", "부족", "확인", "검증", "추가", "문서",
    "코드", "항목", "처리",
}

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
    """모델 출력의 흔한 1 급 실수를 자동 보정.

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


def item_title(item: object) -> str:
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict) and isinstance(item.get("title"), str):
        return item["title"].strip()
    return ""


def titles_from_items(items: object) -> set[str]:
    if not isinstance(items, list):
        return set()
    return {title for item in items if (title := item_title(item))}


def title_alias_key(title: str) -> str:
    """Coarse key used only to reject duplicate open variants in one report."""

    text = re.sub(r"`([^`]*)`", r"\1", title)
    text = re.sub(r"\([^)]*\)|（[^）]*）", "", text)
    text = re.sub(r"\[[^\]]*\]|【[^】]*】", "", text)
    text = re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE)
    return text.casefold()


def duplicate_alias_titles(items: object) -> list[tuple[str, str]]:
    if not isinstance(items, list):
        return []

    seen: dict[str, str] = {}
    duplicates: list[tuple[str, str]] = []
    for item in items:
        title = item_title(item)
        if not title:
            continue
        key = title_alias_key(title)
        if not key:
            continue
        previous = seen.get(key)
        if previous is not None and previous != title:
            duplicates.append((previous, title))
        else:
            seen[key] = title
    return duplicates


def title_similarity_key(title: str) -> str:
    text = re.sub(r"`([^`]*)`", r"\1", title)
    text = re.sub(r"\([^)]*\)|（[^）]*）", " ", text)
    chars = [
        ch.casefold() if ch.isalnum() or ("가" <= ch <= "힣") else " "
        for ch in text
    ]
    return re.sub(r"\s+", " ", "".join(chars)).strip()


def title_tokens(title: str) -> set[str]:
    return {
        token
        for token in title_similarity_key(title).split()
        if len(token) >= 2 and token not in TITLE_STOP_WORDS
    }


def title_similarity(left: str, right: str) -> float:
    left_key = title_similarity_key(left)
    right_key = title_similarity_key(right)
    if not left_key or not right_key:
        return 0.0

    sequence_ratio = SequenceMatcher(None, left_key, right_key).ratio()
    left_tokens = title_tokens(left)
    right_tokens = title_tokens(right)
    if not left_tokens and not right_tokens:
        return sequence_ratio

    overlap = len(left_tokens & right_tokens)
    union = len(left_tokens | right_tokens)
    jaccard = overlap / union if union else 0.0
    containment = max(
        overlap / max(1, len(left_tokens)),
        overlap / max(1, len(right_tokens)),
    )
    return max(sequence_ratio, jaccard, containment * 0.82)


def duplicate_open_item_titles(fm: dict[str, object]) -> list[tuple[str, str, str, str, float]]:
    rows: list[tuple[str, str]] = []
    for field in ("todos", "backlogs"):
        items = fm.get(field) or []
        if not isinstance(items, list):
            continue
        for item in items:
            title = item_title(item)
            if title:
                rows.append((field, title))

    duplicates: list[tuple[str, str, str, str, float]] = []
    for i, (left_field, left_title) in enumerate(rows):
        for right_field, right_title in rows[i + 1:]:
            if left_title == right_title:
                duplicates.append((left_field, left_title, right_field, right_title, 1.0))
                continue
            score = title_similarity(left_title, right_title)
            if score >= TITLE_SIMILARITY_THRESHOLD:
                duplicates.append((left_field, left_title, right_field, right_title, score))
    return duplicates


def normalized_title_key(title: str) -> str:
    return re.sub(r"\s+", " ", title).strip().casefold()


def matching_open_record_keys(
    records: dict[str, dict[str, str]],
    title: str,
) -> list[str]:
    key = normalized_title_key(title)
    matches: list[str] = []
    if key and records.get(key, {}).get("status") == "open":
        matches.append(key)

    for record_key, record in records.items():
        if record_key == key or record.get("status") != "open":
            continue
        existing_title = record.get("title", "")
        if (
            existing_title
            and title_similarity(existing_title, title) >= LEDGER_TITLE_SIMILARITY_THRESHOLD
        ):
            matches.append(record_key)
    return matches


def first_matching_open_record_key(
    records: dict[str, dict[str, str]],
    title: str,
) -> str | None:
    matches = matching_open_record_keys(records, title)
    return matches[0] if matches else None


def frontmatter_from_content(content: str) -> dict[str, object]:
    m = FRONTMATTER_RE.match(content)
    if not m:
        return {}
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        return {}
    return fm if isinstance(fm, dict) else {}


def frontmatter_from_file(path: Path) -> dict[str, object]:
    try:
        return frontmatter_from_content(path.read_text(encoding="utf-8"))
    except OSError:
        return {}


def unresolved_backlog_titles_from_reports(reports_dir: Path) -> set[str]:
    """Return backlog titles not followed by a resolved entry.

    Exact title matches are preferred, but high-confidence title variants are
    folded so one resolved entry can close duplicate historical wording such as
    parenthetical notes or line-number variants.
    """

    records: dict[str, dict[str, str]] = {}
    for report in sorted(reports_dir.glob("*.md"), key=lambda p: p.name):
        fm = frontmatter_from_file(report)

        for item in fm.get("resolved_from_backlog") or []:
            title = item_title(item)
            if not title:
                continue
            for key in matching_open_record_keys(records, title):
                records[key]["status"] = "resolved"

        for item in fm.get("backlogs") or []:
            title = item_title(item)
            if not title:
                continue
            key = normalized_title_key(title)
            matching_key = first_matching_open_record_key(records, title)
            if key not in records and matching_key:
                key = matching_key
            if key not in records or records[key].get("status") == "resolved":
                records[key] = {"title": title, "status": "open"}
            else:
                records[key]["title"] = title
                records[key]["status"] = "open"

    return {
        record["title"]
        for record in records.values()
        if record.get("status") == "open"
    }


def validate(
    content: str,
    expected_project: str | None = None,
    new_report: bool = False,
    previous_frontmatter: dict[str, object] | None = None,
    enforce_backlog_carryover: bool = False,
    ledger_backlog_titles: set[str] | None = None,
) -> list[str]:
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
    required_fields = REQUIRED_FIELDS + (
        NEW_REPORT_REQUIRED_FIELDS if new_report else []
    )
    for f in required_fields:
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

    # summary 한 줄 요약
    summary = fm.get("summary")
    if summary is not None:
        if not isinstance(summary, str) or not summary.strip():
            errors.append(f"summary 는 비어있지 않은 문자열이어야 함 (got: {summary!r})")
        elif len(summary) > SUMMARY_MAX_CHARS:
            errors.append(
                f"summary 길이 초과 ({len(summary)}자, 한도 {SUMMARY_MAX_CHARS})"
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

    # tags — 순수 문자열 배열
    if "tags" in fm:
        v = fm["tags"]
        if not isinstance(v, list):
            errors.append(f"tags 는 배열이어야 함 (got: {type(v).__name__})")
        else:
            if not (TAG_MIN <= len(v) <= TAG_MAX):
                errors.append(
                    f"tags 개수 오류 ({len(v)}개, 기준 {TAG_MIN}-{TAG_MAX}개)"
                )
            for i, item in enumerate(v):
                if not isinstance(item, str) or not item.strip():
                    errors.append(
                        f"tags[{i}] 는 비어있지 않은 문자열이어야 함 "
                        f"(got: {type(item).__name__})"
                    )

    # todos / backlogs / resolved_from_backlog — 신규 리포트는 객체 항목만 허용.
    for arr_field in ("todos", "backlogs", "resolved_from_backlog"):
        if arr_field in fm:
            v = fm[arr_field]
            if not isinstance(v, list):
                errors.append(
                    f"{arr_field} 는 배열이어야 함 (got: {type(v).__name__})"
                )
                continue
            if (
                new_report
                and arr_field == "todos"
                and not (TODO_MIN <= len(v) <= TODO_MAX)
            ):
                errors.append(
                    f"todos 개수 오류 ({len(v)}개, 기준 {TODO_MIN}-{TODO_MAX}개)"
                )
            last_todo_priority_rank = -1
            for i, item in enumerate(v):
                if isinstance(item, str):
                    if not item.strip():
                        errors.append(f"{arr_field}[{i}] 가 빈 문자열")
                    if new_report:
                        errors.append(
                            f"{arr_field}[{i}] 는 객체여야 함 "
                            "(신규 리포트는 title/priority/files/details 형식)"
                        )
                elif isinstance(item, dict):
                    title = item.get("title")
                    if not isinstance(title, str) or not title.strip():
                        errors.append(
                            f"{arr_field}[{i}].title 누락 또는 비문자열"
                        )
                    if (
                        new_report
                        and arr_field in {"todos", "backlogs"}
                        and "priority" not in item
                    ):
                        errors.append(f"{arr_field}[{i}].priority 누락")
                    if "files" in item:
                        files = item["files"]
                        if not isinstance(files, list):
                            errors.append(
                                f"{arr_field}[{i}].files 는 배열이어야 함 "
                                f"(got: {type(files).__name__})"
                            )
                        else:
                            if new_report and not (1 <= len(files) <= FILES_MAX):
                                errors.append(
                                    f"{arr_field}[{i}].files 개수 오류 "
                                    f"({len(files)}개, 기준 1-{FILES_MAX}개)"
                                )
                            for j, fp in enumerate(files):
                                if not isinstance(fp, str) or (
                                    new_report and not fp.strip()
                                ):
                                    errors.append(
                                        f"{arr_field}[{i}].files[{j}] 는 "
                                        "비어있지 않은 문자열이어야 함"
                                    )
                    if "details" in item:
                        details = item["details"]
                        if not isinstance(details, str) or not details.strip():
                            errors.append(
                                f"{arr_field}[{i}].details 는 비어있지 않은 문자열이어야 함"
                            )
                        elif len(details) > 120:
                            errors.append(
                                f"{arr_field}[{i}].details 길이 초과 "
                                f"({len(details)}자, 한도 120)"
                            )
                        # resolved 항목엔 details 금지 (이미 끝난 일이라 비용 가치 낮음).
                        if arr_field == "resolved_from_backlog":
                            errors.append(
                                f"{arr_field}[{i}].details 는 허용되지 않음 "
                                "(resolved 항목은 details 안 씀)"
                            )
                    if "priority" in item:
                        prio = item["priority"]
                        if prio not in PRIORITY_ORDER:
                            errors.append(
                                f"{arr_field}[{i}].priority 값 오류 "
                                f"(got: {prio!r}, 기대: critical/high/medium/low)"
                            )
                        elif new_report and arr_field == "todos":
                            rank = PRIORITY_ORDER[prio]
                            if rank < last_todo_priority_rank:
                                errors.append(
                                    "todos priority 정렬 오류 "
                                    "(critical → high → medium → low 순서여야 함)"
                                )
                            last_todo_priority_rank = rank
                        # resolved 항목엔 priority 금지 (이미 끝난 일이라 의미 없음).
                        if arr_field == "resolved_from_backlog":
                            errors.append(
                                f"{arr_field}[{i}].priority 는 허용되지 않음 "
                                "(resolved 항목은 priority 안 씀)"
                            )
                    extra = set(item.keys()) - {"title", "files", "details", "priority"}
                    if extra:
                        errors.append(
                            f"{arr_field}[{i}] 에 허용되지 않은 키: {sorted(extra)} "
                            "(허용: title, files, details, priority)"
                        )
                else:
                    errors.append(
                        f"{arr_field}[{i}] 는 문자열 또는 객체여야 함 "
                        f"(got: {type(item).__name__})"
                    )

    # 신규 리포트에서 해결 처리한 항목이 동시에 open item 으로 남으면 UI와
    # 다음 프롬프트가 서로 모순된 상태를 물려받는다.
    if new_report:
        def titles_of(field: str) -> set[str]:
            return titles_from_items(fm.get(field) or [])

        open_titles = titles_of("todos") | titles_of("backlogs")
        resolved_titles = titles_of("resolved_from_backlog")
        overlap = sorted(open_titles & resolved_titles)
        if overlap:
            errors.append(
                "resolved_from_backlog 항목이 todos/backlogs 에도 남아있음: "
                + ", ".join(overlap)
            )

        backlog_alias_duplicates = duplicate_alias_titles(fm.get("backlogs") or [])
        if backlog_alias_duplicates:
            formatted = "; ".join(
                f"{first!r} <-> {second!r}"
                for first, second in backlog_alias_duplicates
            )
            errors.append(
                "backlogs contains duplicate title variants for the same open issue: "
                + formatted
            )

        open_item_duplicates = duplicate_open_item_titles(fm)
        if open_item_duplicates:
            formatted = "; ".join(
                f"{left_field}:{left_title!r} <-> "
                f"{right_field}:{right_title!r} ({score:.2f})"
                for left_field, left_title, right_field, right_title, score
                in open_item_duplicates
            )
            errors.append(
                "todos/backlogs contain duplicate or overlapping open item titles: "
                + formatted
            )

        if enforce_backlog_carryover and previous_frontmatter:
            previous_backlog_titles = titles_from_items(
                previous_frontmatter.get("backlogs") or []
            )
            accounted_titles = titles_of("backlogs") | resolved_titles
            missing = sorted(previous_backlog_titles - accounted_titles)
            if missing:
                errors.append(
                    "이전 backlog 항목이 새 리포트에서 해결/이월 중 어느 쪽으로도 "
                    "회계 처리되지 않음: " + ", ".join(missing)
                )

        if ledger_backlog_titles:
            accounted_titles = titles_of("backlogs") | resolved_titles
            missing = sorted(ledger_backlog_titles - accounted_titles)
            if missing:
                errors.append(
                    "누적 unresolved backlog 항목이 새 리포트에서 해결/이월 중 어느 "
                    "쪽으로도 회계 처리되지 않음: " + ", ".join(missing)
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
    ap.add_argument("--new-report", action="store_true",
                    help="신규 Codex 산출물 전용 Item/필수 필드 규칙 적용")
    ap.add_argument("--previous-report", default=None,
                    help="직전 리포트 경로. backlog carryover 검증에 사용")
    ap.add_argument("--enforce-backlog-carryover", action="store_true",
                    help="직전 backlog title 이 새 backlogs 또는 resolved_from_backlog 에 남는지 검증")
    ap.add_argument("--reports-dir", default=None,
                    help="프로젝트 reports 디렉토리. 누적 backlog ledger 검증에 사용")
    ap.add_argument("--enforce-backlog-ledger", action="store_true",
                    help="히스토리상 unresolved backlog title 이 새 backlogs 또는 resolved_from_backlog 에 남는지 검증")
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

    previous_frontmatter: dict[str, object] | None = None
    if args.previous_report:
        try:
            with open(args.previous_report, "r", encoding="utf-8") as f:
                previous_frontmatter = frontmatter_from_content(f.read())
        except OSError as e:
            print(f"[validate-report] 이전 리포트 읽기 실패: {e}", file=sys.stderr)
            return 2
        if args.enforce_backlog_carryover and not previous_frontmatter:
            print("[validate-report] 이전 리포트 frontmatter 파싱 실패", file=sys.stderr)
            return 2

    ledger_backlog_titles: set[str] | None = None
    if args.enforce_backlog_ledger:
        if not args.reports_dir:
            print("[validate-report] --enforce-backlog-ledger requires --reports-dir", file=sys.stderr)
            return 2
        reports_dir = Path(args.reports_dir)
        if not reports_dir.is_dir():
            print(f"[validate-report] reports 디렉토리 없음: {reports_dir}", file=sys.stderr)
            return 2
        ledger_backlog_titles = unresolved_backlog_titles_from_reports(reports_dir)

    errors = validate(
        content,
        args.project,
        new_report=args.new_report,
        previous_frontmatter=previous_frontmatter,
        enforce_backlog_carryover=args.enforce_backlog_carryover,
        ledger_backlog_titles=ledger_backlog_titles,
    )
    if errors:
        print("[validate-report] SCHEMA ISSUES:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1 if args.strict else 0

    print("[validate-report] OK", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
