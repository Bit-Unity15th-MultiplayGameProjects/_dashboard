#!/usr/bin/env bash
#
# run-claude-review.sh
#
# 타겟 repo 를 clone → commit log / diff stat / diff content 를 뽑아
# review-prompt.md 에 치환해 최종 프롬프트 파일을 만든다.
# 최종 파일 경로를 stdout 에 한 줄로 출력 (workflow 에서 Claude 호출 시 사용).
#
# 인자:
#   $1  repo name          (예: Exit-or-Die_EEN)
#   $2  from_sha           (빈 문자열 또는 "INITIAL" 허용 → first report)
#   $3  to_sha             (보통 default branch HEAD)
#
# 환경 변수:
#   ORG               (필수)
#   GH_TOKEN          (필수; HTTPS clone 인증용)
#   MAX_DIFF_BYTES    (선택, 기본 102400=100KB)
#   MAX_DIFF_LINES    (선택, 기본 3000)    — diff 줄 수 하드 리밋
#   TARGET_DIR        (선택, 기본 "target-repo")  — clone 경로
#   OUTPUT_PATH       (선택, 기본 "/tmp/final-prompt.md")
#   KEEP_TARGET       (선택, "1" 이면 clone 디렉토리 유지 — 디버깅용)
#
# 사용 예:
#   ORG=... GH_TOKEN=$(gh auth token) \
#     bash scripts/run-claude-review.sh Exit-or-Die_EEN a1b2c3d f1e2d3c
#   # stdout: /tmp/final-prompt.md

set -euo pipefail

REPO="${1:?usage: run-claude-review.sh <repo> <from_sha> <to_sha>}"
FROM_SHA="${2:-}"
TO_SHA="${3:?to_sha required}"

: "${ORG:?ORG env required}"
: "${GH_TOKEN:?GH_TOKEN env required}"
MAX_DIFF_BYTES="${MAX_DIFF_BYTES:-102400}"
MAX_DIFF_LINES="${MAX_DIFF_LINES:-3000}"
TARGET_DIR="${TARGET_DIR:-target-repo}"
OUTPUT_PATH="${OUTPUT_PATH:-/tmp/final-prompt.md}"
KEEP_TARGET="${KEEP_TARGET:-0}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/review-prompt.md"
META_FILE="$ROOT_DIR/reports/$REPO/.meta.json"

[[ -f "$TEMPLATE" ]] || { echo "ERROR: template missing: $TEMPLATE" >&2; exit 1; }

cleanup() {
  if [[ "$KEEP_TARGET" != "1" ]]; then
    rm -rf "$TARGET_DIR"
  fi
}
trap cleanup EXIT

# ---- clone -----------------------------------------------------------------
# HTTPS + token 으로 clone. --filter=blob:none 은 blob 을 lazy-fetch 하여
# 초기 전송량을 줄이지만, 이후 git log/diff 가 필요할 때 추가 fetch 가 발생한다.
# 단순성을 위해 그냥 full clone 하되 --depth 는 FROM_SHA 가 없거나 INITIAL 인
# 경우에만 얕게. 있는 경우엔 FROM_SHA 가 history 에 존재해야 하므로 full.

AUTHED_URL="https://x-access-token:${GH_TOKEN}@github.com/${ORG}/${REPO}.git"

rm -rf "$TARGET_DIR"

if [[ -z "$FROM_SHA" || "$FROM_SHA" == "INITIAL" ]]; then
  echo "[info] first report — shallow clone (depth=50)" >&2
  git clone --quiet --depth=50 "$AUTHED_URL" "$TARGET_DIR"
else
  # full clone. 수강생 repo 규모상 대부분 수 MB 이하라 감당 가능.
  echo "[info] full clone for range $FROM_SHA..$TO_SHA" >&2
  git clone --quiet "$AUTHED_URL" "$TARGET_DIR"

  # FROM_SHA 가 실제로 히스토리에 있는지 확인; 없으면 first-report 로 강등.
  if ! git -C "$TARGET_DIR" cat-file -e "$FROM_SHA" 2>/dev/null; then
    echo "WARN: from_sha=$FROM_SHA not found in clone; treating as first report" >&2
    FROM_SHA=""
  fi
fi

# ---- 커밋 범위 결정 --------------------------------------------------------

if [[ -z "$FROM_SHA" ]]; then
  # first report: TO_SHA 이전 최대 30 커밋 (history 부족하면 root 부터).
  # frontmatter commit_range 는 Astro zod regex `^[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$`
  # 를 통과해야 하므로 `TO_SHA~30` 같은 symbolic ref 는 반드시 SHA 로 resolve.
  TOTAL="$(git -C "$TARGET_DIR" rev-list --count "$TO_SHA" 2>/dev/null || echo 0)"
  if (( TOTAL > 30 )); then
    FROM_RESOLVED="$(git -C "$TARGET_DIR" rev-parse "$TO_SHA~30")"
  else
    FROM_RESOLVED="$(git -C "$TARGET_DIR" rev-list --max-parents=0 "$TO_SHA" | head -1)"
  fi
  COMMIT_RANGE="$FROM_RESOLVED..$TO_SHA"
else
  COMMIT_RANGE="$FROM_SHA..$TO_SHA"
fi

echo "[info] commit_range: $COMMIT_RANGE" >&2

COMMIT_COUNT="$(git -C "$TARGET_DIR" rev-list --count "$COMMIT_RANGE" 2>/dev/null || echo 0)"
COMMIT_LOG="$(git -C "$TARGET_DIR" log --oneline "$COMMIT_RANGE" 2>/dev/null || true)"
DIFF_STAT="$(git -C "$TARGET_DIR" diff --stat "$COMMIT_RANGE" 2>/dev/null || true)"

# ---- diff 추출 + 크기 제한 -------------------------------------------------
# 1) full diff 시도
# 2) byte / line 둘 중 하나라도 초과하면 상위 변경 파일 위주로 샘플링
#    - diff --stat 에서 변경량 많은 순서로 파일 목록을 얻고
#    - 바이트 budget 이 남는 동안 파일별 diff 를 쌓음

FULL_DIFF="$(git -C "$TARGET_DIR" diff "$COMMIT_RANGE" 2>/dev/null || true)"
FULL_BYTES="$(printf '%s' "$FULL_DIFF" | wc -c | awk '{print $1}')"
FULL_LINES="$(printf '%s\n' "$FULL_DIFF" | wc -l | awk '{print $1}')"

if (( FULL_BYTES <= MAX_DIFF_BYTES )) && (( FULL_LINES <= MAX_DIFF_LINES )); then
  DIFF_CONTENT="$FULL_DIFF"
  echo "[info] diff within budget ($FULL_BYTES B, $FULL_LINES lines)" >&2
else
  echo "[info] diff over budget (${FULL_BYTES}B / ${FULL_LINES} lines) — sampling top files" >&2

  # `git diff --numstat` 로 (added, removed, path) 얻고 총 변경량 기준 정렬
  mapfile -t SORTED_FILES < <(
    git -C "$TARGET_DIR" diff --numstat "$COMMIT_RANGE" \
      | awk '{
          a = ($1 == "-") ? 0 : $1
          d = ($2 == "-") ? 0 : $2
          print (a + d) "\t" $3
        }' \
      | sort -rn \
      | cut -f2-
  )

  SAMPLE=""
  BYTES_LEFT="$MAX_DIFF_BYTES"
  INCLUDED=0
  SKIPPED=0

  for f in "${SORTED_FILES[@]}"; do
    # 파일별 diff 를 추출 (단일 -- <path> 한정)
    FILE_DIFF="$(git -C "$TARGET_DIR" diff "$COMMIT_RANGE" -- "$f" 2>/dev/null || true)"
    FBYTES="$(printf '%s' "$FILE_DIFF" | wc -c | awk '{print $1}')"

    if (( FBYTES == 0 )); then
      continue
    fi

    # 한 파일이 단독으로 예산을 넘기면 그 파일의 상단만 잘라 포함
    if (( FBYTES > BYTES_LEFT )); then
      if (( BYTES_LEFT > 2048 )); then
        FILE_DIFF_TRUNC="$(printf '%s' "$FILE_DIFF" | head -c "$BYTES_LEFT")
... [truncated: single-file diff exceeded budget] ..."
        SAMPLE+=$'\n'"$FILE_DIFF_TRUNC"
        BYTES_LEFT=0
        INCLUDED=$((INCLUDED + 1))
        break
      else
        SKIPPED=$((SKIPPED + 1))
        continue
      fi
    fi

    SAMPLE+=$'\n'"$FILE_DIFF"
    BYTES_LEFT=$((BYTES_LEFT - FBYTES))
    INCLUDED=$((INCLUDED + 1))
  done

  DIFF_CONTENT="$SAMPLE
... [diff sampled: ${INCLUDED} files included, ${SKIPPED} skipped; see git diff --stat for full picture] ..."
fi

# ---- 이전 리포트 날짜 ------------------------------------------------------

if [[ -f "$META_FILE" ]]; then
  LAST_REPORT_DATE="$(jq -r '.last_report_at // "없음"' "$META_FILE")"
else
  LAST_REPORT_DATE="없음"
fi

# ---- 템플릿 치환 -----------------------------------------------------------

mkdir -p "$(dirname "$OUTPUT_PATH")"

PROJECT_NAME="$REPO" \
COMMIT_RANGE="$COMMIT_RANGE" \
COMMIT_COUNT="$COMMIT_COUNT" \
COMMIT_LOG="$COMMIT_LOG" \
DIFF_STAT="$DIFF_STAT" \
DIFF_CONTENT="$DIFF_CONTENT" \
LAST_REPORT_DATE="$LAST_REPORT_DATE" \
python3 - "$TEMPLATE" "$OUTPUT_PATH" <<'PY'
import os, sys, re
src, dst = sys.argv[1], sys.argv[2]
with open(src, "r", encoding="utf-8") as f:
    tmpl = f.read()
# 상단 HTML 주석 블록 strip (휴먼용 메모 — Claude 에겐 보내지 않음)
tmpl = re.sub(r"^\s*<!--.*?-->\s*", "", tmpl, count=1, flags=re.DOTALL)

# 수강생이 직접 통제 가능한 필드: 경계 태그를 위조/탈출하는 시도 차단.
# <student_content> / </student_content> 의 대소문자·공백 변형 모두 치환.
STUDENT_CONTROLLED = {"COMMIT_LOG", "DIFF_STAT", "DIFF_CONTENT"}
BOUNDARY_TAG_RE = re.compile(r"<\s*/?\s*student_content\s*>", re.IGNORECASE)

for key in (
    "PROJECT_NAME", "COMMIT_RANGE", "COMMIT_COUNT",
    "COMMIT_LOG", "DIFF_STAT", "DIFF_CONTENT", "LAST_REPORT_DATE",
):
    value = os.environ.get(key, "")
    if key in STUDENT_CONTROLLED:
        value = BOUNDARY_TAG_RE.sub("⟨boundary-filtered⟩", value)
    tmpl = tmpl.replace("{{" + key + "}}", value)
leftovers = set(re.findall(r"\{\{([A-Z_]+)\}\}", tmpl))
if leftovers:
    print(f"ERROR: un-substituted vars: {sorted(leftovers)}", file=sys.stderr)
    sys.exit(3)
with open(dst, "w", encoding="utf-8") as f:
    f.write(tmpl)
PY

echo "[info] prompt written: $OUTPUT_PATH ($(wc -c <"$OUTPUT_PATH") bytes)" >&2

# stdout 은 오직 경로 한 줄
printf '%s\n' "$OUTPUT_PATH"
