/**
 * 金额品牌类型（根因账本 #4：金额浮点靠手工纪律 → 类型层绝迹）。
 * 钱一律「分」整数；元只在展示层出现。把普通 number 当 Fen 用会编译失败，
 * 必须经 toFen / asFen 显式转换——浮点金额在类型边界被挡下。
 */
export type Fen = number & { readonly __brand: 'Fen' }

/** 元 → 分（四舍五入到整分）。跨边界（前端传元、库存分）唯一入口。 */
export function toFen(yuan: number): Fen {
  return Math.round(yuan * 100) as Fen
}

/** 已是整数分的值断言为 Fen（非整数即抛，脏数据早暴露）。 */
export function asFen(n: number): Fen {
  if (!Number.isInteger(n)) throw new Error('NOT_INTEGER_FEN:' + n)
  return n as Fen
}

/** 分 → 元（展示用）。 */
export function fenToYuan(fen: Fen): number {
  return (fen as number) / 100
}
