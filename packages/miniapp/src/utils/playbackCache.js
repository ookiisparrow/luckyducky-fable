/**
 * 分段视频播放地址解析器（纯函数工厂）——缓存 + 预取，治「每次切段都现取地址→真机段间转场卡一下」。
 *
 * 痛（根因#8 真机才暴露，dev/模拟器快网掩盖）：原 player 只在「段 id 真变了」那一刻才云调用
 * getPlaybackUrl 换临时 URL（watch 触发），当前段播放期间下一段地址完全闲着没取；切到下一段 /
 * 回到看过的段都重新现取一趟 → 段间转场要等一个云往返才起播。
 *
 * 治法（纯前端·不动云函数）：
 *  ① 缓存（⑤）：按 segId 缓存临时 URL，带 TTL（保守取 25min，远小于服务端临时 URL 过期，
 *     防取到「将过期」地址 buffer 一半失效）；命中即返回，不再云往返。回看 / 重复段零取址。
 *  ② 预取（①）：当前段就绪/播放期间，把「下一段」地址先换回填进缓存（prefetch 静默预热、
 *     失败不影响主流程）；用户点「下一段」时直接命中缓存 → 段间转场接近秒切。
 *  ③ in-flight 去重：同一 segId 取址在途时（如 load 与 prefetch 撞上）复用同一 Promise，
 *     不发两次云调用、不拿两个不同临时 URL（两个不同 URL 落到同一 <video> src 会重载闪）。
 *
 * 抽成纯函数工厂（依赖 fetcher/now 注入）单独可单测——缓存命中/过期/去重/预取最易在边界出错，
 * player 只负责把「下一段 segId」喂给 prefetch、把「当前段 segId」喂给 load。
 *
 * @param {Object}   o
 * @param {Function} o.fetcher  (segId) => Promise<string> 真正换临时 URL（store 绑当前课 id）
 * @param {number}  [o.ttlMs]   缓存有效期（默认 25min）
 * @param {Function}[o.now]     取当前毫秒（默认 Date.now，测试可注入）
 * @returns {{ load(segId):Promise<string>, prefetch(segId):void, peek(segId):string|null, clear():void }}
 */
export function createPlaybackResolver({
  fetcher,
  ttlMs = 25 * 60 * 1000,
  now = () => Date.now(),
}) {
  const cache = new Map() // segId -> { url, exp }
  const inflight = new Map() // segId -> Promise<string>（取址在途，去重用）

  // 取新鲜缓存：命中且未过期返回 url；过期则清掉返回 null
  function fresh(segId) {
    const e = cache.get(segId)
    if (!e) return null
    if (e.exp <= now()) {
      cache.delete(segId)
      return null
    }
    return e.url
  }

  // 取址（缓存优先 + in-flight 去重）：命中缓存即返回；否则发起一次取址、在途期间复用同一 Promise，
  // 成功（非空）才写缓存。失败 / 空（素材未剪·NOT_ENTITLED 等）不缓存 → 下次仍可重试。
  function load(segId) {
    if (!segId) return Promise.resolve('')
    const hit = fresh(segId)
    if (hit) return Promise.resolve(hit)
    if (inflight.has(segId)) return inflight.get(segId)
    // fetcher 同步调起（Promise.resolve 包裹其返回）→ in-flight 立即登记、撞上的取址才能复用
    const p = Promise.resolve(fetcher(segId))
      .then((url) => {
        if (url) cache.set(segId, { url, exp: now() + ttlMs })
        return url || ''
      })
      .finally(() => inflight.delete(segId))
    inflight.set(segId, p)
    return p
  }

  // 预热下一段：已有新鲜缓存 / 正在取 → 跳过；否则后台取址填缓存，失败静默（不影响当前段播放）
  function prefetch(segId) {
    if (!segId || fresh(segId) || inflight.has(segId)) return
    load(segId).catch(() => {})
  }

  return {
    load,
    prefetch,
    peek: (segId) => fresh(segId), // 同步看缓存（测试/调试用）
    clear: () => {
      cache.clear()
      inflight.clear()
    },
  }
}
