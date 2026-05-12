import { getCollection, type CollectionEntry } from "astro:content";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type ReportEntry = CollectionEntry<"reports">;
export type Risk = "low" | "medium" | "high";

// .meta.json 은 content collection 에서 제외돼 있으므로 fs 로 직접 읽는다.
// 빌드 시점에 한 번 읽고 getProjectSummaries 가 주입한다.
export interface ProjectMeta {
  last_sha?: string;
  last_report_at?: string;
  last_report_file?: string;
  report_count?: number;
  // 최신 default-branch HEAD 의 commit 시각 (ISO 8601 with offset).
  // 파이프라인이 `git log -1 --format=%cI` 로 기록. 기존 리포트엔 없을 수 있음.
  last_commit_at?: string;
  // 프로젝트 전체 기여자 displayName, 중복 제거 + 커밋 수 내림차순.
  // 파이프라인이 `git shortlog -sn` 파싱해 기록. 기존 리포트엔 없을 수 있음.
  contributors?: string[];
  // Stable GitHub repository identity. Names can change, so CI uses these
  // fields to keep report history attached to the same repository after rename.
  repo_id?: number | string;
  repo_node_id?: string;
  repo_name?: string;
  repo_full_name?: string;
  repo_previous_names?: string[];
}

// Astro glob loader 는 entry.id 를 소문자화한다. 반면 실제 디렉토리명 (`YJ`)
// 은 case 보존. 리눅스 CI 는 case-sensitive 라 소문자 그대로 path 조회 시 404.
// 한 번 스캔 후 lowercase → 실제 디렉토리명 map 으로 lookup.
let metaCache: Map<string, ProjectMeta> | null = null;

async function loadMetaCache(): Promise<Map<string, ProjectMeta>> {
  if (metaCache) return metaCache;
  const cache = new Map<string, ProjectMeta>();
  const reportsDir = path.resolve(process.cwd(), "reports");
  let dirents: Awaited<ReturnType<typeof readdir>> = [];
  try {
    dirents = await readdir(reportsDir, { withFileTypes: true });
  } catch {
    metaCache = cache;
    return cache;
  }
  for (const d of dirents) {
    if (!d.isDirectory()) continue;
    const metaPath = path.join(reportsDir, d.name, ".meta.json");
    try {
      const raw = await readFile(metaPath, "utf-8");
      cache.set(d.name.toLowerCase(), JSON.parse(raw) as ProjectMeta);
    } catch {
      // 디렉토리 있지만 meta.json 없는 경우 — 무시.
    }
  }
  metaCache = cache;
  return cache;
}

async function readProjectMeta(project: string): Promise<ProjectMeta> {
  const cache = await loadMetaCache();
  return cache.get(project.toLowerCase()) ?? {};
}

/**
 * Report entry id layout: `{project}/{iso-timestamp}` (from glob loader).
 * Split to a structured form so page templates don't re-parse the id string.
 */
export interface ReportInfo {
  entry: ReportEntry;
  project: string;
  slug: string; // timestamp segment, url-safe
}

function splitId(id: string): { project: string; slug: string } {
  const idx = id.indexOf("/");
  if (idx < 0) return { project: "_unknown", slug: id };
  return { project: id.slice(0, idx), slug: id.slice(idx + 1) };
}

export async function getAllReports(): Promise<ReportInfo[]> {
  const entries = await getCollection("reports");
  return entries.map((entry) => ({ entry, ...splitId(entry.id) }));
}

export function sortByDateDesc(reports: ReportInfo[]): ReportInfo[] {
  return [...reports].sort(
    (a, b) =>
      new Date(reportUpdatedAt(b)).getTime() -
      new Date(reportUpdatedAt(a)).getTime(),
  );
}

export interface ProjectSummary {
  project: string;
  reports: ReportInfo[]; // sorted desc (latest first)
  latest: ReportInfo;
  meta: ProjectMeta;
}

export async function getProjectSummaries(): Promise<ProjectSummary[]> {
  const all = await getAllReports();
  const byProject = new Map<string, ReportInfo[]>();
  for (const r of all) {
    const list = byProject.get(r.project) ?? [];
    list.push(r);
    byProject.set(r.project, list);
  }

  const summaries: ProjectSummary[] = [];
  for (const [project, reports] of byProject) {
    const sorted = sortByDateDesc(reports);
    const meta = await readProjectMeta(project);
    summaries.push({ project, reports: sorted, latest: sorted[0]!, meta });
  }
  return summaries.sort(
    (a, b) =>
      new Date(reportUpdatedAt(b.latest)).getTime() -
      new Date(reportUpdatedAt(a.latest)).getTime(),
  );
}

/** Parse the report filename timestamp, e.g. 2026-05-04T07-22-41Z. */
function reportUpdatedAtFromSlug(slug: string): string | null {
  const direct = new Date(slug);
  if (!Number.isNaN(direct.getTime())) return slug;

  const m = slug.match(
    /^(\d{4}-\d{2}-\d{2})[Tt](\d{2})-(\d{2})-(\d{2})([Zz])$/,
  );
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5].toUpperCase()}`;
}

export function reportUpdatedAt(r: ReportInfo): string {
  return reportUpdatedAtFromSlug(r.slug) ?? r.entry.data.date;
}

export function lastReportAt(p: ProjectSummary): string {
  return p.meta.last_report_at ?? reportUpdatedAt(p.latest);
}

/** Latest default-branch commit time. Falls back to the latest report date. */
export function lastCommitAt(p: ProjectSummary): string {
  return p.meta.last_commit_at ?? reportUpdatedAt(p.latest);
}

// ─── derived shapes for the new design ────────────────────────────────

export interface ChartSnapshot {
  date: string; // YYYY-MM-DD
  progress: number;
  design: number;
  technical: number;
  spec: number;
  risk: Risk;
  commits: number;
  commitRange: string;
  summary: string;
  slug: string; // url-safe report slug
  isoDate: string; // full ISO with offset
}

/** 오래된 → 최신 순 chart-friendly 스냅샷 */
export function chronologicalSnapshots(p: ProjectSummary): ChartSnapshot[] {
  return [...p.reports].reverse().map((r) => {
    const d = r.entry.data;
    const updatedAt = reportUpdatedAt(r);
    return {
      date: new Date(updatedAt).toISOString().slice(0, 10),
      isoDate: updatedAt,
      progress: d.progress_estimate,
      design: d.doc_scores.design,
      technical: d.doc_scores.technical,
      spec: d.doc_scores.spec,
      risk: d.risk_level,
      commits: d.commit_count,
      commitRange: d.commit_range,
      summary: d.summary,
      slug: r.slug,
    };
  });
}

// ─── item normalization ───────────────────────────────────────────────
// frontmatter 의 todos / backlogs / resolved_from_backlog 는 string 또는
// {title, files?} 객체 union. 호출부 단순화를 위해 한 형태로 평탄화.

export type Priority = "critical" | "high" | "medium" | "low";

export type RawItem =
  | string
  | {
      title: string;
      files?: string[];
      details?: string;
      priority?: Priority;
    };

export interface NormalizedItem {
  title: string;
  files: string[];
  details?: string;
  priority?: Priority;
}

export function normalizeItem(item: RawItem): NormalizedItem {
  if (typeof item === "string") return { title: item, files: [] };
  const out: NormalizedItem = { title: item.title, files: item.files ?? [] };
  if (item.details && item.details.trim()) out.details = item.details;
  if (item.priority) out.priority = item.priority;
  return out;
}

// 정렬용 weight: 작을수록 우선순위 높음. 미설정은 가장 뒤.
export const PRIORITY_RANK: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function priorityRank(p: Priority | undefined): number {
  return p ? PRIORITY_RANK[p] : 4;
}

// UI 표기. P 코드는 sort 안정성 + 시각적 구분을 위해.
export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
};

export function normalizeItems(items: RawItem[] | undefined): NormalizedItem[] {
  return (items ?? []).map(normalizeItem);
}

const RESOLVED_TITLE_SIMILARITY_THRESHOLD = 0.82;
const TITLE_STOP_WORDS = new Set([
  "부재",
  "누락",
  "미기재",
  "잔존",
  "검증",
  "절차",
  "근거",
  "수치",
  "문서",
  "작성",
  "표기",
  "혼용",
  "오타",
  "의심",
  "해결",
  "재검증",
  "기록",
  "없이",
  "사라진",
  "일부",
  "가능",
  "미정",
  "open",
  "item",
]);

function titleAliasKey(title: string): string {
  return title
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\([^)]*\)|（[^）]*）/g, "")
    .replace(/\[[^\]]*\]|【[^】]*】/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "")
    .toLowerCase();
}

function titleSimilarityText(title: string): string {
  return title
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\([^)]*\)|（[^）]*）/g, " ")
    .replace(/\[[^\]]*\]|【[^】]*】/g, " ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title: string): Set<string> {
  return new Set(
    titleSimilarityText(title)
      .split(" ")
      .filter((token) => token.length >= 2 && !TITLE_STOP_WORDS.has(token)),
  );
}

function resolvedTitleSimilarity(left: string, right: string): number {
  const leftAlias = titleAliasKey(left);
  const rightAlias = titleAliasKey(right);
  if (leftAlias && leftAlias === rightAlias) return 1;

  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (overlap < 2) return 0;

  const union = leftTokens.size + rightTokens.size - overlap;
  const jaccard = overlap / Math.max(1, union);
  const containment = Math.max(
    overlap / Math.max(1, leftTokens.size),
    overlap / Math.max(1, rightTokens.size),
  );
  return Math.max(jaccard, containment * 0.82);
}

function isResolvedTitleDuplicate(left: string, right: string): boolean {
  return (
    left === right ||
    resolvedTitleSimilarity(left, right) >= RESOLVED_TITLE_SIMILARITY_THRESHOLD
  );
}

function earlierDate(left: string, right: string): string {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function laterDate(left: string, right: string): string {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

export interface BacklogItemWithAge extends NormalizedItem {
  firstSeen: string; // ISO date string
  age: number; // # of reports the item appeared in (since firstSeen, inclusive)
}

/**
 * 최신 리포트의 backlogs[] 각 항목에 firstSeen / age 부여.
 * - 오래된 → 최신 순으로 reports 를 훑어 title 등장 횟수를 셈 (files 무시).
 * - age 는 항목이 backlog 에 머문 총 리포트 수.
 */
export function backlogWithAges(p: ProjectSummary): BacklogItemWithAge[] {
  const chrono = [...p.reports].reverse();
  const latest = p.reports[0];
  if (!latest) return [];
  const latestBacklogs = normalizeItems(latest.entry.data.backlogs);

  return latestBacklogs.map((item) => {
    let firstSeen = reportUpdatedAt(latest);
    let age = 0;
    for (const r of chrono) {
      const titles = normalizeItems(r.entry.data.backlogs).map((b) => b.title);
      if (titles.includes(item.title)) {
        if (age === 0) firstSeen = reportUpdatedAt(r);
        age += 1;
      }
    }
    return { ...item, firstSeen, age: Math.max(1, age) };
  });
}

export interface ResolvedItem extends NormalizedItem {
  resolvedDate: string; // ISO — 해결된 리포트의 작성일
  firstSeen: string; // ISO — backlog 에 처음 등장한 리포트의 작성일 (없으면 resolvedDate)
}

/**
 * 전체 history 에서 해결된 항목을 누적. 최신순 (newest resolution first).
 * 각 항목의 firstSeen 은 그 title 이 backlogs 에 처음 등장한 시점.
 * 한 번도 backlog 에 안 잡혔던 항목 (드물지만 가능) 은 firstSeen = resolvedDate.
 */
export function resolvedHistory(p: ProjectSummary): ResolvedItem[] {
  // 오래된 → 최신 순으로 훑으며 title → firstSeen 누적.
  const chrono = [...p.reports].reverse();
  const firstSeenByTitle = new Map<string, string>();
  for (const r of chrono) {
    for (const b of normalizeItems(r.entry.data.backlogs)) {
      if (!firstSeenByTitle.has(b.title)) {
        firstSeenByTitle.set(b.title, reportUpdatedAt(r));
      }
    }
  }

  const out: ResolvedItem[] = [];
  for (const r of p.reports) {
    const items = normalizeItems(r.entry.data.resolved_from_backlog);
    for (const item of items) {
      const next: ResolvedItem = {
        ...item,
        resolvedDate: reportUpdatedAt(r),
        firstSeen: firstSeenByTitle.get(item.title) ?? reportUpdatedAt(r),
      };
      const duplicate = out.find((existing) =>
        isResolvedTitleDuplicate(existing.title, next.title),
      );
      if (!duplicate) {
        out.push(next);
        continue;
      }

      duplicate.files = [...new Set([...duplicate.files, ...next.files])];
      duplicate.firstSeen = earlierDate(duplicate.firstSeen, next.firstSeen);
      duplicate.resolvedDate = laterDate(duplicate.resolvedDate, next.resolvedDate);
    }
  }
  return out;
}

/**
 * 시점별 backlog snapshot — Backlog History 모달에 쓰임. 최신순.
 */
export interface BacklogSnapshot {
  date: string;
  slug: string;
  summary: string;
  backlogs: NormalizedItem[];
  resolved: NormalizedItem[];
}
export function backlogTimeline(p: ProjectSummary): BacklogSnapshot[] {
  return p.reports.map((r) => ({
    date: reportUpdatedAt(r),
    slug: r.slug,
    summary: r.entry.data.summary,
    backlogs: normalizeItems(r.entry.data.backlogs),
    resolved: normalizeItems(r.entry.data.resolved_from_backlog),
  }));
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function progressPhase(p: number): string {
  if (p < 10) return "초기 스캐폴드";
  if (p < 30) return "기반 구축";
  if (p < 60) return "핵심 구현";
  if (p < 85) return "완성도 향상";
  return "출시 준비";
}

export type AttentionLevel = "urgent" | "watch" | "steady";

export interface ManagementSignal {
  project: string;
  risk: Risk;
  summary: string;
  progress: number;
  progressDelta: number;
  docAverage: number;
  docDelta: number;
  reportCount: number;
  todoCount: number;
  backlogCount: number;
  resolvedCount: number;
  criticalOpen: number;
  highOpen: number;
  oldestBacklogAge: number;
  oldestBacklogTitle?: string;
  lastReportAt: string;
  lastCommitAt: string;
  reportAgeDays: number;
  commitAgeDays: number;
  attention: AttentionLevel;
  score: number;
  reasons: string[];
}

function daysSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

function docAverageFromSnapshot(s: ChartSnapshot): number {
  return (s.design + s.technical + s.spec) / 3;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function managementSignal(p: ProjectSummary): ManagementSignal {
  const snapshots = chronologicalSnapshots(p);
  const first = snapshots[0]!;
  const latest = snapshots[snapshots.length - 1]!;
  const latestData = p.latest.entry.data;
  const todos = normalizeItems(latestData.todos);
  const backlogs = backlogWithAges(p);
  const resolved = resolvedHistory(p);
  const openItems = [...todos, ...backlogs];
  const criticalOpen = openItems.filter((item) => item.priority === "critical").length;
  const highOpen = openItems.filter((item) => item.priority === "high").length;
  const oldest = backlogs.reduce<BacklogItemWithAge | undefined>(
    (best, item) => (!best || item.age > best.age ? item : best),
    undefined,
  );
  const latestReportAt = lastReportAt(p);
  const latestCommitAt = lastCommitAt(p);
  const reportAgeDays = daysSince(latestReportAt);
  const commitAgeDays = daysSince(latestCommitAt);
  const docAverage = docAverageFromSnapshot(latest);
  const docDelta = docAverage - docAverageFromSnapshot(first);
  const progressDelta = latest.progress - first.progress;

  let score = 0;
  score += latest.risk === "high" ? 60 : latest.risk === "medium" ? 28 : 8;
  score += criticalOpen * 28 + highOpen * 7;
  score += latest.progress < 25 ? 18 : latest.progress < 45 ? 10 : 0;
  score += docAverage < 3 ? 12 : docAverage < 5 ? 7 : 0;
  score += oldest && oldest.age >= 10 ? 14 : oldest && oldest.age >= 5 ? 8 : 0;
  score += reportAgeDays >= 10 ? 16 : reportAgeDays >= 5 ? 9 : 0;
  score += progressDelta < 0 ? 8 : 0;

  const reasons: string[] = [];
  if (latest.risk === "high") reasons.push("high risk");
  if (criticalOpen > 0) reasons.push(`P0 ${criticalOpen}건`);
  if (highOpen > 0) reasons.push(`P1 ${highOpen}건`);
  if (oldest && oldest.age >= 5) reasons.push(`backlog ${oldest.age}회 이월`);
  if (docAverage < 4) reasons.push(`문서 ${round1(docAverage)}/10`);
  if (reportAgeDays >= 5) reasons.push(`${reportAgeDays}일 전 리포트`);
  if (progressDelta < 0) reasons.push(`진행도 ${progressDelta}pts`);
  if (reasons.length === 0) reasons.push("정상 추적");

  const attention: AttentionLevel =
    latest.risk === "high" || criticalOpen > 0 || reportAgeDays >= 10
      ? "urgent"
      : latest.risk === "medium" || highOpen > 0 || reportAgeDays >= 5
        ? "watch"
        : "steady";

  return {
    project: p.project,
    risk: latest.risk,
    summary: latestData.summary,
    progress: latest.progress,
    progressDelta,
    docAverage: round1(docAverage),
    docDelta: round1(docDelta),
    reportCount: p.reports.length,
    todoCount: todos.length,
    backlogCount: backlogs.length,
    resolvedCount: resolved.length,
    criticalOpen,
    highOpen,
    oldestBacklogAge: oldest?.age ?? 0,
    oldestBacklogTitle: oldest?.title,
    lastReportAt: latestReportAt,
    lastCommitAt: latestCommitAt,
    reportAgeDays,
    commitAgeDays,
    attention,
    score,
    reasons: reasons.slice(0, 4),
  };
}
