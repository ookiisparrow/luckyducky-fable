/**
 * 展示格式化小工具（跨页共用，避免各页各写一份）。
 */
// 金额：数字 → 两位小数字符串（￥ 由模板拼）。如 198 → '198.00'
export const money = (n) => Number(n).toFixed(2)

// 价格：数字 → 带 ￥ 两位小数。如 198 → '￥198.00'
export const yuan = (n) => '￥' + Number(n).toFixed(2)

// 星级：实心 + 空心拼满 5 颗。如 4 → '★★★★☆'
export const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)

// 秒数 → m:ss（播放器时间显示）。如 95 → '1:35'；负数/非法值按 0 处理
export const mmss = (s) => {
  s = Math.max(0, Math.round(s || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// 'mm:ss' 时长字符串 → 秒数。如 '02:40' → 160；非法段按 0 处理
export const parseDur = (d) => {
  const [m, s] = String(d).split(':').map(Number)
  return (m || 0) * 60 + (s || 0)
}
