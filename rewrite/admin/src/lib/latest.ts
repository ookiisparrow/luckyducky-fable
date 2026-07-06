// 乱序响应守卫（组合式·治 async-race 类·守卫 rw-admin-latest-golden·根因#8「构建过≠真能用」）。
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
  }
}
