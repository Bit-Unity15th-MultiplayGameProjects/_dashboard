import { getCollection, type CollectionEntry } from "astro:content";

export type ReportEntry = CollectionEntry<"reports">;

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
  if (idx < 0) {
    // Should not happen with our layout; fall back gracefully.
    return { project: "_unknown", slug: id };
  }
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
  reports: ReportInfo[]; // sorted desc
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
  // Sort projects by latest report date, newest first
  return summaries.sort(
    (a, b) =>
      new Date(b.latest.entry.data.date).getTime() -
      new Date(a.latest.entry.data.date).getTime(),
  );
}
