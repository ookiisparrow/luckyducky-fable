/**
 * 分段视频播放地址解析器（纯函数工厂）——缓存 + 预取，治「每次切段都现取地址→真机段间转场卡一下」。
 *
 * 痛（根因#8 真机才暴露，dev/模拟器快网掩盖）：原 player 只在「段 id 真变了」那一刻才云调用
 * getPlaybackUrl 换临时 URL（watch 触发），当前段播放期间下一段地址完全闲着没取；切到下一段 /
 * 回到看过的段都重新现取一趟 → 段间转场要等一个云往返才起播。
 *
 * 治法（纯前端·不动云函数）：
 *  ① 缓存：按 (courseId, segId) 缓存临时 URL，带 TTL（保守取 25min，远小于服务端临时 URL 过期，
 *     防取到「将过期」地址 buffer 一半失效）；命中即返回，不再云往返。回看 / 重复段零取址。
 *  ② 预取：当前段就绪/播放期间，把「下一段」地址先换回填进缓存（prefetch 静默预热、
 *     失败不影响主流程）；用户点「下一段」时直接命中缓存 → 段间转场接近秒切。
 *  ③ in-flight 去重：同一 (courseId,segId) 取址在途时（如 load 与 prefetch 撞上）复用同一 Promise，
 *     不发两次云调用、不拿两个不同临时 URL（两个不同 URL 落到同一 <video> src 会重载闪）。
 *
 * 缓存键含 courseId（审计 #1）：段 id 由种子按课时局部命名（`${lessonId}-s${i}`·不带 courseId），
 * 跨课**不保证唯一**——上第二门课若复用课时模板会撞同段 id。键只用 segId 会让两课串味（命中别课的
 * 临时 URL·真机播错课·根因#8 单课样本掩盖）。故键 = `courseId::segId`，courseId 作参数流入、
 * 不再靠模块级可变变量（消除「取址时 courseId 已被另一课覆写」的竞态·审计 #3 同源）。
 *
 * 抽成纯函数工厂（依赖 fetcher/now 注入）单独可单测——缓存命中/过期/去重/预取/失效最易在边界出错。
 *
 * @param {Object}   o
 * @param {Function} o.fetcher  (courseId, segId) => Promise<string> 真正换临时 URL（服务端鉴权）
 * @param {number}  [o.ttlMs]   缓存有效期（默认 25min）
 * @param {Function}[o.now]     取当前毫秒（默认 Date.now，测试可注入）
 * @returns 解析器：load / prefetch / invalidate / peek / clear
 */
export function createPlaybackResolver({
  fetcher,
  ttlMs = 25 * 60 * 1000,
  now = () => Date.now(),
}) {
  const cache = new Map() // `${courseId}::${segId}` -> { url, exp }
  const inflight = new Map() // 同上键 -> Promise<string>（取址在途，去重用）
  const keyOf = (courseId, segId) => `${courseId}::${segId}`

  // 取新鲜缓存：命中且未过期返回 url；过期则清掉返回 null
  function fresh(key) {
    const e = cache.get(key)
    if (!e) return null
    if (e.exp <= now()) {
      cache.delete(key)
      return null
    }
    return e.url
  }

  // 取址（缓存优先 + in-flight 去重）：命中缓存即返回；否则发起一次取址、在途期间复用同一 Promise，
  // 成功（非空）才写缓存。失败 / 空（素材未剪·NOT_ENTITLED 等）不缓存 → 下次仍可重试。
  function load(courseId, segId) {
    if (!segId) return Promise.resolve('')
    const key = keyOf(courseId, segId)
    const hit = fresh(key)
    if (hit) return Promise.resolve(hit)
    if (inflight.has(key)) return inflight.get(key)
    // fetcher 同步调起（Promise.resolve 包裹其返回）→ in-flight 立即登记、撞上的取址才能复用。
    // courseId 作参数同步捕获（非读模块变量）→ 取址带的永远是发起时那门课（防竞态串课·审计 #3）。
    const p = Promise.resolve(fetcher(courseId, segId))
      .then((url) => {
        if (url) cache.set(key, { url, exp: now() + ttlMs })
        return url || ''
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }

  // 预热下一段：已有新鲜缓存 / 正在取 → 跳过；否则后台取址填缓存，失败静默（不影响当前段播放）
  function prefetch(courseId, segId) {
    if (!segId) return
    const key = keyOf(courseId, segId)
    if (fresh(key) || inflight.has(key)) return
    load(courseId, segId).catch(() => {})
  }

  // 失效单条（审计 #2）：错误重试时先失效本段缓存，让 retry 真重取新地址、而非命中那条已失效的旧 URL
  // （临时 URL 服务端已过期但本地 TTL 内仍「新鲜」→ 不失效就会拿回同一坏地址、重试形同空操作）。
  function invalidate(courseId, segId) {
    const key = keyOf(courseId, segId)
    cache.delete(key)
    inflight.delete(key)
  }

  return {
    load,
    prefetch,
    invalidate,
    peek: (courseId, segId) => fresh(keyOf(courseId, segId)), // 同步看缓存（测试/调试用）
    clear: () => {
      cache.clear()
      inflight.clear()
    },
  }
}
