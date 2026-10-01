// 页面内容 CMS 会话缓存单源（跨页共享·镜像 lib/catalog.ts / lib/courses.ts 缓存范式·根因账本#15）：
// 五页可编辑文案本会话内基本不变（catalogPlayer 由目录页 + 播放页共用），逐页缓存住首次成功回包、复用零重拉。
// 在途去重（inflight 按页收口：并发同页只真取一次）；失败不缓存、不覆盖既有（下次仍可重试）。
// 不持久化（会话内即可）。调用方（页面）在 await 恢复点仍须自行做 _seq/unloaded 复核——
// 本层只负责「取一次、缓存住」，不管页面生命周期。
import { getContent, getPageContent as apiGetPageContent } from '../api/catalog'
import type { ApiResult } from '../utils/cloud'
import { createInflight } from './inflight'

export type PageKey = 'welcome' | 'catalogPlayer' | 'mePage' | 'about' | 'agreement'

const cache: Partial<Record<PageKey, unknown>> = {}
const flight = createInflight<unknown>()

// 该页 CMS 内容对象（拉不到/未部署/未知 page → null·调用方经 mapPages 回退默认文案·永不空屏）。
// 命中缓存直接复用；在途去重（并发同页复用同一 promise）；仅成功回包写缓存（含 content:null 的成功空态·
// 避免每次重拉），失败（网络/未部署）返 null 且不缓存、不覆盖既有。
// 无需挂「代次 token」防乱序：同页请求已被 inflight 串行化（在途即复用、结算才清键，不存在同页两只
// 在途请求）；全局单计数器 token 反而会在「跨页并发」时误伤——A 页在途时 B 页发起会把 A 的成功回包
// 判为过期、跳过缓存写入，弱网多页快速切换下 A 页每次回来都白拉一遍。
export async function getPageContent(page: PageKey): Promise<unknown> {
  if (page in cache) return cache[page]
  return flight.run(page, async () => {
    const r = await apiGetPageContent(page)
    const content = r.ok ? (r.content ?? null) : null
    if (r.ok) cache[page] = content // 仅成功落缓存；失败不缓存下次重试
    return content
  })
}

// 首页内容（getContent：首页文案 + 各页背景图·#444）：首页 reload 强刷（force）并回填；目录页 / 欢迎页命中复用零重拉，
// 冷进（扫码直进欢迎页）照常拉。原样返回回包（调用方照旧判 ok 取 home）；仅成功落缓存，失败不缓存、不覆盖既有。
// force 在途时后到调用同样复用在途结果（同 lib/catalog getAllProducts 口径）。
let home: ApiResult | null = null
const homeFlight = createInflight<ApiResult>()
export async function getHomeContent(opts?: { force?: boolean }): Promise<ApiResult> {
  if (!opts?.force && home) return home
  return homeFlight.run('home', async () => {
    const r = await getContent()
    if (r.ok) home = r
    return r
  })
}

/** 仅测试：清空内存态强制下次重新回灌。 */
export function __resetForTest(): void {
  for (const k of Object.keys(cache) as PageKey[]) delete cache[k]
  flight.clear()
  home = null
  homeFlight.clear()
}
