// 首页「回顶意图」跨页标记（mp-7fixes 批3）：tab 页实例常驻、上次滚动位置默认保留（合理行为）。
// 但「兜底送你去逛逛」这类意图性落地（我页无课兜底 / welcome 先逛逛再进课）不该继承用户上次恰好滚到
// 哪儿的位置——落在 FAQ 板块视口顶部会被误读成弹出错误文案（真相见 me.ts/welcome.ts 置位点注释）。
// 语义：**读即清**——consumeHomeTop() 读一次就复位，防标记残留误伤下一次正常回首页（正常切 tab 不经
// 任何置位点，行为不受影响；这是本设计的关键不变量，别改成「只置不清」或「读了不清」）。
// 批3b（评审扩线）：调用点过了 Rule of Three（me/welcome/paysuccess/checkout×2 共五处）——
// 收敛出统一出口 goHomeTab()，置位+跳转配对收口在此，防将来新增出口漏挂置位。
let wantTop = false

/** 置位：下一次 home onShow 落地时回到页面顶部。 */
export function requestHomeTop(): void {
  wantTop = true
}

/** 读即清：返回当前是否需要回顶，并把标记复位——只消费一次。 */
export function consumeHomeTop(): boolean {
  const v = wantTop
  wantTop = false
  return v
}

/** 意图性去首页的统一出口：置位回顶标记与 switchTab 配对收敛在此，防新增出口漏挂
 *  （Rule of Three：me/welcome/paysuccess/checkout×2 五处）。 */
export function goHomeTab(): void {
  requestHomeTop()
  wx.switchTab({ url: '/pages/home/home' })
}
