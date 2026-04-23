# Project Context

## 목적
Bit-Unity15th-MultiplayGameProjects organization 내 프로젝트 repo들에 대해
주기적으로 Claude 기반 코드리뷰/진행도 리포트를 자동 생성하고,
이를 GitHub Pages 대시보드로 공개한다.

## Organization
- Name: Bit-Unity15th-MultiplayGameProjects
- URL: https://github.com/Bit-Unity15th-MultiplayGameProjects
- 이 repo (`_dashboard`)가 오케스트레이터 + 프론트엔드 역할
- 프로젝트 repo에는 어떤 workflow도 추가하지 않는다 (프로젝트 repo는 깨끗하게 유지)

## Repo 분류 규칙
- `_` prefix로 시작하는 repo는 교육용 (예: _sample, _dashboard, _guidelines) → 리뷰 제외
- `_` prefix 없는 repo는 프로젝트 → 리뷰 대상
- archived repo도 제외

## 업데이트 정책 (과다 호출 방지)
cron으로 주기 체크하되, 4단계 게이트로 실제 Claude 호출을 제한:
1. Gate 1 (discovery): repo name이 `_` prefix면 skip. archived/`.reviewignore` 도 이 단계에서 제외.
2. Gate 2 (check-needs-report): 마지막 리포트 이후 새 커밋 없으면 skip (SHA 비교)
3. Gate 3 (check-needs-report): 마지막 리포트로부터 MIN_INTERVAL_HOURS 미경과 시 skip
4. Gate 4 (check-needs-report): 새 커밋 수가 MIN_COMMITS 미만이면 skip

기본값:
- cron: `*/30 * * * *` (30분마다 체크)
- MIN_INTERVAL_HOURS: 6
- MIN_COMMITS: 2
- 모두 workflow env로 override 가능

## 기술 스택
- Frontend: Astro + Tailwind + Content Collections
- CI/CD: GitHub Actions
- AI: Claude CLI (`@anthropic-ai/claude-code`) headless 모드, `--model claude-opus-4-7`, Max 구독 OAuth
- Deploy: GitHub Pages (Actions 방식)

## 디렉토리 구조
```
_dashboard/
├─ .github/workflows/
│  ├─ generate-reports.yml   # cron 오케스트레이션
│  └─ deploy.yml             # Pages 배포
├─ scripts/
│  ├─ list-target-repos.sh           # discover — org repo 나열 + 필터
│  ├─ check-needs-report.sh          # 3 skip 게이트 (SHA / 쿨다운 / 커밋수)
│  ├─ run-claude-review.sh           # prompt 치환 + claude -p headless
│  ├─ review-prompt.md               # 리뷰 프롬프트 템플릿
│  ├─ validate-report.py             # frontmatter zod 룰 pre-commit 검증
│  ├─ test-prompt.sh                 # 로컬 dry-run / --run 실호출
│  ├─ migrate-items-to-object.py     # string → {title, files?} 일괄 변환
│  ├─ backfill-priority.py           # 기존 항목에 priority 사후 부여 (Claude 1회)
│  └─ backfill-meta-fields.sh        # 기존 .meta.json 에 last_commit_at/contributors 채움 (gh api)
├─ reports/
│  └─ {repo-name}/
│     ├─ .meta.json          # last_sha, last_report_at, last_commit_at, contributors
│     └─ {iso-timestamp}.md
├─ src/                      # Astro
│  ├─ content/config.ts      # zod 스키마
│  ├─ lib/reports.ts         # todo/backlog 정규화 + priority 유틸
│  ├─ pages/                 # index + [project]/...
│  ├─ components/            # ProgressPanel, PriorityBadge, ItemDetailDialog 등
│  ├─ layouts/Layout.astro
│  └─ styles/global.css      # OKLCH 토큰
├─ docs/                     # 문서 보조 자산
│  ├─ pipeline.excalidraw            # 파이프라인 다이어그램 원본 (Excalidraw)
│  └─ pipeline.svg                   # README 에 임베드되는 export
├─ .reviewignore             # (선택) 리뷰 제외 repo 이름 목록
├─ package.json
├─ astro.config.mjs
└─ tailwind.config.mjs
```

## Secrets (GitHub)
- CLAUDE_CODE_OAUTH_TOKEN: Max 구독 OAuth 토큰
- ORG_REPO_PAT_BIT_UNITY_15TH: 프로젝트 repo 읽기 전용 fine-grained PAT (Contents:Read + Metadata:Read, All repositories). `_dashboard` 자체 푸시는 workflow 기본 `GITHUB_TOKEN` 이 담당.

## 리포트 포맷
Markdown + YAML frontmatter. 상세 스펙은 `scripts/review-prompt.md`,
Zod 스키마는 `src/content/config.ts`, validator 는 `scripts/validate-report.py`.

frontmatter 필드 (총 12):
- project: string
- date: ISO 8601 with offset
- commit_range: string (`from_sha..to_sha`)
- commit_count: number
- risk_level: "low" | "medium" | "high"
- tags: string[] (3-6개)
- summary: string (한 줄 요약, 60자 이내)
- progress_estimate: number (0-100, %. Claude 종합 판정)
- doc_scores: { design, technical, spec } 각 0-10 정수
- todos: Item[] (3-10개, 다음 리포트까지 유효한 actionable 항목)
- backlogs: Item[] (이 시점 미해결 이슈, 다음 리포트로 이월됨)
- resolved_from_backlog: Item[] (이전 backlog 중 해결된 항목, 없으면 [])

`Item` 스키마 (`todos` / `backlogs` / `resolved_from_backlog` 공통):
- title: string (필수, 한 줄)
- priority: "critical" | "high" | "medium" | "low" (P0~P3)
  — `todos` / `backlogs` 에 **필수**, `resolved_from_backlog` 에 **금지**
- files: string[] (선택, repo 루트 기준 상대경로 1-4개)
- details: string (선택, 60-80자 1줄, max 120. `resolved_from_backlog` 금지)

스키마는 옛 plain string 항목도 허용 (`normalizeItem` 에서 객체로 승격).
신규 리포트는 반드시 객체 형식으로 생성된다.

`todos` 배열은 priority 내림차순 (critical → high → medium → low) 으로
정렬되어 있어야 한다. UI 가 배열 순서를 우선순위 표시에 그대로 사용.

본문 섹션 (6 필수 + 1 조건부):
1. 주요 변경사항
2. 코드 품질 리뷰
3. 진행도 평가
4. 다음 권장사항
5. 문서화 상태 (doc_scores 근거)
6. Backlog (backlogs frontmatter 와 일치)
7. 이전 Backlog 해결 (resolved_from_backlog 있을 때만)

문서 완성도 rubric 기준: `_sample/docs` (run-claude-review.sh 가 매 run clone).

## .meta.json 필드
`reports/{repo}/.meta.json` 은 content collection 에서 제외되고 Astro 가 `node:fs`
로 직접 읽는다 (`src/lib/reports.ts`의 `readProjectMeta`).
- last_sha / last_report_at / last_report_file / report_count: 게이트·요약용
- last_commit_at: default branch HEAD 의 commit 시각 (ISO 8601). 대시보드
  카드 우상단에 표기. 없으면 최신 리포트 `date` 로 fallback.
- contributors: 프로젝트 전체 기여자 목록. 파이프라인은 `git shortlog -sn`
  의 author 실명, backfill 은 `gh api /contributors` 의 login. 프로젝트
  상세 페이지 제목 우측에 회색 소문자로 표기.

## 작업 원칙
- 프로젝트 repo는 read-only로만 다룬다
- 모든 상태는 reports/{repo}/.meta.json에 기록
- Claude 호출 비용을 의식하고 게이트 로직을 우회하지 않는다
- 리포트는 항상 한국어로 작성

## Known Issues

### `_` prefix repo 이름 + GitHub Pages
repo 이름이 `_dashboard`라 GitHub Pages 경로에서 다음 위험이 확인됐다:

- **Jekyll 기본 동작**: GitHub Pages는 default로 Jekyll을 거친다. Jekyll은
  `_` prefix 파일/폴더를 "reserved"로 취급해 빌드 산출물에서 제거한다.
  이 때문에 `_astro/`, `_dashboard/` 같은 경로는 404로 뜰 수 있다.
- **Astro 기본 asset 경로 충돌**: Astro는 기본적으로 빌드 산출물을
  `_astro/` 디렉토리에 넣는다. 위 Jekyll 규칙과 정확히 충돌한다.
- **Actions 기반 Pages 배포**: 공식 action(`actions/deploy-pages`)은
  Jekyll을 건너뛰지만, `.nojekyll`이 없으면 일부 경로에서 Jekyll 규칙이
  여전히 적용될 수 있다는 보고가 있다. 안전망으로 반드시 둔다.

### 현재 적용한 완화책 (1차)
1. `public/.nojekyll` 빈 파일 추가 — Jekyll 처리를 완전 비활성화.
2. `astro.config.mjs`의 `build.assets: "assets"` — Astro 기본
   `_astro/` 대신 underscore 없는 `assets/`로 산출. 만약 `.nojekyll`이
   어떤 이유로 무효화돼도 asset 404는 발생하지 않는다.
3. `base: "/_dashboard"` 유지. Pages URL은
   `https://bit-unity15th-multiplaygameprojects.github.io/_dashboard/`.

### 배포 후 여전히 404가 난다면 (2차 대안)

**(A) custom domain 또는 org pages로 base 제거 (권장)**
- repo를 그대로 두고 custom domain을 붙이거나, site를
  `<org>.github.io` user/organization site repo로 이관한다.
- `astro.config.mjs`에서 `base`를 빈 문자열(기본값)로 두고, 사이트가
  도메인 루트(`/`)에서 서빙되도록 한다.
- 이 경우 URL에 `_dashboard` 세그먼트 자체가 사라지므로 Pages의
  `_` prefix 경로 필터링 문제를 근본적으로 회피한다.

**(B) repo 이름 변경 (최후 수단)**
- repo를 `dashboard` 등 underscore 없는 이름으로 rename하고
  `base`를 `/dashboard`로 수정한다.
- repo URL이 바뀌므로 외부 참조·북마크·git remote 업데이트 필요.
- 교육 자료 링크가 이미 배포돼 있다면 마이그레이션 비용이 크다.
  그래서 (A)를 먼저 시도.
