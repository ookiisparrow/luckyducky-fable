import { ref } from 'vue'

// 乱序响应守卫（组合式·治 async-race 类·根因#8「构建过≠真能用」）。
//
// 病根：页面用共享 ref 承接「可被多次触发的异步取数」（reload/切筛选/翻页/抽屉开详情），await 后无条件
//   写结果——快点/慢网下先发的旧请求后到，会覆盖新请求的结果 → 高亮标签/抽屉头与内容错配、甚至跨单/跨人
//   数据错渲染（退款判据、客户 360 全景、批次码）。单测与类型查不出、并发真用才现。
// 用法：进异步取数函数先 `const my = gen.begin()` 取号；await 回来后 `if (gen.isStale(my)) return` 丢弃过期响应，
//   只让最后一次发起的结果落地。每种独立操作各用一个 useLatest 实例（列表 reload 与抽屉详情互不取消）。
export function useLatest() {
  let seq = 0
  return {
    begin: () => ++seq,
    isStale: (token: number) => token !== seq,
    // 取当前号但不递增：供「从属操作」（如翻页 more）绑定到「主操作」（reload/search）的代际——
    // 新主操作会作废在途从属（isStale=true），而从属自身不递增故不会反噬在途主操作（避免互杀）。
    peek: () => seq,
  }
}

type PageResult = { ok: boolean; nextCursor?: unknown; hasMore?: boolean }

// 游标「加载更多」的翻页状态（后台各列表共用）：游标、还有没有、代际、在途都收在这里；行怎么映射、错误写到哪由页面管。
// 用法：重开（首查/切筛选/刷新）先 begin() 取号，回包 isStale(号) 为真就整包丢，否则 reset(首页回包)；
//   「加载更多」调 next(按游标取一页)，拿到 null 直接收手，拿到回包按 ok 追加或报错（游标已推进）。
// Batches 码表（上一页/下一页整页替换）和 Fulfill（一次拉全量）不是追加翻页，不用它。
export function usePager() {
  const gen = useLatest()
  const hasMore = ref(false)
  let cursor: unknown = null
  let reopening = false // 首页没回来时游标还属于上一次查询，拿它翻新筛选会串档/跳页
  let paging = false // 连点只发一次：多发的那页晚回来会把游标倒回去
  return {
    hasMore,
    begin() {
      reopening = true
      paging = false // 在途的旧翻页已作废，不该挡新查询下的翻页
      return gen.begin()
    },
    /** 没过期即算首页已落地，放开翻页。 */
    isStale(token: number) {
      if (gen.isStale(token)) return true
      reopening = false
      return false
    },
    reset(r: PageResult) {
      cursor = r.ok ? r.nextCursor : null
      hasMore.value = !!(r.ok && r.hasMore)
    },
    async next<R extends PageResult>(fetchPage: (cursor: unknown) => Promise<R>): Promise<R | null> {
      if (!hasMore.value || cursor == null || reopening || paging) return null
      const token = gen.peek() // 不递增：翻页不作废在途的重开，重开会作废翻页
      paging = true
      // ponytail: fetchPage 抛异常会让 paging 卡到下次重开；api 层 client.post 失败走 ok:false 不抛，真要兜再加 try/finally
      const r = await fetchPage(cursor)
      if (gen.isStale(token)) return null
      paging = false
      if (r.ok) {
        cursor = r.nextCursor
        hasMore.value = !!r.hasMore
      }
      return r
    },
  }
}

// 游标翻页追加：只接上一页没见过的项——服务端页边界重叠时同一条不重复出现。
export function appendNew<T>(prev: T[], next: T[], key: (_x: T) => unknown = (x: any) => x.id): T[] {
  const seen = new Set(prev.map(key))
  return [...prev, ...next.filter((x) => !seen.has(key(x)))]
}
