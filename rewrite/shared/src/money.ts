/**
 * 金额品牌类型（设计约束#4：金额全链整数分——旧线病根「金额浮点靠手工纪律」的类型层根治）。
 * 钱一律「分」整数；元只在展示层出现。把普通 number 当 Fen 用会编译失败，
 * 必须经 toFen / asFen 显式转换——浮点金额在类型边界被挡下。（守卫 rw-fen-branded-type）
 * 黄金基准：rewrite/golden/kit-security.md §I。
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

/**
 * 售后行分摊额（设计约束#5 镜像消灭：钱的分摊公式只此一份）：按行金额占实付比例分摊，
 * 封顶「实付 − 同单已占额度」。申请时算定与同意时重算封顶共用本函数。
 */
export function refundShareFen(amountFen: Fen, goodsFen: Fen, itemFen: Fen, usedFen: Fen): Fen {
  const share = goodsFen > 0 ? asFen(Math.min(amountFen, Math.round((amountFen * itemFen) / goodsFen))) : asFen(0)
  return asFen(Math.min(share, Math.max(0, amountFen - usedFen)))
}
