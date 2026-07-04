import { defineConfig } from 'astro/config'
import sitemap from '@astrojs/sitemap'

// 内容站（M4·ADR §23）：GEO 语料源——可爬可收录是硬指标（site 绝对域名 + sitemap + robots）。
// 部署：CloudBase 静态托管（luckyducky.cn 已备案）；构建纯静态零后端。
export default defineConfig({
  site: 'https://www.luckyducky.cn',
  integrations: [sitemap()],
})
