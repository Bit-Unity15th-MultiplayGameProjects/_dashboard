#!/usr/bin/env python3
"""Build compact context blocks for the review prompt.

The report prompt is intentionally generated from bounded context so the
review job does not need to run arbitrary commands inside project repos. This
helper keeps the duplicated "previous item" and "current docs" extraction logic
in one place for CI and local dry-runs.
"""
from __future__ import annotations

import argparse
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

    docs = subparsers.add_parser("docs-snapshot")
    docs.add_argument("repo")
    docs.add_argument("--max-bytes", type=int, default=24576)
    docs.set_defaults(func=docs_snapshot)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
