#!/usr/bin/env bash
#
# check-needs-report.sh
#
# Decide whether a target repo should get a Codex report now.
#
# Gates:
#   a) reports/<repo>/.meta.json is missing       -> should_run=true
#   b) current_sha == last_sha                    -> should_run=false
#   c) automatic burst limit is active            -> should_run=false
#   d) any commit change                          -> should_run=true
#
# Burst limit:
#   If REPORT_RATE_MAX reports are published within REPORT_RATE_WINDOW_HOURS,
#   automatic generation is blocked until REPORT_RATE_COOLDOWN_HOURS after the
#   timestamp of the Nth report in that burst. Manual workflow runs with
#   force=true bypass this script in generate-reports.yml.
#
# Output (GitHub Actions output format, or stdout):
#   should_run=<true|false>
#   current_sha=<sha>
#   last_sha=<sha or "">
#   commit_count=<int or ?>
#   first_report=<true|false>
#   reason=<human-readable summary>
#
# Args:
#   $1  repo name, e.g. Exit-or-die
#
# Environment:
#   ORG                         required GitHub org name
#   GH_TOKEN                    required gh CLI token
#   REPORTS_DIR                 optional, default "reports"
#   GH_CMD                      optional, default "gh"
#   REPORT_RATE_WINDOW_HOURS    optional, default 1
#   REPORT_RATE_MAX             optional, default 5
#   REPORT_RATE_COOLDOWN_HOURS  optional, default 3

set -euo pipefail

REPO="${1:?usage: check-needs-report.sh <repo-name>}"

: "${ORG:?ORG env required}"
: "${GH_TOKEN:?GH_TOKEN env required}"
REPORTS_DIR="${REPORTS_DIR:-reports}"
GH_CMD="${GH_CMD:-gh}"
REPORT_RATE_WINDOW_HOURS="${REPORT_RATE_WINDOW_HOURS:-1}"
REPORT_RATE_MAX="${REPORT_RATE_MAX:-5}"
REPORT_RATE_COOLDOWN_HOURS="${REPORT_RATE_COOLDOWN_HOURS:-3}"

export GH_TOKEN

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ "$REPORTS_DIR" = /* ]]; then
  REPORT_REPO_DIR="$REPORTS_DIR/$REPO"
else
  REPORT_REPO_DIR="$ROOT_DIR/$REPORTS_DIR/$REPO"
fi
META_FILE="$REPORT_REPO_DIR/.meta.json"

emit() {
  local should_run="$1" current_sha="$2" last_sha="$3"
  local commit_count="$4" first_report="$5" reason="$6"

  {
    echo "should_run=$should_run"
    echo "current_sha=$current_sha"
    echo "last_sha=$last_sha"
    echo "commit_count=$commit_count"
    echo "first_report=$first_report"
    echo "reason=$reason"
  } | if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        cat >> "$GITHUB_OUTPUT"
      else
        cat
      fi
}

get_remote_head() {
  local default_branch
  default_branch="$(
    "$GH_CMD" api "repos/$ORG/$REPO" --jq '.default_branch' 2>/dev/null
  )" || {
    echo "ERROR: gh api repos/$ORG/$REPO failed (access or not found)" >&2
    exit 2
  }

  "$GH_CMD" api "repos/$ORG/$REPO/commits/$default_branch" --jq '.sha' 2>/dev/null || {
    echo "ERROR: failed to read HEAD of $default_branch on $ORG/$REPO" >&2
    exit 2
  }
}

get_commit_count() {
  local last_sha="$1" current_sha="$2"

  "$GH_CMD" api "repos/$ORG/$REPO/compare/$last_sha...$current_sha" \
    --jq '.total_commits' 2>/dev/null || echo ""
}

read_rate_limit_state() {
  local meta_arg="$META_FILE"
  local report_dir_arg="$REPORT_REPO_DIR"

  if command -v cygpath >/dev/null 2>&1; then
    meta_arg="$(cygpath -w "$META_FILE")"
    report_dir_arg="$(cygpath -w "$REPORT_REPO_DIR")"
  fi

  python3 - "$meta_arg" "$report_dir_arg" \
    "$REPORT_RATE_WINDOW_HOURS" "$REPORT_RATE_MAX" "$REPORT_RATE_COOLDOWN_HOURS" <<'PY'
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

meta_path = Path(sys.argv[1])
report_dir = Path(sys.argv[2])
window_hours = float(sys.argv[3])
max_reports = int(sys.argv[4])
cooldown_hours = float(sys.argv[5])

now = datetime.now(timezone.utc)


def to_utc(dt):
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0)


def parse_timestamp(raw):
    if not raw:
        return None

    value = str(raw).strip()
    if not value:
        return None

    if value.endswith(".md"):
        value = Path(value).stem

    match = re.match(r"^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z$", value)
    if match:
        date, hour, minute, second = match.groups()
        return datetime.fromisoformat(
            f"{date}T{hour}:{minute}:{second}+00:00"
        ).astimezone(timezone.utc)

    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        return to_utc(datetime.fromisoformat(normalized))
    except ValueError:
        return None


timestamps = []

try:
    meta = json.loads(meta_path.read_text(encoding="utf-8-sig"))
except FileNotFoundError:
    meta = {}
except json.JSONDecodeError:
    meta = {}

for item in meta.get("recent_report_ats") or []:
    parsed = parse_timestamp(item)
    if parsed is not None:
        timestamps.append(parsed)

parsed = parse_timestamp(meta.get("last_report_at"))
if parsed is not None:
    timestamps.append(parsed)

if report_dir.is_dir():
    for path in report_dir.glob("*.md"):
        parsed = parse_timestamp(path.name)
        if parsed is not None:
            timestamps.append(parsed)

timestamps = sorted(set(timestamps))
block_until = None
burst_count = 0

if max_reports > 0 and len(timestamps) >= max_reports:
    window = timedelta(hours=window_hours)
    cooldown = timedelta(hours=cooldown_hours)

    for start_index in range(0, len(timestamps) - max_reports + 1):
        first = timestamps[start_index]
        nth = timestamps[start_index + max_reports - 1]
        if nth - first <= window:
            candidate_until = nth + cooldown
            if now < candidate_until and (
                block_until is None or candidate_until > block_until
            ):
                block_until = candidate_until
                burst_count = sum(1 for ts in timestamps if first <= ts <= nth)

if block_until is None:
    print("blocked=false")
    print("blocked_until=")
    print("burst_count=0")
else:
    print("blocked=true")
    print(f"blocked_until={block_until.isoformat(timespec='seconds')}")
    print(f"burst_count={burst_count}")
PY
}

CURRENT_SHA="$(get_remote_head)"

if [[ ! -f "$META_FILE" ]]; then
  emit "true" "$CURRENT_SHA" "" "0" "true" "first_report (no meta)"
  exit 0
fi

LAST_SHA="$(jq -r '.last_sha // ""' "$META_FILE")"

if [[ "$CURRENT_SHA" == "$LAST_SHA" ]]; then
  emit "false" "$CURRENT_SHA" "$LAST_SHA" "0" "false" "no new commits"
  exit 0
fi

COMMIT_COUNT="$(get_commit_count "$LAST_SHA" "$CURRENT_SHA")"
COMPARE_FAILED=false
if [[ -z "$COMMIT_COUNT" ]]; then
  COMMIT_COUNT="0"
  COMPARE_FAILED=true
fi

RATE_BLOCKED=false
RATE_BLOCKED_UNTIL=""
RATE_BURST_COUNT=0
RATE_OUTPUT="$(read_rate_limit_state)" || {
  echo "ERROR: rate limit evaluator failed" >&2
  exit 2
}
while IFS='=' read -r key value; do
  case "$key" in
    blocked) RATE_BLOCKED="$value" ;;
    blocked_until) RATE_BLOCKED_UNTIL="$value" ;;
    burst_count) RATE_BURST_COUNT="$value" ;;
  esac
done <<< "$RATE_OUTPUT"

if [[ "$RATE_BLOCKED" == "true" ]]; then
  emit "false" "$CURRENT_SHA" "$LAST_SHA" "$COMMIT_COUNT" "false" \
    "rate_limit gate: ${RATE_BURST_COUNT} reports within ${REPORT_RATE_WINDOW_HOURS}h; blocked until ${RATE_BLOCKED_UNTIL} (manual force bypass)"
  exit 0
fi

if [[ "$COMPARE_FAILED" == "true" ]]; then
  emit "true" "$CURRENT_SHA" "$LAST_SHA" "$COMMIT_COUNT" "false" \
    "compare api failed (force-push?), forcing should_run=true"
  exit 0
fi

emit "true" "$CURRENT_SHA" "$LAST_SHA" "$COMMIT_COUNT" "false" \
  "commit change detected"
