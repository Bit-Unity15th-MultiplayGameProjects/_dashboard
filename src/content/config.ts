import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// todos / backlogs / resolved_from_backlog 의 개별 항목 스키마.
// 옛 리포트는 plain string, 신규는 `{title, files?, details?}` 객체를 허용한다.
// `details` 는 title 이 자명하지 않을 때 1 줄로 근거/맥락을 보강. 토큰 비용
// 억제를 위해 프롬프트 차원에서 60-80자 권장 + resolved_from_backlog 금지를
// 강제하지만, 스키마 max 는 빌드 안전망으로 120 으로 둔다.
// 정규화는 src/lib/reports.ts 의 normalizeItem 에서 처리.
const itemSchema = z.union([
  z.string().min(1),
  z.object({
    title: z.string().min(1),
    files: z.array(z.string()).optional(),
    details: z.string().min(1).max(120).optional(),
  }),
]);

/**
 * `reports` collection
 *
 * - Path layout: `reports/{repo-name}/{iso-timestamp}.md`
 * - `.meta.json` 파일은 상태 추적용이므로 collection에서 제외한다.
 * - frontmatter 스키마는 CLAUDE.md의 "리포트 포맷" 섹션과 동기화되어야 한다.
 *
 * Astro 5 Content Layer API의 glob loader를 사용해 repo 루트의
 * `reports/` 디렉토리를 직접 읽는다 (`src/content/` 아래가 아님).
 */
const reports = defineCollection({
  loader: glob({
    pattern: ["**/*.md", "!**/.meta.json"],
    base: "./reports",
  }),
  schema: z.object({
    // ── 기존 필드 ──
    project: z.string().min(1),
    date: z.string().datetime({ offset: true }),
    commit_range: z
      .string()
      .regex(/^[0-9a-f]{7,40}\.\.[0-9a-f]{7,40}$/i, {
        message: "commit_range must be in `from_sha..to_sha` form",
      }),
    commit_count: z.number().int().nonnegative(),
    risk_level: z.enum(["low", "medium", "high"]),
    tags: z.array(z.string()).default([]),
    summary: z.string().min(1),

    // ── 신규 필드 ──
    // 예상 진행도 (%). Claude 가 문서/코드 현황/남은 작업을 종합해 판정.
    progress_estimate: z.number().int().min(0).max(100),
    // 문서 완성도. `_sample/docs` 를 기준으로 10점 척도 세 축.
    doc_scores: z.object({
      design: z.number().int().min(0).max(10),
      technical: z.number().int().min(0).max(10),
      spec: z.number().int().min(0).max(10),
    }),
    // 현재 해야 할 작업 목록. 다음 리포트까지 유효.
    // 각 항목은 한 줄 문자열, 또는 `{title, files?}` 객체. 옛 리포트(string only) 호환.
    todos: z.array(itemSchema).default([]),
    // 이 시점에 미해결로 남은 이슈. 다음 리포트의 `{{PREVIOUS_BACKLOG}}` 로 재주입.
    backlogs: z.array(itemSchema).default([]),
    // 이전 backlog 중 이번에 해결된 항목. 해결된 게 없으면 빈 배열.
    resolved_from_backlog: z.array(itemSchema).default([]),
  }),
});

export const collections = {
  reports,
};
