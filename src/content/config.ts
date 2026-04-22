import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

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
  }),
});

export const collections = {
  reports,
};
