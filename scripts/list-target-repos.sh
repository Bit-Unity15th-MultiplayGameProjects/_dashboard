#!/usr/bin/env bash
#
# list-target-repos.sh
#
# Org 내의 리뷰 대상 프로젝트 repo 목록을 JSON 배열로 stdout 에 출력.
#
# GitHub Actions 에서 matrix 주입에 쓰인다:
#   repos: ${{ fromJSON(steps.list.outputs.repos) }}
#
# 필터:
#   - `archived` 아님
#   - 이름이 `_` 로 시작하지 않음 (교육용/인프라 repo 제외)
#   - repo root 의 `.reviewignore` 에 나열되지 않음 (운영자 수동 제외)
#   - (fork 여부는 필터하지 않음 — 프로젝트가 template fork 하는 경우 있음)
#
# .reviewignore 포맷:
#   - 한 줄에 repo 이름 하나
#   - `#` 뒤는 주석 (줄 중간에도 허용)
#   - 빈 줄 허용
#   예:
#     # 졸업한 팀
#     project-alpha
#     project-beta  # 합치기 전 레거시
#
# 환경 변수:
#   ORG                 (필수) — GitHub org 이름
#   GH_TOKEN            (필수) — gh CLI 인증 토큰
#   GH_CMD              (선택) — 테스트용 gh 실행 경로 override. 기본 "gh".
#   REVIEWIGNORE_PATH   (선택) — .reviewignore 경로 override. 기본 "<repo-root>/.reviewignore".
#
# 사용 예:
#   ORG=Bit-Unity15th-MultiplayGameProjects \
#   GH_TOKEN=$(gh auth token) \
#   bash scripts/list-target-repos.sh
#   # → ["project-alpha","project-beta"]

set -euo pipefail

: "${ORG:?ORG env required}"
: "${GH_TOKEN:?GH_TOKEN env required}"
GH_CMD="${GH_CMD:-gh}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REVIEWIGNORE_PATH="${REVIEWIGNORE_PATH:-$ROOT_DIR/.reviewignore}"

export GH_TOKEN

# .reviewignore → JSON 배열. 파일이 없으면 빈 배열.
#   tr -d '\r' : Windows CRLF 로 저장된 파일 대응.
#   sed        : 주석(#...) 제거 + 앞뒤 공백 trim.
#   jq -R -s   : raw input 전체를 한 문자열로 받아 \n 기준으로 split.
IGNORE_JSON='[]'
if [[ -f "$REVIEWIGNORE_PATH" ]]; then
  IGNORE_JSON="$(
    tr -d '\r' < "$REVIEWIGNORE_PATH" \
      | sed -E 's/#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//' \
      | jq -R -s -c 'split("\n") | map(select(length>0))'
  )"
fi

# gh repo list 는 --limit 만큼 repo 를 가져온다. 1000 은 현재 규모에서 넉넉.
# --json 으로 필요한 필드만 요청 → API 페이로드 최소화.
"$GH_CMD" repo list "$ORG" \
  --limit 1000 \
  --json name,isArchived \
  | jq -c --argjson ignore "$IGNORE_JSON" '
      [ .[]
        | select(.isArchived == false)
        | select(.name | startswith("_") | not)
        | select(.name as $n | $ignore | index($n) | not)
        | .name
      ]
    '
