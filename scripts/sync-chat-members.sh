#!/usr/bin/env bash
#
# Sync GitHub contributor access into Supabase project_chat_members.
#
# Required env:
#   ORG
#   GH_TOKEN
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   CHAT_OWNER_LOGINS       comma-separated GitHub logins for dashboard owners
#
# Optional env:
#   TARGET_REPOS_JSON       JSON array of repo names. If omitted, list-target-repos.sh is used.
#   ORG_CHAT_PROJECT_KEY    Supabase channel key for organization-wide chat.
#
# Project chat access intentionally combines:
#   - repository contributors reported by GitHub commit history
#   - repository collaborators with write/maintain/admin-equivalent access
# The contributors endpoint can miss students who have repo access but no
# matched commits yet, so collaborators are the safer authority for "my project".

set -euo pipefail

: "${ORG:?ORG env required}"
: "${GH_TOKEN:?GH_TOKEN env required}"
: "${SUPABASE_URL:?SUPABASE_URL env required}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY env required}"
: "${CHAT_OWNER_LOGINS:?CHAT_OWNER_LOGINS env required}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export GH_TOKEN

SUPABASE_URL="${SUPABASE_URL%/}"
ORG_CHAT_PROJECT_KEY="${ORG_CHAT_PROJECT_KEY:-__organization__}"

owners_json="$(
  jq -Rn --arg raw "$CHAT_OWNER_LOGINS" '
    $raw
    | split(",")
    | map(ascii_downcase | gsub("^\\s+|\\s+$"; "") | select(length > 0))
    | unique
  '
)"

owner_count="$(jq 'length' <<<"$owners_json")"
if [[ "$owner_count" == "0" ]]; then
  echo "::error::CHAT_OWNER_LOGINS must contain at least one GitHub login" >&2
  exit 1
fi

if [[ -n "${TARGET_REPOS_JSON:-}" ]]; then
  repos_json="$TARGET_REPOS_JSON"
else
  repos_json="$(bash "$SCRIPT_DIR/list-target-repos.sh")"
fi

repo_count="$(jq 'length' <<<"$repos_json")"
echo "[info] syncing chat members for $repo_count repo(s)" >&2
echo "[info] owner login count: $owner_count" >&2

api_logins_or_empty() {
  local label="$1"
  local path="$2"
  local jq_filter="$3"
  local output

  if output="$(
    gh api "$path" --paginate --jq "$jq_filter" 2> >(sed "s/^/[warn] $label: /" >&2)
  )"; then
    jq -R -s -c '
      split("\n")
      | map(ascii_downcase | select(length > 0))
      | unique
    ' <<<"$output"
  else
    echo "::warning::Could not fetch $label. Continuing with an empty list." >&2
    echo "[]"
  fi
}

post_members() {
  local project_key="$1"
  local members_json="$2"
  local summary="$3"

  local payload
  payload="$(
    jq -cn \
      --arg project "$project_key" \
      --argjson members "$members_json" \
      '{p_project: $project, p_members: $members}'
  )"

  curl -fsS \
    -X POST "$SUPABASE_URL/rest/v1/rpc/replace_project_chat_members" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    >/dev/null

  local member_count
  member_count="$(jq 'length' <<<"$members_json")"
  echo "[info] synced $member_count member(s) for $project_key: $summary" >&2
}

org_members_json="$(
  api_logins_or_empty \
    "organization members" \
    "orgs/${ORG}/members" \
    '.[].login'
)"

org_member_count="$(jq 'length' <<<"$org_members_json")"
if [[ "$org_member_count" == "0" ]]; then
  echo "::warning::No organization members were returned by GitHub. Check that ORG_REPO_PAT_BIT_UNITY_15TH has organization Members: Read access." >&2
fi

org_chat_members_json="$(
  jq -cn \
    --argjson owners "$owners_json" \
    --argjson org_members "$org_members_json" '
      [
        ($owners[]? | {login: ., role: "owner"}),
        ($org_members[]? | {login: ., role: "member"})
      ]
      | group_by(.login)
      | map(
          if (map(.role) | index("owner")) then
            {login: .[0].login, role: "owner"}
          else
            .[0]
          end
        )
    '
)"

post_members \
  "$ORG_CHAT_PROJECT_KEY" \
  "$org_chat_members_json" \
  "$org_member_count organization member(s), $owner_count owner(s)"

while IFS= read -r repo; do
  [[ -n "$repo" ]] || continue
  project_key="$(jq -nr --arg r "$repo" '$r | ascii_downcase')"
  echo "[info] repo: $repo" >&2

  contributors_json="$(
    api_logins_or_empty \
      "$repo contributors" \
      "repos/${ORG}/${repo}/contributors?per_page=100" \
      '.[].login'
  )"

  collaborators_json="$(
    api_logins_or_empty \
      "$repo collaborators" \
      "repos/${ORG}/${repo}/collaborators?affiliation=all&per_page=100" \
      '.[] | select((.permissions.push // false) or (.permissions.maintain // false) or (.permissions.admin // false)) | .login'
  )"

  members_json="$(
    jq -cn \
      --argjson owners "$owners_json" \
      --argjson contributors "$contributors_json" \
      --argjson collaborators "$collaborators_json" '
        [
          ($owners[]? | {login: ., role: "owner"}),
          ($contributors[]? | {login: ., role: "contributor"}),
          ($collaborators[]? | {login: ., role: "contributor"})
        ]
        | group_by(.login)
        | map(
            if (map(.role) | index("owner")) then
              {login: .[0].login, role: "owner"}
            else
              .[0]
            end
          )
      '
  )"

  contributor_count="$(jq 'length' <<<"$contributors_json")"
  collaborator_count="$(jq 'length' <<<"$collaborators_json")"
  post_members \
    "$project_key" \
    "$members_json" \
    "$contributor_count contributor(s), $collaborator_count write collaborator(s), $owner_count owner(s)"
done < <(jq -r '.[]' <<<"$repos_json")
