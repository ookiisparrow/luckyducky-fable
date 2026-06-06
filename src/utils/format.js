/**
 * 展示格式化小工具（跨页共用，避免各页各写一份）。
 */
// 金额：数字 → 两位小数字符串（￥ 由模板拼）。如 198 → '198.00'
export const money = (n) => Number(n).toFixed(2)

// 价格：数字 → 带 ￥ 两位小数。如 198 → '￥198.00'
export const yuan = (n) => '￥' + Number(n).toFixed(2)

// 星级：实心 + 空心拼满 5 颗。如 4 → '★★★★☆'
export const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)
