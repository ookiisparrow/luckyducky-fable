// 页面内容 CMS 会话缓存单源（跨页共享·镜像 lib/catalog.ts / lib/courses.ts 缓存范式·根因账本#15）：
// 五页可编辑文案本会话内基本不变（catalogPlayer 由目录页 + 播放页共用），逐页缓存住首次成功回包、复用零重拉。
// 在途去重（token：并发同页只真取一次·防乱序回包各写各的）；失败不缓存、不覆盖既有（下次仍可重试）。
// 不持久化（会话内即可）。调用方（页面）在 await 恢复点仍须自行做 _seq/unloaded 复核（守卫
// rw-mp-await-side-effect-unloaded-recheck）——本层只负责「取一次、缓存住」，不管页面生命周期。
import { getPageContent as apiGetPageContent } from '../api/catalog'

export type PageKey = 'welcome' | 'catalogPlayer' | 'mePage' | 'about' | 'agreement'

const cache: Partial<Record<PageKey, unknown>> = {}
const inflight: Partial<Record<PageKey, Promise<unknown>>> = {}
let token = 0 // 取证代次·在途去重键的一部分（同 player.ts playToken 惯用法·防乱序回包串写缓存）

// 该页 CMS 内容对象（拉不到/未部署/未知 page → null·调用方经 mapPages 回退默认文案·永不空屏）。
// 命中缓存直接复用；在途去重（并发同页复用同一 promise）；仅成功回包写缓存（含 content:null 的成功空态·
// 避免每次重拉），失败（网络/未部署）返 null 且不缓存、不覆盖既有。
export async function getPageContent(page: PageKey): Promise<unknown> {
  if (page in cache) return cache[page]
  const going = inflight[page]
  if (going) return going // 在途去重：并发同页复用同一 promise（同 createPlaybackCache）
  const my = ++token
  const p = (async () => {
    try {
      const r = await apiGetPageContent(page)
      const content = r.ok ? (r.content ?? null) : null
      // 只在仍是最新一次发起（my===token·防慢回旧请求串写）且成功时落缓存；失败不缓存下次重试。
      if (r.ok && my === token) cache[page] = content
      return content
    } finally {
      delete inflight[page] // 结算即清在途键（同 createPlaybackCache 的 inflight.delete·此刻本页只此一 promise）
    }
  })()
  inflight[page] = p
  return p
}

/** 仅测试：清空内存态强制下次重新回灌。 */
export function __resetForTest(): void {
  for (const k of Object.keys(cache) as PageKey[]) delete cache[k]
  for (const k of Object.keys(inflight) as PageKey[]) delete inflight[k]
  token = 0
}
