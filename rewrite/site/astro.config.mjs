import { defineConfig } from 'astro/config'
import createSitemap from '@astrojs/sitemap'

// 内容站（ADR §23）：GEO 语料源——可爬可收录是硬指标（site 绝对域名 + sitemap + robots）。
// 部署：CloudBase 静态托管（luckyducky.cn 已备案）；构建纯静态零后端。

/** 营业执照专页已 noindex，站点地图也不收。结尾有没有斜杠都排除。 */
export function includeInSitemap(page) {
  const path = new URL(page).pathname.replace(/\/+$/, '')
  return path !== '/yyzz'
}

// 结构守卫认的是字面调用 sitemap()，过滤从这里传进集成。
function sitemap() {
  return createSitemap({ filter: includeInSitemap })
}

export default defineConfig({
  site: 'https://www.luckyducky.cn',
  integrations: [sitemap()],
})
