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
 *
 * 数据契约：各 store 可在 persist 里提供 sanitize(parsed) —— 回灌前清洗，过滤
 * 残缺/旧格式数据，避免「脏数据撑乱页面」（见 store/cart.js、address.js 的契约）。
 */
import logger from '@/utils/logger.js'

export function persistPlugin({ store, options }) {
  const cfg = options.persist
  if (!cfg) return

  const key = `ld_store_${store.$id}`
  const paths = cfg === true ? null : cfg.paths || null

  // 1) 启动回灌：把上次存的状态合并回来。
  //    解析失败 → 忽略；解析成功但结构残缺 → 过 cfg.sanitize 清洗（见各 store 的
  //    persist.sanitize），避免脏数据/旧格式撑乱页面。
  try {
    const saved = uni.getStorageSync(key)
    if (saved) {
      let data = JSON.parse(saved)
      if (typeof cfg.sanitize === 'function') data = cfg.sanitize(data) || {}
      store.$patch(data)
    }
  } catch (e) {
    // 存储损坏：丢弃，退回初始 state
    logger.warn('persist', `回灌 ${key} 失败，已退回初始态`, e)
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
