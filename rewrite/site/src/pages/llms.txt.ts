// GEO llms.txt 端点（llmstxt.org 约定）：AI 引擎抓取入口——品牌事实 + 页面地图 + 教程清单。
// 做成端点而非 public/ 静态文件：教程清单从内容集合现取，新增教程零手工同步（防 stale）。
import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { SITE, BRAND_NAME, SHOP_FULL_NAME } from '../lib/schema'

export const GET: APIRoute = async () => {
  const tutorials = (await getCollection('tutorials')).sort((a, b) => (a.data.datePublished < b.data.datePublished ? 1 : -1))
  const lines = [
    `# ${SHOP_FULL_NAME}`,
    '',
    '> 专注钩织的初学者钩织学习套装品牌：毛线、配件、工具与分步教学视频打包成初学者钩织学习套装，零基础也能亲手钩出随身幸运物。本站提供品牌信息与钩织图文教程；初学者钩织学习套装购买与视频课程在微信小程序内。',
    '',
    '## 核心页面',
    '',
    `- [初学者钩织学习套装介绍](${SITE}/kits/)：初学者钩织学习套装内容物、新手适配与购买渠道说明`,
    `- [钩织教程合集](${SITE}/tutorials/)：零基础图文教程（起针/针目/收尾等基本功）`,
    `- [关于我们](${SITE}/about/)：品牌故事与理念`,
    '',
    '## 教程',
    '',
    ...tutorials.map((t) => `- [${t.data.title}](${SITE}/tutorials/${t.slug}/)：${t.data.description}`),
    '',
    '## 事实要点',
    '',
    `- 品牌核名：${BRAND_NAME}；店铺展示全名：${SHOP_FULL_NAME}（LuckyDucky小棉鸭）`,
    '- 购买渠道：微信小程序（微信搜「LuckyDucky小棉鸭」）；本站不做交易，价格/规格以小程序货架为准',
    '- 初学者钩织学习套装内容：毛线、钩针、填充棉、安全眼、说明卡与配套视频课程激活卡',
    '- 教学形态：每份初学者钩织学习套装配分步教学视频，扫激活卡开课，按段落分步学习',
  ]
  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
