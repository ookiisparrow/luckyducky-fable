/**
 * 统一分级日志（项目唯一日志出口）。
 *
 * 为什么有它：原先项目零日志、出错静默。统一从这里走，方便控制级别、加前缀，
 * 并预留「错误上报」钩子（将来接 Sentry / uni.report 时只改这里，调用处不动）。
 *
 * 用法：logger.error('模块名', err, ...)、logger.warn('persist', '丢弃脏数据', n)
 *   第一个参数是模块/场景标签（便于定位），其后是任意内容。
 *
 * 级别：dev 全开；生产只留 warn / error（降噪又不丢关键问题）。
 */

// 构建时被 Vite / uni 静态替换为字面量；小程序运行时不真正访问 process
const isDev = process.env.NODE_ENV !== 'production'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const threshold = isDev ? LEVELS.debug : LEVELS.warn

// 预留：将来接错误上报（Sentry / uni.report）。现在为 no-op。
function report(/* tag, args */) {}

function out(level, tag, args) {
  if (LEVELS[level] < threshold) return
  const prefix = `[${level.toUpperCase()}]${tag ? ` ${tag}` : ''}`
  const fn = console[level] || console.log
  fn(prefix, ...args)
  if (level === 'error') report(tag, args)
}

export const logger = {
  debug: (tag, ...a) => out('debug', tag, a),
  info: (tag, ...a) => out('info', tag, a),
  warn: (tag, ...a) => out('warn', tag, a),
  error: (tag, ...a) => out('error', tag, a),
}

export default logger
