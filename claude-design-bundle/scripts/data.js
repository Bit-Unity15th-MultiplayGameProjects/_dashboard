// Mock data grounded in the live dashboard
// https://bit-unity15th-multiplaygameprojects.github.io/_dashboard/
// Project names + latest risk/progress/summary/tags match the real site.
// Historical reports are synthesized to make time-series meaningful.

const PROJECTS = [
  {
    slug: 'exit-or-die_een',
    name: 'exit-or-die_een',
    displayName: 'Exit or Die · EEN',
    owner: 'een',
    latestRisk: 'medium',
    latestProgress: 8,
    latestSummary: 'Unity URP 템플릿 + 기획 3종 문서 초안만 존재, 실제 게임 코드 0줄.',
    latestTags: ['초기스캐폴드', '기획문서', 'Unity-URP', 'InputSystem'],
    lastUpdated: '3시간 전',
    reports: [
      { date: '2026-04-05', progress: 0, risk: 'high', commits: 0, commitRange: '—', design: 0, technical: 0, spec: 0, summary: 'repo 생성 직후. 비어 있음.' },
      { date: '2026-04-10', progress: 2, risk: 'high', commits: 3, commitRange: 'a1b2c3..d4e5f6', design: 2, technical: 1, spec: 0, summary: 'README 초안과 GDD outline 추가. Unity 프로젝트 아직 없음.' },
      { date: '2026-04-14', progress: 4, risk: 'high', commits: 5, commitRange: 'd4e5f6..8f9a0b', design: 4, technical: 2, spec: 1, summary: '기획서 1종 (탈출 메커닉) 본문 작성 시작.' },
      { date: '2026-04-18', progress: 6, risk: 'medium', commits: 7, commitRange: '8f9a0b..3c4d5e', design: 5, technical: 3, spec: 2, summary: 'Unity URP 템플릿 import. 씬 구조 계획 문서화.' },
      { date: '2026-04-22', progress: 8, risk: 'medium', commits: 4, commitRange: '3c4d5e..7a8b9c', design: 6, technical: 4, spec: 3, summary: 'Unity URP 템플릿 + 기획 3종 문서 초안만 존재, 실제 게임 코드 0줄.' },
    ],
  },
  {
    slug: 'ghostmarch_2',
    name: 'ghostmarch_2',
    displayName: 'GhostMarch 2',
    owner: 'kim',
    latestRisk: 'low',
    latestProgress: 12,
    latestSummary: 'asmdef 기반 모듈 경계 선언과 패키지 정리, 실제 구현은 아직 없음.',
    latestTags: ['스캐폴드', 'asmdef', '패키지관리', '문서화'],
    lastUpdated: '3시간 전',
    reports: [
      { date: '2026-04-01', progress: 0, risk: 'high', commits: 0, commitRange: '—', design: 0, technical: 0, spec: 0, summary: '신규 repo. initial commit 대기.' },
      { date: '2026-04-06', progress: 3, risk: 'high', commits: 4, commitRange: 'init..b2c3d4', design: 2, technical: 3, spec: 0, summary: 'Unity 2023 LTS 프로젝트 생성. .gitignore 정비.' },
      { date: '2026-04-11', progress: 6, risk: 'medium', commits: 6, commitRange: 'b2c3d4..e5f6a7', design: 3, technical: 5, spec: 1, summary: 'Core / Gameplay / UI asmdef 분할 초안.' },
      { date: '2026-04-16', progress: 9, risk: 'medium', commits: 5, commitRange: 'e5f6a7..c8d9e0', design: 4, technical: 6, spec: 2, summary: '패키지 매니페스트 정리. Input System 전환.' },
      { date: '2026-04-19', progress: 11, risk: 'low', commits: 3, commitRange: 'c8d9e0..f1a2b3', design: 5, technical: 7, spec: 3, summary: 'asmdef 모듈 경계 문서화. 순환 참조 정리.' },
      { date: '2026-04-22', progress: 12, risk: 'low', commits: 2, commitRange: 'f1a2b3..a4b5c6', design: 5, technical: 7, spec: 3, summary: 'asmdef 기반 모듈 경계 선언과 패키지 정리, 실제 구현은 아직 없음.' },
    ],
  },
  {
    slug: 'hongsj',
    name: 'hongsj',
    displayName: 'HongSJ · Card Battle',
    owner: 'hongsj',
    latestRisk: 'medium',
    latestProgress: 28,
    latestSummary: '카드 ID 도입과 Resources 이전으로 네트워크 전송 기반 마련, 문서화는 여전히 공백.',
    latestTags: ['리팩터링', '데이터구조', '네트워킹준비', '문서화부족'],
    lastUpdated: '3시간 전',
    reports: [
      { date: '2026-03-28', progress: 12, risk: 'medium', commits: 8, commitRange: '—', design: 3, technical: 4, spec: 1, summary: '카드 데이터 ScriptableObject 프로토타입.' },
      { date: '2026-04-03', progress: 16, risk: 'medium', commits: 11, commitRange: 'aa11..bb22', design: 3, technical: 5, spec: 2, summary: '카드 덱 빌더 UI 초안. 드래그 앤 드롭 구현.' },
      { date: '2026-04-09', progress: 19, risk: 'high', commits: 9, commitRange: 'bb22..cc33', design: 3, technical: 5, spec: 2, summary: '네트워크 직렬화 이슈로 일시 정지. 카드 참조 구조 재검토 필요.' },
      { date: '2026-04-14', progress: 22, risk: 'medium', commits: 14, commitRange: 'cc33..dd44', design: 4, technical: 6, spec: 2, summary: '카드 ID 기반 참조로 전환 시작.' },
      { date: '2026-04-18', progress: 25, risk: 'medium', commits: 12, commitRange: 'dd44..ee55', design: 4, technical: 7, spec: 2, summary: 'Resources 폴더 이전 완료. 로딩 경로 통일.' },
      { date: '2026-04-22', progress: 28, risk: 'medium', commits: 10, commitRange: 'ee55..ff66', design: 4, technical: 7, spec: 2, summary: '카드 ID 도입과 Resources 이전으로 네트워크 전송 기반 마련, 문서화는 여전히 공백.' },
    ],
  },
  {
    slug: 'rougelike-endwalker',
    name: 'rougelike-endwalker',
    displayName: 'Rougelike · EndWalker',
    owner: 'cha',
    latestRisk: 'medium',
    latestProgress: 12,
    latestSummary: '기획·시각화 문서 4종 초안 수립, 코드 자산은 아직 전무한 단계다.',
    latestTags: ['문서화', '기획', '로그라이트', '멀티플레이'],
    lastUpdated: '3시간 전',
    reports: [
      { date: '2026-04-02', progress: 2, risk: 'high', commits: 1, commitRange: 'init', design: 2, technical: 0, spec: 0, summary: '컨셉 1페이지 초안.' },
      { date: '2026-04-08', progress: 5, risk: 'high', commits: 2, commitRange: 'init..11aa', design: 4, technical: 1, spec: 1, summary: '스테이지 노드 시각화 문서 추가.' },
      { date: '2026-04-13', progress: 8, risk: 'medium', commits: 3, commitRange: '11aa..22bb', design: 5, technical: 3, spec: 1, summary: 'BattleMap 생성 규칙 초안.' },
      { date: '2026-04-18', progress: 10, risk: 'medium', commits: 2, commitRange: '22bb..33cc', design: 6, technical: 4, spec: 2, summary: '캐릭터 특성 테이블 1차 정리.' },
      { date: '2026-04-22', progress: 12, risk: 'medium', commits: 2, commitRange: '777ea7..7954e7', design: 6, technical: 5, spec: 2, summary: '기획·시각화 문서 4종 초안 수립, 코드 자산은 아직 전무한 단계다.' },
    ],
  },
];

// Shared backlog tracking — per project, items with age (# of reports carried over)
const BACKLOGS = {
  'rougelike-endwalker': [
    { text: 'Unity 프로젝트 자체가 repo 에 부재 — 문서만 있고 실행 가능한 빌드 경로 없음', firstSeen: '2026-04-02', age: 5 },
    { text: '사서·기록자·최종 보스 등 핵심 인물 특성·밸런싱 수치 미기재', firstSeen: '2026-04-08', age: 4 },
    { text: 'Multiplay 스택(Mirror / NGO / Photon) 결정 및 근거 문서화 누락', firstSeen: '2026-04-02', age: 5 },
    { text: '확률 노드 가중치·BO 쿨다운 2 스테이지의 근거 수치 부재', firstSeen: '2026-04-13', age: 3 },
    { text: '아트/UI 컨셉 테이블에 placeholder(`[예: Hi-Bit ...]`) 잔존', firstSeen: '2026-04-18', age: 2 },
    { text: '마일스톤(M2~M5) 예상 일정 미정 — scope 관리 기준 없음', firstSeen: '2026-04-13', age: 3 },
    { text: 'README 작성자 표기 `차영록`/`차용록` 혼용(오타 의심)', firstSeen: '2026-04-22', age: 1 },
  ],
  'hongsj': [
    { text: '네트워크 권한 모델(Host authoritative vs Client predict) 미결정', firstSeen: '2026-03-28', age: 6 },
    { text: '카드 효과 DSL 스펙 문서 부재 — 하드코딩 상태', firstSeen: '2026-04-03', age: 5 },
    { text: 'README / GDD / 기술 설계서 3종 모두 공백', firstSeen: '2026-03-28', age: 6 },
    { text: '유닛 테스트 없음 · 카드 효과 회귀 검증 경로 부재', firstSeen: '2026-04-09', age: 4 },
    { text: 'Resources 동적 로딩에서 Addressables 전환 여부 결정 필요', firstSeen: '2026-04-18', age: 2 },
  ],
  'exit-or-die_een': [
    { text: 'Unity 프로젝트 생성 후 첫 씬/플레이어블 프로토타입 부재', firstSeen: '2026-04-05', age: 5 },
    { text: '탈출 조건 / 실패 조건 / 승리 조건 기획 미확정', firstSeen: '2026-04-10', age: 4 },
    { text: '기술 설계서 (docs/technical.md) 작성 착수 안 됨', firstSeen: '2026-04-10', age: 4 },
    { text: 'InputSystem Action Map 설계 없음', firstSeen: '2026-04-18', age: 2 },
  ],
  'ghostmarch_2': [
    { text: '각 asmdef 모듈의 public API 경계가 문서화되지 않음', firstSeen: '2026-04-11', age: 3 },
    { text: '실제 게임플레이 코드 0줄 — 스캐폴드 단계', firstSeen: '2026-04-06', age: 5 },
    { text: 'CI (Unity 빌드 검증) 구성 없음', firstSeen: '2026-04-16', age: 2 },
  ],
};

const TODOS = {
  'rougelike-endwalker': [
    'README 문서 이력/작성일의 YYYY.MM.DD placeholder 를 실제 날짜로 채우기',
    'Stage Nod Visualizer 의 확률 노드 가중치 수치(AT/FR/BO/RF %) 명시',
    'BattleMap Visualizer 의 max_room_dim, min_rooms 등 파라미터 표 통합',
    '멀티플레이 권한 모델(Host 권위 범위, RPC 목록) 기술 문서로 분리',
    '기술 문서 docs/technical.md 신설: 모듈 구성 / 씬 구조 / 네트워킹 스택 선정',
    'C# 프로젝트 스캐폴드(Unity 프로젝트, .gitignore, Assembly Definition) 커밋',
    '레시피/적 데이터 등 밸런싱 테이블을 담은 spec 문서 작성',
  ],
  'hongsj': [
    '네트워크 권한 모델 결정 — Host 권위 RPC 범위 초안 작성',
    'Card 효과 DSL 최소 스펙 문서화 (trigger / cost / effect 3-tuple)',
    'README 작성 — 빌드 / 실행 / 현재 scope 명시',
    'Addressables 전환 비용 측정 스파이크',
    '카드 효과 단위 테스트 5건 (draw / discard / play / heal / damage)',
  ],
  'exit-or-die_een': [
    'Unity 첫 씬에 플레이어 이동 프로토타입 구현',
    '탈출 / 실패 / 승리 조건 GDD 섹션 작성',
    'docs/technical.md 신설 — 씬 전환, 세이브 방식',
    'InputSystem Action Map 초안 커밋',
    '첫 레벨 화이트박스 씬 1개',
  ],
  'ghostmarch_2': [
    '각 asmdef 의 public API 표 1개씩 README 에 추가',
    'Gameplay 모듈에 최소 PlayerController 프로토타입 커밋',
    'GitHub Actions Unity 빌드 워크플로 draft',
    '테스트 asmdef 분리 및 첫 EditMode 테스트 1건',
  ],
};

const RESOLVED = {
  'rougelike-endwalker': [],
  'hongsj': [
    { text: 'ScriptableObject → ID 기반 참조 마이그레이션', resolvedDate: '2026-04-14' },
    { text: 'Resources 폴더 경로 통일', resolvedDate: '2026-04-18' },
  ],
  'exit-or-die_een': [
    { text: 'Unity URP 템플릿 초기화', resolvedDate: '2026-04-18' },
  ],
  'ghostmarch_2': [
    { text: '.gitignore 및 Unity 메타 파일 정책 수립', resolvedDate: '2026-04-06' },
    { text: 'asmdef 순환 참조 제거', resolvedDate: '2026-04-19' },
  ],
};

// Aggregate stats
const STATS = {
  projects: PROJECTS.length,
  reports: PROJECTS.reduce((s, p) => s + p.reports.length, 0),
  risks: {
    low: PROJECTS.filter(p => p.latestRisk === 'low').length,
    medium: PROJECTS.filter(p => p.latestRisk === 'medium').length,
    high: PROJECTS.filter(p => p.latestRisk === 'high').length,
  },
  lastBuild: '2026. 4. 22. PM 12:59',
};

window.__DASH__ = { PROJECTS, BACKLOGS, TODOS, RESOLVED, STATS };
