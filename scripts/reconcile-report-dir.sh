#!/usr/bin/env bash
#
# Reconcile reports/<repo> after a GitHub repository rename.
#
# The dashboard uses reports/<repo-name> as the content path, but GitHub repo
# names are mutable. This script keeps the path in sync with the current repo
# name while matching old report directories by stable GitHub repository id.

set -euo pipefail

REPO="${1:?usage: reconcile-report-dir.sh <repo-name>}"

: "${ORG:?ORG env required}"
: "${GH_TOKEN:?GH_TOKEN env required}"
REPORTS_DIR="${REPORTS_DIR:-reports}"
GH_CMD="${GH_CMD:-gh}"

export GH_TOKEN

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$REPORTS_DIR" = /* ]]; then
  REPORTS_ROOT="$REPORTS_DIR"
else
  REPORTS_ROOT="$ROOT_DIR/$REPORTS_DIR"
fi

mkdir -p "$REPORTS_ROOT"

emit_output() {
  local key="$1" value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  else
    printf '%s=%s\n' "$key" "$value"
  fi
}

repo_json="$("$GH_CMD" api "repos/$ORG/$REPO" 2>/dev/null)" || {
  echo "ERROR: gh api repos/$ORG/$REPO failed (access or not found)" >&2
  exit 2
}

current_id="$(jq -r '.id // "" | tostring' <<<"$repo_json")"
current_node_id="$(jq -r '.node_id // ""' <<<"$repo_json")"
current_name="$(jq -r '.name // ""' <<<"$repo_json")"
current_full_name="$(jq -r '.full_name // ""' <<<"$repo_json")"

if [[ -z "$current_id" ]]; then
  echo "ERROR: GitHub repo id missing for $ORG/$REPO" >&2
  exit 2
fi

target_dir="$REPORTS_ROOT/$REPO"
target_meta="$target_dir/.meta.json"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

meta_sources=()
matched_dirs=()
matched_names=()
changed=false

if [[ -f "$target_meta" ]]; then
  cp "$target_meta" "$tmp_dir/target.meta.json"
  meta_sources+=("$tmp_dir/target.meta.json")
fi

matches_current_repo() {
  local name="$1" meta="$2"
  local meta_id meta_node_id

  meta_id="$(jq -r '.repo_id // "" | tostring' "$meta" 2>/dev/null || echo "")"
  meta_node_id="$(jq -r '.repo_node_id // ""' "$meta" 2>/dev/null || echo "")"

  if [[ -n "$meta_id" && "$meta_id" == "$current_id" ]]; then
    return 0
  fi
  if [[ -n "$meta_node_id" && -n "$current_node_id" && "$meta_node_id" == "$current_node_id" ]]; then
    return 0
  fi

  # Do not infer legacy folders through GitHub rename redirects. Old reports
  # without repo_id may be stale or intentionally abandoned, so only explicit
  # stable identity metadata participates in automatic reconciliation.
  return 1
}

shopt -s nullglob
for meta in "$REPORTS_ROOT"/*/.meta.json; do
  dir="$(dirname "$meta")"
  name="$(basename "$dir")"
  [[ "$name" == "$REPO" ]] && continue

  if matches_current_repo "$name" "$meta"; then
    matched_dirs+=("$dir")
    matched_names+=("$name")
    safe_name="${name//[^A-Za-z0-9_.-]/_}"
    cp "$meta" "$tmp_dir/$safe_name.meta.json"
    meta_sources+=("$tmp_dir/$safe_name.meta.json")
  fi
done

move_report_file() {
  local src="$1" old_name="$2"
  local base dest stem ext i

  base="$(basename "$src")"
  dest="$target_dir/$base"

  if [[ -e "$dest" ]]; then
    if cmp -s "$src" "$dest"; then
      rm -f "$src"
      return
    fi
    stem="${base%.md}"
    ext=".md"
    dest="$target_dir/${stem}.${old_name}${ext}"
    i=2
    while [[ -e "$dest" ]]; do
      dest="$target_dir/${stem}.${old_name}.${i}${ext}"
      i=$((i + 1))
    done
  fi

  mv "$src" "$dest"
}

for old_dir in "${matched_dirs[@]}"; do
  old_name="$(basename "$old_dir")"
  if [[ ! -d "$old_dir" ]]; then
    continue
  fi

  if [[ ! -e "$target_dir" ]]; then
    mv "$old_dir" "$target_dir"
    echo "[info] moved reports/$old_name -> reports/$REPO" >&2
  else
    mkdir -p "$target_dir"
    for report in "$old_dir"/*.md; do
      [[ -e "$report" ]] || continue
      move_report_file "$report" "$old_name"
    done
    rm -f "$old_dir/.meta.json"
    rmdir "$old_dir" 2>/dev/null || true
    echo "[info] merged reports/$old_name into reports/$REPO" >&2
  fi
  changed=true
done

if (( ${#matched_dirs[@]} > 0 )); then
  mkdir -p "$target_dir"
  python3 - "$target_meta" "$target_dir" "$REPO" "$current_id" "$current_node_id" "$current_name" "$current_full_name" "${matched_names[@]}" -- "${meta_sources[@]}" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

target_meta, target_dir, repo, repo_id, node_id, repo_name, full_name, *rest = sys.argv[1:]
sep = rest.index("--")
old_names = rest[:sep]
source_paths = rest[sep + 1:]


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def parse_dt(value):
    if not isinstance(value, str) or not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


metas = [read_json(path) for path in source_paths]
metas = [m for m in metas if m]
current = read_json(target_meta)
if current:
    metas.append(current)

base = max(metas, key=lambda m: parse_dt(m.get("last_report_at"))) if metas else {}
out = dict(base)

md_count = sum(1 for name in os.listdir(target_dir) if name.endswith(".md"))

last_file = out.get("last_report_file")
if isinstance(last_file, str):
    for old in old_names:
        prefix = f"reports/{old}/"
        if last_file.startswith(prefix):
            out["last_report_file"] = f"reports/{repo}/" + last_file[len(prefix):]
            break

previous = []


def add_previous(value):
    if isinstance(value, str) and value and value != repo and value not in previous:
        previous.append(value)


for meta in metas:
    for value in meta.get("repo_previous_names") or []:
        add_previous(value)
    add_previous(meta.get("repo_name"))
for name in old_names:
    add_previous(name)

try:
    out["repo_id"] = int(repo_id)
except ValueError:
    out["repo_id"] = repo_id
out["repo_node_id"] = node_id
out["repo_name"] = repo_name or repo
out["repo_full_name"] = full_name
if previous:
    out["repo_previous_names"] = previous
out["report_count"] = md_count

with open(target_meta, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
fi

emit_output "changed" "$changed"
emit_output "repo_id" "$current_id"
emit_output "repo_node_id" "$current_node_id"
emit_output "repo_name" "${current_name:-$REPO}"
emit_output "repo_full_name" "${current_full_name:-$ORG/$REPO}"
if (( ${#matched_names[@]} > 0 )); then
  joined="$(IFS=,; echo "${matched_names[*]}")"
else
  joined=""
fi
emit_output "renamed_from" "$joined"
