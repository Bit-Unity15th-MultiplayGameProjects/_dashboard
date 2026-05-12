#!/usr/bin/env python3
"""Build compact context blocks for the review prompt.

The report prompt is intentionally generated from bounded context so the
review job does not need to run arbitrary commands inside project repos. This
helper keeps the duplicated "previous item" and "current docs" extraction logic
in one place for CI and local dry-runs.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
import re
import sys
from pathlib import Path
from typing import Any


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


SKIP_DIRS = {
    ".git",
    ".github",
    ".claude",
    ".astro",
    ".vs",
    "Library",
    "Temp",
    "Obj",
    "Build",
    "Builds",
    "Logs",
    "UserSettings",
    "coverage",
    "dist",
    "node_modules",
    "reports",
    "scripts",
    "bin",
    "obj",
}

EXCLUDED_FILENAMES = {
    "AGENTS.md",
    "AI_HANDOFF.md",
    "CLAUDE.md",
}

TEXT_EXTS = {
    ".adoc",
    ".csv",
    ".json",
    ".md",
    ".markdown",
    ".rst",
    ".txt",
    ".yaml",
    ".yml",
}

DOC_EXTS = TEXT_EXTS | {
    ".doc",
    ".docx",
    ".hwp",
    ".hwpx",
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
}

DOC_FILE_LIST_MAX = 60

DOC_HINT_RE = re.compile(
    r"(readme|docs?|documentation|documents|gdd|spec|기획|설계|명세|문서|"
    r"technical|architecture|아키텍처|요구사항|테스트|checklist|체크리스트)",
    re.IGNORECASE,
)

PRIORITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def _load_yaml_frontmatter(path: Path) -> dict[str, Any]:
    try:
        import yaml
    except ImportError:
        return {}

    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return {}

    match = re.match(r"^\s*---\n(.*?)\n---", content, re.DOTALL)
    if not match:
        return {}

    try:
        data = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def _format_item(item: Any) -> str | None:
    if isinstance(item, str):
        title = item.strip()
        return f"- {title}" if title else None

    if not isinstance(item, dict):
        return None

    title = item.get("title")
    if not isinstance(title, str) or not title.strip():
        return None

    extras: list[str] = []

    priority = item.get("priority")
    if isinstance(priority, str) and priority.strip():
        extras.append(f"priority: {priority.strip()}")

    files = item.get("files")
    if isinstance(files, list):
        clean_files = [str(f).strip() for f in files if isinstance(f, str) and f.strip()]
        if clean_files:
            extras.append("files: " + ", ".join(clean_files[:4]))

    details = item.get("details")
    if isinstance(details, str) and details.strip():
        extras.append(f"details: {details.strip()}")

    suffix = f"  [{'; '.join(extras)}]" if extras else ""
    return f"- {title.strip()}{suffix}"


def _item_title(item: Any) -> str | None:
    if isinstance(item, str):
        title = item.strip()
        return title or None
    if isinstance(item, dict) and isinstance(item.get("title"), str):
        title = item["title"].strip()
        return title or None
    return None


def _normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", title).strip().casefold()


def _report_sort_key(path: Path) -> tuple[datetime, str]:
    # reports use filenames like 2026-05-11T14-24-46Z.md.
    slug = path.stem
    match = re.match(
        r"^(\d{4}-\d{2}-\d{2})[Tt](\d{2})-(\d{2})-(\d{2})([Zz])$",
        slug,
    )
    if match:
        iso = f"{match.group(1)}T{match.group(2)}:{match.group(3)}:{match.group(4)}+00:00"
        try:
            return (datetime.fromisoformat(iso), path.as_posix())
        except ValueError:
            pass

    fm = _load_yaml_frontmatter(path)
    date = fm.get("date")
    if isinstance(date, str):
        try:
            return (datetime.fromisoformat(date.replace("Z", "+00:00")), path.as_posix())
        except ValueError:
            pass
    return (datetime.fromtimestamp(0, timezone.utc), path.as_posix())


def _format_ledger_item(record: dict[str, Any]) -> str:
    extras = [
        str(record["field"]),
        f"seen {record['reports_seen']}x",
        f"{record['first_seen']} -> {record['last_seen']}",
    ]
    priority = record.get("priority")
    if priority:
        extras.insert(1, str(priority))
    files = record.get("files") or []
    if files:
        extras.append("files: " + ", ".join(files[:3]))
    return f"- {record['title']}  [{'; '.join(extras)}]"


def _unresolved_backlog_records(reports_dir: Path) -> list[dict[str, Any]]:
    if not reports_dir.is_dir():
        return []

    records: dict[str, dict[str, Any]] = {}
    for report in sorted(reports_dir.glob("*.md"), key=_report_sort_key):
        try:
            rel_report = report.relative_to(reports_dir.parent).as_posix()
        except ValueError:
            rel_report = report.as_posix()

        fm = _load_yaml_frontmatter(report)

        for item in fm.get("resolved_from_backlog") or []:
            title = _item_title(item)
            if not title:
                continue
            key = _normalize_title(title)
            record = records.get(key)
            if record:
                record["status"] = "resolved"
                record["resolved_seen"] = rel_report

        backlogs = fm.get("backlogs") or []
        if not isinstance(backlogs, list):
            continue

        for item in backlogs:
            title = _item_title(item)
            if not title:
                continue

            key = _normalize_title(title)
            record = records.get(key)
            if record is None or record.get("status") == "resolved":
                record = {
                    "title": title,
                    "field": "backlogs",
                    "first_seen": rel_report,
                    "last_seen": rel_report,
                    "reports_seen": 0,
                    "status": "open",
                }
                records[key] = record

            record["title"] = title
            record["field"] = "backlogs"
            record["last_seen"] = rel_report
            record["reports_seen"] = int(record.get("reports_seen", 0)) + 1
            record["status"] = "open"

            if isinstance(item, dict):
                priority = item.get("priority")
                if isinstance(priority, str) and priority.strip():
                    record["priority"] = priority.strip()
                files = item.get("files")
                if isinstance(files, list):
                    clean_files = [
                        str(f).strip()
                        for f in files
                        if isinstance(f, str) and f.strip()
                    ]
                    if clean_files:
                        record["files"] = clean_files
                details = item.get("details")
                if isinstance(details, str) and details.strip():
                    record["details"] = details.strip()

    unresolved = [
        record
        for record in records.values()
        if record.get("status") == "open"
    ]
    unresolved.sort(
        key=lambda r: (
            PRIORITY_ORDER.get(str(r.get("priority", "")), 9),
            str(r.get("last_seen", "")),
            str(r.get("title", "")),
        )
    )
    return unresolved


def previous_items(args: argparse.Namespace) -> int:
    fm = _load_yaml_frontmatter(Path(args.report))
    items = fm.get(args.field) or []
    if not isinstance(items, list):
        return 0

    lines = [line for item in items if (line := _format_item(item))]
    if lines:
        sys.stdout.write("\n".join(lines))
        sys.stdout.write("\n")
    return 0


def open_items(args: argparse.Namespace) -> int:
    reports_dir = Path(args.reports_dir)
    if not reports_dir.is_dir():
        sys.stdout.write("(이전 리포트 디렉토리를 찾지 못함)\n")
        return 0

    reports = sorted(reports_dir.glob("*.md"), key=_report_sort_key)
    if not reports:
        sys.stdout.write("(이전 리포트가 없어 누적 open item 없음)\n")
        return 0

    records: dict[str, dict[str, Any]] = {}
    latest_open_keys: set[str] = set()

    for idx, report in enumerate(reports):
        rel_report = report.relative_to(reports_dir.parent).as_posix()
        fm = _load_yaml_frontmatter(report)
        is_latest = idx == len(reports) - 1

        for item in fm.get("resolved_from_backlog") or []:
            title = _item_title(item)
            if not title:
                continue
            key = _normalize_title(title)
            record = records.get(key)
            if record:
                record["status"] = "resolved"
                record["resolved_seen"] = rel_report

        for field in ("todos", "backlogs"):
            values = fm.get(field) or []
            if not isinstance(values, list):
                continue
            for item in values:
                title = _item_title(item)
                if not title:
                    continue

                key = _normalize_title(title)
                if is_latest:
                    latest_open_keys.add(key)

                record = records.get(key)
                if record is None or record.get("status") == "resolved":
                    record = {
                        "title": title,
                        "field": field,
                        "first_seen": rel_report,
                        "last_seen": rel_report,
                        "reports_seen": 0,
                        "status": "open",
                    }
                    records[key] = record

                record["title"] = title
                record["field"] = field
                record["last_seen"] = rel_report
                record["reports_seen"] = int(record.get("reports_seen", 0)) + 1
                record["status"] = "open"

                if isinstance(item, dict):
                    priority = item.get("priority")
                    if isinstance(priority, str) and priority.strip():
                        record["priority"] = priority.strip()
                    files = item.get("files")
                    if isinstance(files, list):
                        clean_files = [
                            str(f).strip()
                            for f in files
                            if isinstance(f, str) and f.strip()
                        ]
                        if clean_files:
                            record["files"] = clean_files
                    details = item.get("details")
                    if isinstance(details, str) and details.strip():
                        record["details"] = details.strip()

    latest_records = [
        records[key]
        for key in latest_open_keys
        if key in records and records[key].get("status") == "open"
    ]
    dormant_records = [
        record
        for key, record in records.items()
        if record.get("status") == "open" and key not in latest_open_keys
    ]

    latest_records.sort(
        key=lambda r: (
            PRIORITY_ORDER.get(str(r.get("priority", "")), 9),
            str(r.get("field", "")),
            str(r.get("title", "")),
        )
    )
    dormant_records.sort(
        key=lambda r: (
            str(r.get("last_seen", "")),
            PRIORITY_ORDER.get(str(r.get("priority", "")), 9),
            str(r.get("title", "")),
        ),
        reverse=True,
    )

    max_items = max(1, int(args.max_items))
    out: list[str] = []
    out.append("최신 리포트 open items (반드시 전부 재판정):")
    if latest_records:
        for record in latest_records[:max_items]:
            out.append(_format_ledger_item(record))
        if len(latest_records) > max_items:
            out.append(f"- ... [{len(latest_records) - max_items} more latest open items omitted] ...")
    else:
        out.append("- (최신 리포트에 open TODO/Backlog 없음)")

    out.append("")
    out.append("과거 open item 중 resolved_from_backlog 기록 없이 최신 리포트에서 사라진 항목:")
    out.append("(누락/관성 삭제 가능성이 있으므로 이번 리뷰에서 해결·무효·재등장 여부를 재확인)")
    if dormant_records:
        for record in dormant_records[:max_items]:
            out.append(_format_ledger_item(record))
        if len(dormant_records) > max_items:
            out.append(f"- ... [{len(dormant_records) - max_items} more dormant open items omitted] ...")
    else:
        out.append("- (해결 기록 없이 사라진 누적 open item 없음)")

    sys.stdout.write("\n".join(out).rstrip())
    sys.stdout.write("\n")
    return 0


def unresolved_backlogs(args: argparse.Namespace) -> int:
    records = _unresolved_backlog_records(Path(args.reports_dir))
    if not records:
        sys.stdout.write("(누적 unresolved backlog 없음)\n")
        return 0

    for record in records:
        sys.stdout.write(f"- {record['title']}\n")
    return 0


def _evidence_terms(title: str) -> list[str]:
    terms: list[str] = []

    for term in re.findall(r"`([^`]{2,80})`", title):
        cleaned = term.strip()
        if cleaned and cleaned not in terms:
            terms.append(cleaned)

    without_backticks = re.sub(r"`[^`]+`", " ", title)
    for term in re.findall(r"[A-Za-z0-9_.:/-]{3,}|[가-힣]{2,}", without_backticks):
        cleaned = term.strip(".,;:()[]{}'\"")
        if cleaned and cleaned.casefold() not in {
            "README".casefold(),
            "backlog",
            "todo",
            "docs",
        } and cleaned not in terms:
            terms.append(cleaned)

    return terms[:10]


def _safe_repo_file(repo_root: Path, rel_path: str) -> Path | None:
    candidate = (repo_root / rel_path).resolve()
    try:
        candidate.relative_to(repo_root)
    except ValueError:
        return None
    return candidate


def _line_snippet(line: str, max_chars: int = 180) -> str:
    text = re.sub(r"\s+", " ", line).strip()
    if len(text) > max_chars:
        return text[: max_chars - 3].rstrip() + "..."
    return text


def _term_evidence(term: str, file_texts: dict[str, str], max_snippets: int) -> list[str]:
    needles = [term]
    if "/" in term:
        needles.extend(part.strip() for part in term.split("/") if part.strip())

    lines: list[str] = []
    seen: set[str] = set()
    for needle in needles:
        needle_key = needle.casefold()
        matches: list[str] = []
        for rel, text in file_texts.items():
            for idx, line in enumerate(text.splitlines(), start=1):
                if needle_key in line.casefold():
                    matches.append(f"{rel}:{idx}: {_line_snippet(line)}")
                    if len(matches) >= max_snippets:
                        break
            if len(matches) >= max_snippets:
                break

        if matches:
            for match in matches:
                if match not in seen:
                    lines.append(f"    - `{needle}` found: {match}")
                    seen.add(match)
        else:
            lines.append(f"    - `{needle}` not found in referenced files")

    return lines


def backlog_evidence(args: argparse.Namespace) -> int:
    reports_dir = Path(args.reports_dir)
    repo_root = Path(args.repo).resolve()
    records = _unresolved_backlog_records(reports_dir)
    if not records:
        sys.stdout.write("(누적 unresolved backlog 없음)\n")
        return 0

    max_items = max(1, int(args.max_items))
    max_bytes = max(1024, int(args.max_bytes))
    max_snippets = max(1, int(args.max_snippets))

    out: list[str] = []
    used = 0

    for record in records[:max_items]:
        title = str(record.get("title", "")).strip()
        files = [str(f).strip() for f in record.get("files") or [] if str(f).strip()]
        block: list[str] = [f"- title: {title}"]
        if files:
            block.append("  files: " + ", ".join(files[:4]))
        else:
            block.append("  files: (not recorded)")

        file_texts: dict[str, str] = {}
        for rel in files[:4]:
            path = _safe_repo_file(repo_root, rel)
            if path is None:
                block.append(f"  - {rel}: skipped unsafe path")
                continue
            if not path.exists():
                block.append(f"  - {rel}: file missing in current repo")
                continue
            if path.is_dir():
                block.append(f"  - {rel}: directory, not a text file")
                continue
            text = _read_text(path)
            if text is None:
                block.append(f"  - {rel}: unreadable or binary")
                continue
            file_texts[rel] = text

        if file_texts:
            block.append("  evidence:")
            terms = _evidence_terms(title)
            if terms:
                for term in terms:
                    block.extend(_term_evidence(term, file_texts, max_snippets))
            else:
                block.append("    - no searchable term extracted from title")
        else:
            block.append("  evidence: no referenced current text file available")

        chunk = "\n".join(block) + "\n"
        chunk_bytes = len(chunk.encode("utf-8"))
        if used + chunk_bytes > max_bytes:
            out.append("- ... [backlog evidence truncated by byte budget] ...")
            break
        out.append(chunk.rstrip())
        used += chunk_bytes

    if len(records) > max_items:
        out.append(f"- ... [{len(records) - max_items} more backlog items omitted] ...")

    sys.stdout.write("\n".join(out).rstrip())
    sys.stdout.write("\n")
    return 0


def _is_doc_candidate(root: Path, path: Path) -> bool:
    if path.name in EXCLUDED_FILENAMES:
        return False

    suffix = path.suffix.lower()
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        return False

    lower_rel = rel.lower()
    parts = lower_rel.split("/")
    if lower_rel.startswith("assets/plugins/"):
        return False
    if lower_rel.startswith("assets/textmesh pro/"):
        return False

    if suffix in {".md", ".markdown"} and "/" not in lower_rel:
        return True

    if parts[0] in {"docs", "doc", "documentation", "documents"}:
        return suffix in DOC_EXTS or suffix == ""

    return suffix in DOC_EXTS and bool(DOC_HINT_RE.search(rel))


def _read_text(path: Path) -> str | None:
    for encoding in ("utf-8-sig", "utf-8", "cp949"):
        try:
            text = path.read_text(encoding=encoding)
            return text.replace("\x00", "\ufffd")
        except (OSError, UnicodeDecodeError):
            continue
    return None


def _utf8_len(text: str) -> int:
    return len(text.encode("utf-8"))


def _take_utf8(text: str, max_bytes: int) -> str:
    return text.encode("utf-8")[:max_bytes].decode("utf-8", "ignore")


def docs_snapshot(args: argparse.Namespace) -> int:
    root = Path(args.repo).resolve()
    if not root.is_dir():
        return 0

    candidates: list[Path] = []
    for current_root, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        base = Path(current_root)
        for name in files:
            path = base / name
            if _is_doc_candidate(root, path):
                candidates.append(path)

    candidates = sorted(candidates, key=lambda p: p.relative_to(root).as_posix().lower())
    total_candidates = len(candidates)
    candidates = candidates[:DOC_FILE_LIST_MAX]

    if total_candidates == 0:
        sys.stdout.write("(현재 repo에서 문서 후보 파일을 찾지 못함)\n")
        return 0

    out: list[str] = ["문서 후보 파일 목록:"]
    for path in candidates:
        rel = path.relative_to(root).as_posix()
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        marker = "text" if path.suffix.lower() in TEXT_EXTS else "binary/list-only"
        out.append(f"- {rel} ({size} bytes, {marker})")
    if total_candidates > DOC_FILE_LIST_MAX:
        omitted = total_candidates - DOC_FILE_LIST_MAX
        out.append(f"- ... [{omitted} more document candidates omitted] ...")

    out.append("")
    out.append("텍스트 문서 본문 발췌:")

    used = _utf8_len("\n".join(out)) + 1
    max_bytes = max(0, int(args.max_bytes))
    truncated = False

    for path in candidates:
        if path.suffix.lower() not in TEXT_EXTS:
            continue

        rel = path.relative_to(root).as_posix()
        text = _read_text(path)
        if text is None:
            continue

        chunk = f"\n=== {rel} ===\n\n{text.strip()}\n"
        remaining = max_bytes - used
        if remaining <= 0:
            truncated = True
            break
        if _utf8_len(chunk) > remaining:
            out.append(_take_utf8(chunk, remaining))
            truncated = True
            break

        out.append(chunk)
        used += _utf8_len(chunk)

    if truncated:
        out.append("\n... [project docs snapshot truncated] ...")

    sys.stdout.write("\n".join(out).rstrip())
    sys.stdout.write("\n")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build review prompt context blocks")
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    previous = subparsers.add_parser("previous-items")
    previous.add_argument("report")
    previous.add_argument("field", choices=("todos", "backlogs", "resolved_from_backlog"))
    previous.set_defaults(func=previous_items)

    ledger = subparsers.add_parser("open-items")
    ledger.add_argument("reports_dir")
    ledger.add_argument("--max-items", type=int, default=240)
    ledger.set_defaults(func=open_items)

    required_backlogs = subparsers.add_parser("unresolved-backlogs")
    required_backlogs.add_argument("reports_dir")
    required_backlogs.set_defaults(func=unresolved_backlogs)

    evidence = subparsers.add_parser("backlog-evidence")
    evidence.add_argument("reports_dir")
    evidence.add_argument("repo")
    evidence.add_argument("--max-items", type=int, default=120)
    evidence.add_argument("--max-bytes", type=int, default=65536)
    evidence.add_argument("--max-snippets", type=int, default=2)
    evidence.set_defaults(func=backlog_evidence)

    docs = subparsers.add_parser("docs-snapshot")
    docs.add_argument("repo")
    docs.add_argument("--max-bytes", type=int, default=24576)
    docs.set_defaults(func=docs_snapshot)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
