# End-to-End Test Plan

이 문서는 `generate-reports.yml` 파이프라인의 **동작 계약**을 시나리오별로 정리한
테스트 계획서다. 실제 자동화 테스트 스위트가 없기 때문에 (프롬프트·Claude 호출은
LLM 비결정성 때문에 단위 테스트가 어렵다) **수동 실행 + Actions 로그 관측** 중심으로
작성됐다. 파이프라인에 손을 댄 뒤엔 반드시 아래 7 시나리오 중 최소 1~3/5/6/7 을
돌려본 뒤 main 에 머지한다.

- 대상 파이프라인: `.github/workflows/generate-reports.yml`
- 테스트 repo (예시): `alpha`, `beta`, `gamma` — 실제 org 의 프로젝트 하나 지정
- 관측 도구: Actions 탭의 step log + Actions summary 테이블 + 커밋된 `reports/`·`.meta.json`

---

## 공통 준비

아래 사전조건은 모든 시나리오에 공통.

1. Secrets 두 개가 설정되어 있다: `CLAUDE_CODE_OAUTH_TOKEN`, `ORG_REPO_PAT_BIT_UNITY_15TH`.
   (값이 유효하지 않으면 discover 또는 run 단계에서 401/403 으로 조기 종료한다.)
2. Pages source 가 "GitHub Actions" 로 설정되어 있다.
3. 테스트용 repo 하나(이하 `$R`)를 고른다. 실제 프로젝트 repo 라면 `force=false` 로
   트래픽만 확인하고, 필요하면 팀에 사전 공지.
4. 각 시나리오 시작 전에 `reports/$R/.meta.json` 의 현재 상태를 스냅샷:
   ```bash
   cat reports/$R/.meta.json 2>/dev/null || echo "(no meta)"
   ```
5. 관측 포인트 공통:
   - Actions 탭 → 해당 run 의 **Summary** (테이블 행 하나로 결과 확인)
   - `reports/$R/` 디렉토리 신규 `*.md` 파일 여부
   - `reports/$R/.meta.json` 의 `last_sha` / `last_report_at` / `report_count` 증가 여부
   - Actions run log 의 `Check gates` step outputs (`should_run` / `reason`)

---

## Scenario 1 — 첫 실행 (meta 없음)

**목적**: first report 경로가 cooldown/commit-count 게이트를 건너뛰고 리포트를
생성하는지 확인.

**사전조건**:
- `reports/$R/` 디렉토리 **없음** (또는 `.meta.json` 없음).
- `$R` 은 default branch 에 커밋이 최소 1 개 이상 있음.

**실행**:

Actions → generate-reports → **Run workflow** → `target_repo=$R`, `force=false`.

**기대 결과**:

| 관측 지점 | 값 |
|---|---|
| `Check gates` output `should_run` | `true` |
| `Check gates` output `first_report` | `true` |
| `Check gates` output `reason` | `first_report (no meta)` |
| `Run Claude review` 종료 상태 | success |
| 신규 파일 | `reports/$R/<ISO>.md` 1 개 생성 |
| 신규 파일 | `reports/$R/.meta.json` 생성 |
| `.meta.json.last_sha` | `$R` 의 default branch HEAD SHA 와 일치 |
| `.meta.json.report_count` | `1` |
| commit_range (리포트 frontmatter) | `<40hex>..<40hex>` 형태 (symbolic ref 금지) |

**검증**:

```bash
# main pull 후 로컬에서 확인
jq . reports/$R/.meta.json
head -20 reports/$R/*.md        # frontmatter 육안 검증
```

commit_range 가 `HEAD~30` / `HEAD` 같은 symbolic ref 를 포함하면 후속
`astro build` 가 zod 스키마 에러로 터지므로 여기서 catch.

---

## Scenario 2 — 즉시 재실행 (쿨다운)

**목적**: Scenario 1 직후, 같은 `$R` 에 대해 실행 시 `MIN_INTERVAL_HOURS=6` 게이트로
skip 되는지.

**사전조건**:
- Scenario 1 을 방금 끝낸 직후 (수 분 내).
- `$R` 의 default branch 에 새 커밋은 있어도 되고 없어도 됨.

**실행**:

Actions → generate-reports → Run workflow → `target_repo=$R`, `force=false`.

**기대 결과**:

| 관측 지점 | 값 |
|---|---|
| `Check gates` output `should_run` | `false` |
| `Check gates` output `reason` | `interval gate: <0.xx>h < 6h` (SHA 가 다른 경우) 또는 `no new commits` (SHA 동일) |
| `Build prompt` / `Run Claude review` | skip (`if: should_run == 'true'` 로 건너뜀) |
| 신규 커밋 | **없음** (reports/, .meta.json 모두 그대로) |

**검증**:

- Actions summary 테이블에서 해당 cell 의 `status` 가 `skipped`.
- `.meta.json.last_report_at` 이 Scenario 1 과 동일 (갱신 안 됨).

---

## Scenario 3 — `force=true` 재실행

**목적**: 쿨다운 게이트를 우회하되 SHA 게이트는 유지되는지 (CLAUDE.md "게이트 로직을
우회하지 않는다" 정책 준수).

**사전조건**:
- Scenario 2 직후.
- `$R` 에 **새 커밋이 최소 1 개** 있어야 유의미한 테스트가 된다
  (없으면 SHA 가 같아서 `force=true` 라도 skip — 이 자체가 정책 확인 포인트).

### 3a. 새 커밋 있음

**실행**: Run workflow → `target_repo=$R`, `force=true`.

**기대**:

| 관측 | 값 |
|---|---|
| `should_run` | `true` |
| `reason` | `force=true (manual bypass)` |
| 리포트 생성 | 신규 `reports/$R/<ISO>.md` |
| `.meta.json.last_sha` | 새 HEAD SHA 로 갱신 |

### 3b. 새 커밋 없음 (SHA 동일)

**실행**: Run workflow → `target_repo=$R`, `force=true`. **단 $R 의 HEAD 가 Scenario 2
와 같은 상태**.

**기대**:

| 관측 | 값 |
|---|---|
| `should_run` | `false` |
| `reason` | `force=true but no new commits (SHA unchanged)` |
| 리포트 생성 | **없음** |

**이유**: 토큰·쿼터 낭비 방지. CLAUDE.md 정책과 generate-reports.yml 의 force
분기 (라인 135~141) 가 이 동작을 명시.

---

## Scenario 4 — 쿨다운 경과 + 새 커밋 없음

**목적**: 시간만 지났다고 무작정 리뷰하지 않고 SHA 변화를 먼저 확인하는지.

**사전조건**:
- Scenario 1 으로부터 `MIN_INTERVAL_HOURS` (기본 6h) 이상 경과.
- `$R` 의 default branch HEAD SHA 가 `.meta.json.last_sha` 와 동일 (그 사이 커밋 없음).

**실행**: cron 자연 틱, 또는 Run workflow → `target_repo=$R`, `force=false`.

**기대 결과**:

| 관측 | 값 |
|---|---|
| `should_run` | `false` |
| `reason` | `no new commits` (Gate b 에서 바로 걸림) |
| 리포트 생성 | 없음 |

**검증**: `check-needs-report.sh` 의 Gate b 가 cooldown 평가 *이전* 에 실행되는지
확인. 스크립트 구조상 그렇다 (lines 117–120). 이 시나리오는 그 순서가 보장됨을
확인하는 regression 용.

---

## Scenario 5 — `_` prefix repo 는 discover 에서 제외

**목적**: list-target-repos.sh 의 prefix 필터 (Gate 1) 확인.

**사전조건**:
- org 에 `_dashboard`, `_sample`, `_guidelines` 등 underscore prefix repo 존재.

**실행**: Run workflow → `target_repo=` (비움), `force=false`.

**기대 결과**:

| 관측 | 값 |
|---|---|
| discover job output `repos` | 배열에 `_`-prefix repo **없음** |
| discover job output `count` | org 총 repo 수 − `_`-prefix 수 − archived 수 − `.reviewignore` 수 |
| review matrix cell 수 | `count` 와 동일 |

**검증**:

```bash
# 로컬에서 동일 필터를 돌려 비교
ORG=Bit-Unity15th-MultiplayGameProjects GH_TOKEN=$(gh auth token) \
  bash scripts/list-target-repos.sh | jq
```

결과 JSON 에 `_dashboard` 같은 underscore 이름이 없어야 함.

---

## Scenario 6 — `.reviewignore` 로 제외

**목적**: `.reviewignore` 파일이 discover 에서 repo 를 정확히 빼내는지.

**사전조건**:
- 실제로 org 에 존재하는 (non-`_` prefix, non-archived) repo 하나를 `$X` 로 지정.

**실행**:

1. repo root 에 `.reviewignore` 에 `$X` 한 줄 추가 후 main 커밋·푸시:
   ```
   # 운영 테스트 — $X 임시 제외
   $X
   ```
2. Run workflow → `target_repo=` (비움).

**기대 결과**:

| 관측 | 값 |
|---|---|
| discover output `repos` | `$X` 포함 안 됨 |
| discover output `count` | 이전 대비 1 감소 |
| Actions summary 테이블 | `$X` row 없음 |

**정리**:

테스트 후 `.reviewignore` 에서 `$X` 줄을 제거하고 main 에 push → 다음 cron 부터
`$X` 는 다시 리뷰 대상.

**추가 검증 (주석·CRLF 처리)**:

로컬에서:

```bash
printf 'alpha\r\n# comment line\r\nbeta  # inline comment\r\n' > /tmp/ri
TESTDIR=/tmp/mock; mkdir -p "$TESTDIR"
cat > "$TESTDIR/mock-gh" <<'EOF'
#!/usr/bin/env bash
echo '[{"name":"alpha","isArchived":false},{"name":"beta","isArchived":false},{"name":"gamma","isArchived":false}]'
EOF
chmod +x "$TESTDIR/mock-gh"
ORG=test GH_TOKEN=x REVIEWIGNORE_PATH=/tmp/ri GH_CMD=$TESTDIR/mock-gh \
  bash scripts/list-target-repos.sh
# 기대: ["gamma"]
```

---

## Scenario 7 — archived repo 는 discover 에서 제외

**목적**: archived repo 필터.

**사전조건**:
- org 에 archived repo 가 최소 1 개 존재.

**실행**: Run workflow → `target_repo=` (비움).

**기대 결과**:

| 관측 | 값 |
|---|---|
| discover output `repos` | archived repo 포함 안 됨 |

**검증**:

```bash
# org 에서 archived 수 확인
gh api "orgs/Bit-Unity15th-MultiplayGameProjects/repos?type=all&per_page=100" \
  --jq '[.[] | select(.archived)] | length'
# 이 값만큼 discover count 에서 빠져야 함
```

---

## 스모크 테스트 순서 제안

머지 전 최소 검증 세트:

1. **Scenario 1**: 신규 테스트 repo 지정 (또는 기존 `reports/$R/` 삭제 후) 한번 돌려
   first-report 경로 확인.
2. **Scenario 6 의 추가 검증**: 로컬 mock-gh 로 `.reviewignore` 파서 검증.
3. **Scenario 3b**: `force=true` 라도 SHA 동일이면 skip 되는지.

이 셋만 통과해도 핵심 의도가 망가지진 않음. 여력이 있으면 2·4·5·7 까지.

---

## 테스트 실패 시 트리아지

| 실패 증상 | 의심 파일 | 우선 확인 |
|---|---|---|
| discover 가 0 repo | `list-target-repos.sh`, `ORG_REPO_PAT_BIT_UNITY_15TH` | 토큰 만료·권한, ORG env |
| gate 가 항상 skip | `check-needs-report.sh` | `.meta.json.last_sha` 가 remote HEAD 와 같은지 |
| prompt build 실패 | `run-claude-review.sh` | clone 권한, `review-prompt.md` 치환 누락 |
| Claude 출력 schema 에러 | `scripts/review-prompt.md`, `src/content/config.ts` | `test-prompt.sh --run` 으로 재현 |
| push 실패 | workflow permissions, rebase retry 로직 | `GITHUB_TOKEN` 의 `contents: write` 여부 |
| deploy 가 안 걸림 | `deploy.yml` paths-ignore | `.meta.json` 이 함께 커밋됐는지 |
