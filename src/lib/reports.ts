import { getCollection, type CollectionEntry } from "astro:content";

export type ReportEntry = CollectionEntry<"reports">;
export type Risk = "low" | "medium" | "high";

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
    summaries.push({ project, reports: sorted, latest: sorted[0]! });
  }
  return summaries.sort(
    (a, b) =>
      new Date(b.latest.entry.data.date).getTime() -
      new Date(a.latest.entry.data.date).getTime(),
  );
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

export interface BacklogItemWithAge {
  text: string;
  firstSeen: string; // ISO date string
  age: number; // # of reports the item appeared in (since firstSeen, inclusive)
}

/**
 * 최신 리포트의 backlogs[] 각 항목에 firstSeen / age 부여.
 * - 오래된 → 최신 순으로 reports 를 훑어 텍스트 등장 횟수를 셈.
 * - age 는 항목이 backlog 에 머문 총 리포트 수.
 */
export function backlogWithAges(p: ProjectSummary): BacklogItemWithAge[] {
  const chrono = [...p.reports].reverse();
  const latest = p.reports[0];
  if (!latest) return [];
  const latestBacklogs = latest.entry.data.backlogs ?? [];

  return latestBacklogs.map((text) => {
    let firstSeen = latest.entry.data.date;
    let age = 0;
    for (const r of chrono) {
      const list = r.entry.data.backlogs ?? [];
      if (list.includes(text)) {
        if (age === 0) firstSeen = r.entry.data.date;
        age += 1;
      }
    }
    return { text, firstSeen, age: Math.max(1, age) };
  });
}

export interface ResolvedItem {
  text: string;
  resolvedDate: string; // ISO
}

/**
 * 전체 history 에서 해결된 항목을 누적. 최신순 (newest resolution first).
 */
export function resolvedHistory(p: ProjectSummary): ResolvedItem[] {
  const out: ResolvedItem[] = [];
  for (const r of p.reports) {
    const list = r.entry.data.resolved_from_backlog ?? [];
    for (const text of list) {
      out.push({ text, resolvedDate: r.entry.data.date });
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
  backlogs: string[];
  resolved: string[];
}
export function backlogTimeline(p: ProjectSummary): BacklogSnapshot[] {
  return p.reports.map((r) => ({
    date: r.entry.data.date,
    slug: r.slug,
    summary: r.entry.data.summary,
    backlogs: r.entry.data.backlogs ?? [],
    resolved: r.entry.data.resolved_from_backlog ?? [],
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
