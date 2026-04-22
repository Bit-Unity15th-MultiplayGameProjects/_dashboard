# Design Brief — UI 리파인 (claude.ai/design 입력용)

이 문서는 `claude.ai/design` 세션에 넘겨주기 위한 브리프다. 코드베이스 스캔
만으로는 놓치기 쉬운 제약·의도·바람을 정리한다.

## 1. 프로젝트 개요

`_dashboard` 는 `Bit-Unity15th-MultiplayGameProjects` org 내 여러 **개인 Unity
게임 프로젝트** 를 주기적으로 리뷰하는 중앙 대시보드. Claude 가 각 프로젝트
repo 의 최근 커밋 diff, 문서 상태, 기존 backlog 를 분석해 리포트를 생성하고,
여기서 시각화한다.

- Live: https://bit-unity15th-multiplaygameprojects.github.io/_dashboard/
- 리뷰 모델: Claude Opus 4.7 (Max 구독 OAuth)
- Org 규모: 현재 4 개 비어있지 않은 프로젝트 repo + 여러 빈 repo (커밋 전)

## 2. 기술 스택 & 배포 경로

- **Astro 5** (static, Content Layer API, `glob` loader → `reports/<repo>/*.md`)
- **Tailwind CSS** (`slate` 팔레트 중심, `dark:` variant 로 다크 모드)
- **네이티브 HTML `<dialog>`** (modal — 외부 라이브러리 미사용)
- GitHub Pages 배포. 번들 사이즈 크게 늘리는 건 비추 (무료 플랜 CI 분 소모)
- asset 경로는 `_astro/` 대신 `assets/` (Jekyll `_` prefix 처리 회피. 빌드 설정
  에 고정되어 있음)

## 3. 리포트 1 건의 frontmatter 스키마

`src/content/config.ts` 에 zod 로 고정됐다. **이 구조를 바꾸면 전 파이프라인
(validator / prompt / CLI / dashboard) 동시에 수정해야 하므로, 디자인 패스에서
는 이 필드들을 시각화하는 데 집중**.

```yaml
project: string               # repo 이름
date: ISO 8601 with offset
commit_range: string          # "abc1234..def5678"
commit_count: number
risk_level: "low" | "medium" | "high"
tags: string[]                # 3-6 개
summary: string               # 한 줄 요약 (≤ 60 자)
progress_estimate: number     # 0-100 (%)
doc_scores:
  design: number              # 0-10 (GDD / 컨셉 문서)
  technical: number           # 0-10 (기술 설계서)
  spec: number                # 0-10 (사양서)
todos: string[]               # 3-10 개, 다음 리포트까지 actionable
backlogs: string[]            # 미해결 이슈 (누적 tracking)
resolved_from_backlog: string[]  # 이번에 해결된 이전 backlog 항목
```

본문 (markdown) 섹션:
1. 주요 변경사항
2. 코드 품질 리뷰
3. 진행도 평가
4. 다음 권장사항
5. 문서화 상태
6. Backlog
7. 이전 Backlog 해결 (조건부)

## 4. 페이지·컴포넌트 현 상태

```
src/
├─ layouts/Layout.astro               # 전역 shell (header/footer, dark toggle)
├─ pages/
│  ├─ index.astro                     # 홈: 4 통계 카드 + 프로젝트 카드 그리드
│  ├─ [project]/index.astro           # 프로젝트 상세: Progress + TODO + Backlog popup + 타임라인
│  └─ [project]/[date].astro          # 개별 리포트 본문
├─ components/
│  ├─ StatCard.astro                  # 홈 상단 통계 (프로젝트 수 / 리포트 수 / risk counts)
│  ├─ ProjectCard.astro               # 홈 프로젝트 카드 (진행도 바 포함)
│  ├─ RiskBadge.astro                 # low/med/high 색 뱃지
│  ├─ ProgressPanel.astro             # 프로젝트 상세 상단 — progress + doc_scores 막대
│  ├─ TodoList.astro                  # 번호 매긴 todos
│  └─ BacklogHistoryDialog.astro      # <dialog> 팝업 (backlog 이력 date별)
└─ lib/reports.ts                     # ReportInfo / ProjectSummary 도메인 타입
```

## 5. 디자인 패스가 다뤄줬으면 하는 지점 (우선순위)

### 🔴 High priority

1. **시계열 시각화**
   - 프로젝트 상세에 `progress_estimate` / `doc_scores` / `risk_level` 의 리포트별
     추이 그래프. 현재는 단일 시점만 표시 (최신 리포트 기준). 트렌드가 훨씬 중요함.
   - 홈에서도 각 프로젝트의 "최근 4-5 리포트의 progress 미니 스파크라인" 정도.

2. **Backlog 추적 가시성**
   - 현재 popup 에서 date 별 나열만. 각 항목이 **얼마나 오래 carry-over 됐는지**,
     어느 리포트에서 처음 등장했는지 추적이 어려움.
   - 같은 문구 / 유사 문구 자동 grouping 까지는 선택, 최소한 "이 항목은 N 개
     리포트 전부터" 배지 가 있으면 좋음.

3. **타이포그래피 위계 / 한국어 font stack**
   - 현재 Tailwind default system font. 리포트 본문은 한국어라 Pretendard 등
     한국어 최적화 font 고려. 코드 monospace 는 별도.
   - 헤딩 사이즈 / 본문 line-height 재조정 (현재 밀도 애매).

### 🟡 Medium priority

4. **모바일 반응형 검증**
   - 프로젝트 상세 페이지의 Progress Panel · TODO · Backlog 버튼이 세로 스택
     될 때 레이아웃. 현재 검증 안 됨.

5. **Empty state 개선**
   - 현재 "아직 수집된 리포트가 없습니다" 단순 텍스트.
   - 신규 셋업 직후 상태에서 어떻게 보이는지 / 안내 문구 추가 여부.

6. **접근성**
   - RiskBadge 색 대비 (특히 다크 모드 `high` → rose-300 배경 대비 텍스트).
   - `<dialog>` focus trap / ESC 동작 검증.
   - WCAG AA 수준은 맞추고 싶음.

### 🟢 Low priority (있으면 좋음)

7. **마이크로 인터랙션**
   - progress bar 로딩 애니메이션 / 카드 hover transition / tag chip stagger.
8. **브랜드 아이덴티티**
   - 현재 애니메이션 emerald dot + "Bit-Unity15th Dashboard" 텍스트 로고.
   - 조금 더 identity 있는 헤더 디자인.

## 6. 반드시 보존해야 할 제약

- **`src/content/config.ts` 의 zod 스키마** 는 디자인 패스에서 변경 금지.
  필드 추가가 필요하면 별도로 논의 (pipeline 전반 수정 필요).
- **`reports/<repo>/<ISO>.md`** 파일 경로 convention 은 `generate-reports.yml`
  워크플로우가 생성하는 구조라 바꿀 수 없음.
- **`base: "/_dashboard"`** 경로는 GitHub Pages 서빙 경로. 링크 생성 시 항상
  `import.meta.env.BASE_URL` 통해서.
- **`public/.nojekyll`**, **`astro.config.mjs` 의 `build.assets: "assets"`**
  는 건드리지 말 것 (Jekyll `_` prefix 회피 장치).
- `<dialog>` 는 네이티브 element 유지 권장 (focus trap / backdrop 자동). JS
  라이브러리 (Headless UI / Radix) 도입은 번들 크기 증가.

## 7. 출력 기대 (handoff bundle)

- Astro 컴포넌트로 포팅 가능한 구조 (React / Vue 만 있으면 재변환 필요).
- 각 컴포넌트의 props 인터페이스 명시 (위 "4. 컴포넌트 현 상태" 구조 기반
  으로 수정 or 신설).
- 시각 요소가 데이터 어느 필드에 바인딩되는지 주석.
- Tailwind class 기반 스타일링 (가능하면).
- 다크 모드 variant 항상 동시 제공.

## 8. 라이브 참고

- 대시보드 홈: https://bit-unity15th-multiplaygameprojects.github.io/_dashboard/
- 프로젝트 상세 예: https://bit-unity15th-multiplaygameprojects.github.io/_dashboard/Rougelike-EndWalker/
- 개별 리포트 예: https://bit-unity15th-multiplaygameprojects.github.io/_dashboard/Rougelike-EndWalker/2026-04-22T03-44-26Z/

(HongSJ / GhostMarch_2 리포트가 추가되면 4 프로젝트 카드 + 각각 1-N 개 리포트로
  재료가 풍부해짐. 디자인 세션 전 `generate-reports` 한 번 더 돌리기 권장.)
