#!/usr/bin/env bash
#
# check-needs-report.sh
#
# 주어진 repo 에 대해 지금 Claude 리뷰를 돌려야 하는지 판단한다.
# CLAUDE.md "업데이트 정책" 의 3단계 게이트 (+ first-report 케이스) 구현.
#
# 게이트 순서:
#   a) reports/<repo>/.meta.json 이 없음            → should_run=true, first_report=true
#   b) current_sha == last_sha                      → should_run=false
#   c) (now - last_report_at) < MIN_INTERVAL_HOURS  → should_run=false
#   d) last_sha..current_sha 커밋 수 < MIN_COMMITS  → should_run=false
#   e) 전부 통과                                    → should_run=true
#
# 출력 (GitHub Actions output 포맷, GITHUB_OUTPUT 또는 stdout):
#   should_run=<true|false>
#   current_sha=<sha>
#   last_sha=<sha or "">
#   commit_count=<int>
#   first_report=<true|false>
#   reason=<human-readable 단서>   # 디버깅용
#
# 인자:
#   $1  repo name (예: Exit-or-Die_EEN)
#
# 환경 변수:
#   ORG                 (필수)
#   GH_TOKEN            (필수)
#   MIN_INTERVAL_HOURS  (선택, 기본 6)
#   MIN_COMMITS         (선택, 기본 2)
#   REPORTS_DIR         (선택, 기본 "reports")  — 테스트 시 override
#   GH_CMD              (선택, 기본 "gh")       — 테스트 시 mock 주입
#
# 사용 예:
#   ORG=... GH_TOKEN=$(gh auth token) \
#     bash scripts/check-needs-report.sh Exit-or-Die_EEN

set -euo pipefail

REPO="${1:?usage: check-needs-report.sh <repo-name>}"

: "${ORG:?ORG env required}"
: "${GH_TOKEN:?GH_TOKEN env required}"
MIN_INTERVAL_HOURS="${MIN_INTERVAL_HOURS:-6}"
MIN_COMMITS="${MIN_COMMITS:-2}"
REPORTS_DIR="${REPORTS_DIR:-reports}"
GH_CMD="${GH_CMD:-gh}"

export GH_TOKEN

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# REPORTS_DIR 이 절대경로면 그대로, 상대경로면 ROOT_DIR 기준.
# (테스트 하니스에서 /tmp/... 같은 절대경로를 주입할 수 있도록.)
if [[ "$REPORTS_DIR" = /* ]]; then
  META_FILE="$REPORTS_DIR/$REPO/.meta.json"
else
  META_FILE="$ROOT_DIR/$REPORTS_DIR/$REPO/.meta.json"
fi

# ---- helper: 결과 emit -----------------------------------------------------

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

# ---- remote HEAD SHA 조회 --------------------------------------------------
# default branch 먼저 조회 → 해당 branch HEAD SHA.
# gh api 가 실패하면 (repo 접근 권한/존재 여부) 에러로 종료하되,
# 워크플로우 레벨에서 한 repo 실패가 전체를 망치지 않도록 exit 2 구분.

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

# ---- Gate a: meta 파일 없음 → first report --------------------------------

if [[ ! -f "$META_FILE" ]]; then
  CURRENT_SHA="$(get_remote_head)"
  emit "true" "$CURRENT_SHA" "" "0" "true" "first_report (no meta)"
  exit 0
fi

LAST_SHA="$(jq -r '.last_sha // ""' "$META_FILE")"
LAST_REPORT_AT="$(jq -r '.last_report_at // ""' "$META_FILE")"

# ---- Gate b: 원격 HEAD 가 last_sha 와 동일 → skip -------------------------

CURRENT_SHA="$(get_remote_head)"

if [[ "$CURRENT_SHA" == "$LAST_SHA" ]]; then
  emit "false" "$CURRENT_SHA" "$LAST_SHA" "0" "false" "no new commits"
  exit 0
fi

# ---- Gate c: 마지막 리포트 이후 MIN_INTERVAL_HOURS 미경과 → skip ----------

if [[ -n "$LAST_REPORT_AT" ]]; then
  HOURS_SINCE="$(
    python3 - "$LAST_REPORT_AT" <<'PY'
import sys
from datetime import datetime, timezone
last = sys.argv[1]
# ISO 8601 with offset 또는 Z
try:
    dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
except ValueError:
    print("-1")
    sys.exit(0)
now = datetime.now(timezone.utc)
delta = (now - dt).total_seconds() / 3600
print(f"{delta:.2f}")
PY
  )"

  # bc 는 CI 에 없을 수 있어 awk 로 비교
  if awk -v a="$HOURS_SINCE" -v b="$MIN_INTERVAL_HOURS" 'BEGIN{exit !(a>=0 && a < b)}'; then
    emit "false" "$CURRENT_SHA" "$LAST_SHA" "?" "false" \
      "interval gate: ${HOURS_SINCE}h < ${MIN_INTERVAL_HOURS}h"
    exit 0
  fi
fi

# ---- Gate d: last_sha..current_sha 커밋 수가 MIN_COMMITS 미만 → skip ------
# GitHub compare API 의 total_commits 사용 (커밋 수만 알면 됨).
# compare 는 last_sha 가 현재 tree 에 존재해야 함; force-push 등으로 사라졌으면
# API 가 실패할 수 있다 → 이 경우 안전하게 should_run=true 로 fallback.

COMMIT_COUNT="$(
  "$GH_CMD" api "repos/$ORG/$REPO/compare/$LAST_SHA...$CURRENT_SHA" \
    --jq '.total_commits' 2>/dev/null || echo ""
)"

if [[ -z "$COMMIT_COUNT" ]]; then
  emit "true" "$CURRENT_SHA" "$LAST_SHA" "0" "false" \
    "compare api failed (force-push?), forcing should_run=true"
  exit 0
fi

if (( COMMIT_COUNT < MIN_COMMITS )); then
  emit "false" "$CURRENT_SHA" "$LAST_SHA" "$COMMIT_COUNT" "false" \
    "commit_count gate: $COMMIT_COUNT < $MIN_COMMITS"
  exit 0
fi

# ---- Gate e: 통과 ----------------------------------------------------------

emit "true" "$CURRENT_SHA" "$LAST_SHA" "$COMMIT_COUNT" "false" \
  "all gates passed"
