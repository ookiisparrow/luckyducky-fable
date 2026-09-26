// 北京时间（UTC+8，无夏令时）换算：固定平移 8 小时，不看运行机本地时区——云函数跑在 UTC、admin 跑在用户浏览器，
// 两端必须算出同一个日历日。

/** ms 时间戳平移到北京时间后的 ISO 串。只取其中的日期/时间数字用，末尾的 Z 不表示 UTC。 */
export const cstIso = (ts: number): string => new Date(Number(ts) + 8 * 3600_000).toISOString()
/** ms 时间戳 → 北京日历日 'YYYY-MM-DD' */
export const dayKeyCST = (ts: number) => cstIso(ts).slice(0, 10)
/** 'YYYY-MM-DD' → 北京当日 00:00:00 的 ms */
export const dayStartMsCST = (d: string) => Date.parse(d + 'T00:00:00+08:00')
