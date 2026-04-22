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
│  ├─ list-target-repos.sh
│  ├─ check-needs-report.sh
│  ├─ run-claude-review.sh
│  └─ review-prompt.md
├─ reports/
│  └─ {repo-name}/
│     ├─ .meta.json          # last_sha, last_report_at
│     └─ {iso-timestamp}.md
├─ src/                      # Astro
│  ├─ content/config.ts
│  ├─ pages/
│  ├─ components/
│  └─ layouts/
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

frontmatter 필드 (필수 11 + 선택 1):
- project: string
- date: ISO 8601 with offset
- commit_range: string (`from_sha..to_sha`)
- commit_count: number
- risk_level: "low" | "medium" | "high"
- tags: string[]
- summary: string (한 줄 요약, 60자 이내)
- progress_estimate: number (0-100, %. Claude 종합 판정)
- doc_scores: { design, technical, spec } 각 0-10 정수
- todos: string[] (3-10개, 다음 리포트까지 유효한 actionable 항목)
- backlogs: string[] (이 시점 미해결 이슈, 다음 리포트로 이월됨)
- resolved_from_backlog: string[] (이전 backlog 중 해결된 항목, 없으면 [])

본문 섹션 (6 필수 + 1 조건부):
1. 주요 변경사항
2. 코드 품질 리뷰
3. 진행도 평가
4. 다음 권장사항
5. 문서화 상태 (doc_scores 근거)
6. Backlog (backlogs frontmatter 와 일치)
7. 이전 Backlog 해결 (resolved_from_backlog 있을 때만)

문서 완성도 rubric 기준: `_sample/docs` (run-claude-review.sh 가 매 run clone).

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
