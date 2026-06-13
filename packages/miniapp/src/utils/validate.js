/**
 * 轻量数据校验工具。
 * 用于「持久化回灌」「将来 api 返回」等外部数据的边界清洗，把"脏数据撑乱页面"
 * 挡在入口（见 store/persist.js 的 sanitize 钩子 + 各 store 的契约）。
 */
import logger from './logger.js'

/**
 * 过滤数组，只保留通过 predicate 的元素；有元素被丢弃时记 warn 留痕。
 * 非数组一律返回 []（防 storage 里存了非数组的脏值）。
 *
 * @param {any} arr 待清洗的数据
 * @param {(item:any)=>boolean} predicate 有效性判定
 * @param {string} tag 日志标签（模块名，便于定位）
 * @returns {any[]} 清洗后的数组
 */
export function keepValid(arr, predicate, tag) {
  if (!Array.isArray(arr)) {
    if (arr != null) logger.warn(tag, '期望数组、实际非数组，已丢弃', arr)
    return []
  }
  const out = arr.filter(predicate)
  if (out.length !== arr.length) {
    logger.warn(tag, `丢弃 ${arr.length - out.length} 条残缺数据（共 ${arr.length} 条）`)
  }
  return out
}
