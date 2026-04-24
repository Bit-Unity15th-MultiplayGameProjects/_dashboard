#!/usr/bin/env bash
#
# backfill-meta-fields.sh
#
# 기존 .meta.json 에 없던 `last_commit_at` / `contributors` 를 GitHub API 로
# 채워 넣는 1회성 스크립트. 파이프라인은 다음 리포트 생성 때 자동으로 덮어쓰므로
# 이 backfill 은 지금 당장 대시보드에 값이 보이게 하기 위한 것.
#
# Codex 호출 비용 없음 (순수 GitHub REST API). gh CLI 인증 필요.
#
# 실행: ORG=Bit-Unity15th-MultiplayGameProjects bash scripts/backfill-meta-fields.sh
#       (기본 ORG 값 내장되어 있어 env 생략해도 됨)
#
# 주의: 파이프라인은 contributor 로 git author 실명(`git shortlog %aN`)을,
# 이 backfill 은 GitHub login 을 사용한다 (commits API 페이징 없이 한 번에
# 뽑는 유일한 경로가 /contributors 라 login 기반). 다음 정기 리뷰가 돌면
# 실명으로 자연스럽게 덮어써진다.

set -euo pipefail

ORG="${ORG:-Bit-Unity15th-MultiplayGameProjects}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

command -v gh >/dev/null || { echo "gh CLI required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }

updated=0
skipped=0
failed=0

for meta in "$ROOT_DIR"/reports/*/.meta.json; do
  [[ -f "$meta" ]] || continue
  repo="$(basename "$(dirname "$meta")")"

  # 이미 채워졌는지 검사 (python).
  has_both="$(
    META_FILE="$meta" python3 -c '
import json, os
with open(os.environ["META_FILE"], encoding="utf-8") as f:
    m = json.load(f)
print("true" if ("last_commit_at" in m and "contributors" in m) else "false")
'
  )"
  if [[ "$has_both" == "true" ]]; then
    echo "[skip] $repo (already populated)" >&2
    skipped=$((skipped + 1))
    continue
  fi

  echo "[fetch] $repo" >&2
  if ! default_branch="$(gh api "repos/${ORG}/${repo}" --jq '.default_branch' 2>/dev/null)"; then
    echo "  [warn] failed to fetch repo meta — skipping" >&2
    failed=$((failed + 1))
    continue
  fi

  last_at="$(
    gh api "repos/${ORG}/${repo}/commits/${default_branch}" \
      --jq '.commit.committer.date' 2>/dev/null || echo ""
  )"
  contributors_json="$(
    gh api "repos/${ORG}/${repo}/contributors?per_page=100" \
      --jq '[.[] | .login]' 2>/dev/null || echo "[]"
  )"

  if [[ -z "$last_at" ]]; then
    echo "  [warn] empty last_commit_at — skipping" >&2
    failed=$((failed + 1))
    continue
  fi

  META_FILE="$meta" LAST_AT="$last_at" CONTRIBUTORS_JSON="$contributors_json" \
    python3 -c '
import json, os
meta_path = os.environ["META_FILE"]
with open(meta_path, encoding="utf-8") as f:
    m = json.load(f)
m["last_commit_at"] = os.environ["LAST_AT"]
m["contributors"] = json.loads(os.environ["CONTRIBUTORS_JSON"] or "[]")
with open(meta_path, "w", encoding="utf-8") as f:
    json.dump(m, f, ensure_ascii=False, indent=2)
    f.write("\n")
'

  n="$(CJ="$contributors_json" python3 -c "import json,os; print(len(json.loads(os.environ['CJ'] or '[]')))" 2>/dev/null || echo "?")"
  echo "  [ok] last_commit_at=$last_at contributors=$n" >&2
  updated=$((updated + 1))
done

echo "" >&2
echo "== backfill summary ==" >&2
echo "  updated: $updated" >&2
echo "  skipped: $skipped" >&2
echo "  failed:  $failed" >&2
