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
      new Date(b.entry.data.date).getTime() -
      new Date(a.entry.data.date).getTime(),
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
      new Date(b.latest.entry.data.date).getTime() -
      new Date(a.latest.entry.data.date).getTime(),
  );
}

/** 마지막 커밋 시각. meta 에 없으면 최신 리포트 `date` 로 fallback. */
export function lastCommitAt(p: ProjectSummary): string {
  return p.meta.last_commit_at ?? p.latest.entry.data.date;
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
    return {
      date: new Date(d.date).toISOString().slice(0, 10),
      isoDate: d.date,
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
    let firstSeen = latest.entry.data.date;
    let age = 0;
    for (const r of chrono) {
      const titles = normalizeItems(r.entry.data.backlogs).map((b) => b.title);
      if (titles.includes(item.title)) {
        if (age === 0) firstSeen = r.entry.data.date;
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
        firstSeenByTitle.set(b.title, r.entry.data.date);
      }
    }
  }

  const out: ResolvedItem[] = [];
  for (const r of p.reports) {
    const items = normalizeItems(r.entry.data.resolved_from_backlog);
    for (const item of items) {
      out.push({
        ...item,
        resolvedDate: r.entry.data.date,
        firstSeen: firstSeenByTitle.get(item.title) ?? r.entry.data.date,
      });
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
    date: r.entry.data.date,
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
