/**
 * 极简 Pinia 持久化插件（跨端：用 uni storage，H5 与小程序都通用）。
 *
 * 用法：在 defineStore 第二参里加 persist —— `true` 存整个 state，
 * 或 `{ paths: ['a', 'b'] }` 只存指定字段（适合排除「结算草稿」这类临时态）。
 *
 * 为什么自己写、不引库：常见的 pinia-plugin-persistedstate 默认走 localStorage，
 * 小程序端没有 localStorage 会直接报错；uni.getStorageSync/setStorageSync 才是跨端通用的。
 *
 * 时机：Pinia 插件在 store 首次被 useXxxStore() 实例化时同步执行，
 * 这里同步把上次存的状态回灌，所以页面读 store 时已是水合后的数据，无闪烁。
 */
export function persistPlugin({ store, options }) {
  const cfg = options.persist
  if (!cfg) return

  const key = `ld_store_${store.$id}`
  const paths = cfg === true ? null : cfg.paths || null

  // 1) 启动回灌：把上次存的状态合并回来（解析失败就忽略，避免脏数据卡死页面）
  try {
    const saved = uni.getStorageSync(key)
    if (saved) store.$patch(JSON.parse(saved))
  } catch {
    // 存储损坏：丢弃，退回初始 state
  }

  // 2) 变更即存（只存 paths 指定的字段，未指定则整份）。
  // flush: 'sync' —— 每次变更同步落盘：手机端 app 可能被系统随时杀掉，
  // 默认的批量(异步)刷新可能丢掉最后一次变更；我们数据量很小，同步写无压力。
  store.$subscribe(
    (_mutation, state) => {
      try {
        const data = paths ? Object.fromEntries(paths.map((p) => [p, state[p]])) : state
        uni.setStorageSync(key, JSON.stringify(data))
      } catch {
        // 写入失败（如配额已满）：静默，下次变更再试
      }
    },
    { flush: 'sync' },
  )
}
