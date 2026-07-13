import { defineCollection, z } from 'astro:content'

// 教程集合契约：reviewed=false 的 AI 起草稿页面带「初稿待审」横幅（守卫 rw-site-in-gates 核标记在）；
// steps 供 HowTo 结构化数据；faq 供 FAQPage。
const tutorials = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string().max(60),
    description: z.string().max(160), // meta description 长度纪律
    datePublished: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateModified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // 改稿日（可选·出 Article dateModified 与 og article:modified_time）
    reviewed: z.boolean(), // AI 起草稿必须显式标记·不冒充定稿
    steps: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  }),
})

export const collections = { tutorials }
