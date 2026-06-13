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

// epoch 毫秒 → 相对时间（评价时间等）。刚刚 / N 分钟前 / N 小时前 / N 天前，
// 超过 30 天显示日期（YYYY-MM-DD）。非法值返回 ''
export const timeAgo = (ms, now = Date.now()) => {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''
  const diff = Math.max(0, now - n)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d <= 30) return `${d} 天前`
  return dateTime(n).slice(0, 10)
}

// epoch 毫秒 → 'YYYY-MM-DD HH:mm'（订单付款时间等）。非法值返回 ''
export const dateTime = (ms) => {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(n)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
