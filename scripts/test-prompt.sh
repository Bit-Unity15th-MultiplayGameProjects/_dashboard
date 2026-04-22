#!/usr/bin/env bash
#
# test-prompt.sh — 리뷰 프롬프트를 로컬에서 시험 실행하는 디버깅 스크립트.
#
# 사용 예:
#   ./scripts/test-prompt.sh                        # Exit-or-Die_EEN, dry-run (claude 호출 안함)
#   ./scripts/test-prompt.sh Exit-or-Die_EEN        # 동일
#   ./scripts/test-prompt.sh Exit-or-Die_EEN --run  # 실제 claude CLI 호출
#   ./scripts/test-prompt.sh Exit-or-Die_EEN --run --range HEAD~10..HEAD
#   ./scripts/test-prompt.sh --repo /path/to/local  # org clone 대신 로컬 repo 사용
#
# 환경변수:
#   ORG              - org 이름 (기본: Bit-Unity15th-MultiplayGameProjects)
#   MAX_DIFF_LINES   - DIFF_CONTENT 에 포함할 최대 줄 수 (기본: 2000, 초과 시 truncate)
#   CLAUDE_BIN       - claude CLI 경로 (기본: $(which claude))
#
# CI 환경에서 실제 리포트 생성은 이 스크립트 대신 run-claude-review.sh 를 사용한다.
# 이 파일은 어디까지나 **로컬 디버깅용** 이다.

set -euo pipefail

# ---- 인자 파싱 ------------------------------------------------------------

PROJECT_NAME="Exit-or-Die_EEN"
RUN_CLAUDE=0
RANGE_OVERRIDE=""
LOCAL_REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      RUN_CLAUDE=1
      shift
      ;;
    --range)
      RANGE_OVERRIDE="$2"
      shift 2
      ;;
    --repo)
      LOCAL_REPO="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      PROJECT_NAME="$1"
      shift
      ;;
  esac
done

ORG="${ORG:-Bit-Unity15th-MultiplayGameProjects}"
MAX_DIFF_LINES="${MAX_DIFF_LINES:-2000}"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/review-prompt.md"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: prompt template not found at $TEMPLATE" >&2
  exit 1
fi

# ---- 대상 repo 준비 -------------------------------------------------------

if [[ -n "$LOCAL_REPO" ]]; then
  REPO_DIR="$LOCAL_REPO"
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    echo "ERROR: $REPO_DIR is not a git repo" >&2
    exit 1
  fi
  echo "[info] using local repo: $REPO_DIR" >&2
else
  CACHE_DIR="${TMPDIR:-/tmp}/bit-unity15th-dashboard-cache"
  mkdir -p "$CACHE_DIR"
  REPO_DIR="$CACHE_DIR/$PROJECT_NAME"

  if [[ -d "$REPO_DIR/.git" ]]; then
    echo "[info] updating cached repo: $REPO_DIR" >&2
    git -C "$REPO_DIR" fetch --quiet origin || {
      echo "WARN: fetch failed — proceeding with local HEAD" >&2
    }
  else
    REMOTE="https://github.com/$ORG/$PROJECT_NAME.git"
    echo "[info] cloning $REMOTE → $REPO_DIR" >&2
    git clone --quiet "$REMOTE" "$REPO_DIR" || {
      echo "ERROR: clone failed. Repo may not exist yet, or auth required." >&2
      echo "       Use --repo /path/to/local to test against a local clone." >&2
      exit 1
    }
  fi
fi

# ---- 커밋 범위 결정 -------------------------------------------------------

META_FILE="$ROOT_DIR/reports/$PROJECT_NAME/.meta.json"
LAST_SHA=""
LAST_REPORT_DATE="없음"
LAST_REPORT_FILE=""

if [[ -f "$META_FILE" ]]; then
  LAST_SHA="$(
    python3 -c "import json,sys; d=json.load(open('$META_FILE')); print(d.get('last_sha',''))"
  )"
  LAST_REPORT_DATE="$(
    python3 -c "import json; d=json.load(open('$META_FILE')); print(d.get('last_report_at','없음'))"
  )"
  LAST_REPORT_FILE="$(
    python3 -c "import json; d=json.load(open('$META_FILE')); print(d.get('last_report_file',''))"
  )"
fi

# ---- 이전 backlog 추출 ----------------------------------------------------

PREVIOUS_BACKLOG="(첫 리포트이거나 이전 리포트에 backlog 기록이 없음)"
if [[ -n "$LAST_REPORT_FILE" && -f "$ROOT_DIR/$LAST_REPORT_FILE" ]]; then
  EXTRACTED="$(
    python3 - "$ROOT_DIR/$LAST_REPORT_FILE" <<'PY'
import re, sys
try:
    import yaml
except ImportError:
    sys.exit(0)
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        content = f.read()
except OSError:
    sys.exit(0)
m = re.match(r"^\s*---\n(.*?)\n---", content, re.DOTALL)
if not m:
    sys.exit(0)
try:
    fm = yaml.safe_load(m.group(1)) or {}
except yaml.YAMLError:
    sys.exit(0)
for item in fm.get("backlogs") or []:
    if isinstance(item, str):
        print(f"- {item}")
PY
  )"
  if [[ -n "$EXTRACTED" ]]; then
    PREVIOUS_BACKLOG="$EXTRACTED"
  fi
fi

# ---- _sample/docs rubric (로컬 캐시가 있으면 사용) -----------------------
# 로컬 dry-run 은 굳이 clone 하지 않고 fallback. CI (run-claude-review.sh) 는
# 매 run 얕은 clone 으로 최신 rubric 을 보장.

SAMPLE_DOCS_REFERENCE="(로컬 dry-run — _sample/docs rubric 생략. CI 에서는 매 run fetch)"
SAMPLE_CACHE="${TMPDIR:-/tmp}/bit-unity15th-dashboard-cache/_sample"
if [[ -d "$SAMPLE_CACHE/docs" ]]; then
  SAMPLE_CONTENT="$(
    find "$SAMPLE_CACHE/docs" -name '*.md' -type f 2>/dev/null \
      | while IFS= read -r f; do
          printf '\n=== %s ===\n\n' "${f#"$SAMPLE_CACHE/docs/"}"
          cat "$f"
        done \
      | head -c 8192
  )"
  if [[ -n "$SAMPLE_CONTENT" ]]; then
    SAMPLE_DOCS_REFERENCE="$SAMPLE_CONTENT"
    echo "[info] using cached _sample/docs from $SAMPLE_CACHE" >&2
  fi
fi

if [[ -n "$RANGE_OVERRIDE" ]]; then
  COMMIT_RANGE="$RANGE_OVERRIDE"
else
  # Astro zod commit_range 는 `<sha>..<sha>` (7–40 hex 양쪽) 만 허용.
  # HEAD / HEAD~N / 브랜치명 같은 symbolic ref 는 반드시 SHA 로 resolve.
  TO_RESOLVED="$(git -C "$REPO_DIR" rev-parse HEAD)"
  if [[ -n "$LAST_SHA" ]] && git -C "$REPO_DIR" cat-file -e "$LAST_SHA" 2>/dev/null; then
    FROM_RESOLVED="$LAST_SHA"
  else
    # meta 가 없거나 sha 가 repo 에 없으면 최근 20 커밋 기본
    if [[ $(git -C "$REPO_DIR" rev-list --count HEAD) -gt 20 ]]; then
      FROM_RESOLVED="$(git -C "$REPO_DIR" rev-parse HEAD~20)"
    else
      FROM_RESOLVED="$(git -C "$REPO_DIR" rev-list --max-parents=0 HEAD | head -1)"
    fi
  fi
  COMMIT_RANGE="$FROM_RESOLVED..$TO_RESOLVED"
fi

echo "[info] commit_range: $COMMIT_RANGE" >&2

# ---- 변수 수집 ------------------------------------------------------------

COMMIT_COUNT="$(git -C "$REPO_DIR" rev-list --count "$COMMIT_RANGE" 2>/dev/null || echo "0")"
COMMIT_LOG="$(git -C "$REPO_DIR" log --oneline "$COMMIT_RANGE" 2>/dev/null || true)"
DIFF_STAT="$(git -C "$REPO_DIR" diff --stat "$COMMIT_RANGE" 2>/dev/null || true)"
DIFF_RAW="$(git -C "$REPO_DIR" diff "$COMMIT_RANGE" 2>/dev/null || true)"

# diff 너무 길면 truncate
DIFF_LINES="$(printf '%s\n' "$DIFF_RAW" | wc -l)"
if (( DIFF_LINES > MAX_DIFF_LINES )); then
  DIFF_CONTENT="$(printf '%s\n' "$DIFF_RAW" | head -n "$MAX_DIFF_LINES")
... [truncated: $((DIFF_LINES - MAX_DIFF_LINES)) more lines] ..."
else
  DIFF_CONTENT="$DIFF_RAW"
fi

if [[ "$COMMIT_COUNT" == "0" ]]; then
  echo "WARN: commit_count is 0. COMMIT_RANGE=$COMMIT_RANGE might be invalid." >&2
fi

# ---- 템플릿 치환 ----------------------------------------------------------
# 각 변수는 Python 을 써서 안전하게 치환 (sed 는 특수문자 escape 지옥).

FILLED_PROMPT="$(
  PROJECT_NAME="$PROJECT_NAME" \
  COMMIT_RANGE="$COMMIT_RANGE" \
  COMMIT_COUNT="$COMMIT_COUNT" \
  COMMIT_LOG="$COMMIT_LOG" \
  DIFF_STAT="$DIFF_STAT" \
  DIFF_CONTENT="$DIFF_CONTENT" \
  LAST_REPORT_DATE="$LAST_REPORT_DATE" \
  PREVIOUS_BACKLOG="$PREVIOUS_BACKLOG" \
  SAMPLE_DOCS_REFERENCE="$SAMPLE_DOCS_REFERENCE" \
  python3 - "$TEMPLATE" <<'PY'
import os, sys, re
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    tmpl = f.read()
# 파일 상단의 human-only 주석 블록 (<!-- ... -->) 제거.
# 변수 placeholder 를 설명하는 주석이 Claude 에게도 같이 전달되면 혼란 유발.
tmpl = re.sub(r"^\s*<!--.*?-->\s*", "", tmpl, count=1, flags=re.DOTALL)
for key in (
    "PROJECT_NAME", "COMMIT_RANGE", "COMMIT_COUNT",
    "COMMIT_LOG", "DIFF_STAT", "DIFF_CONTENT", "LAST_REPORT_DATE",
    "PREVIOUS_BACKLOG", "SAMPLE_DOCS_REFERENCE",
):
    tmpl = tmpl.replace("{{" + key + "}}", os.environ.get(key, ""))
# 남아있는 {{FOO}} 가 있으면 경고 (치환 누락)
leftovers = set(re.findall(r"\{\{([A-Z_]+)\}\}", tmpl))
if leftovers:
    print(f"WARN: un-substituted vars: {sorted(leftovers)}", file=sys.stderr)
sys.stdout.write(tmpl)
PY
)"

# ---- 출력 or Claude 호출 --------------------------------------------------

if [[ "$RUN_CLAUDE" -eq 0 ]]; then
  echo "[info] dry-run: printing substituted prompt (no Claude call)." >&2
  echo "[info] rerun with --run to actually call claude CLI." >&2
  printf '%s\n' "$FILLED_PROMPT"
  exit 0
fi

if [[ -z "$CLAUDE_BIN" ]]; then
  echo "ERROR: claude CLI not found. Install Claude Code, or set CLAUDE_BIN." >&2
  exit 1
fi

echo "[info] calling $CLAUDE_BIN -p (headless)" >&2

TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT
printf '%s\n' "$FILLED_PROMPT" | "$CLAUDE_BIN" -p --output-format text --model claude-opus-4-7 > "$TMP_OUT"

# 출력 스키마 + secret 정합성 체크. 로컬 디버깅용이므로 실패해도 출력은
# 그대로 stdout 으로 내보내고 --strict 는 붙이지 않는다.
# 동일 validator 가 generate-reports.yml 에서는 --strict 로 cell 을 실패시킨다.
python3 "$SCRIPT_DIR/validate-report.py" "$TMP_OUT" --project "$PROJECT_NAME" || true

cat "$TMP_OUT"
