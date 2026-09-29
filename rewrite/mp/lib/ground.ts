// 地面线上方留白（小货车/小鸭蛋/金币落地的那条线·全站同一高度）：屏高 < 700 用 56，其余 120
// （UI 审查 2026-09-29·Claude Design「UI 审查 6 问」2a·老板选定）。按**屏幕**高度取，不按窗口高度：
// tab 页窗口扣了底栏会比普通页矮，用窗口高会让同一台手机上各页地面线不齐。拿不到屏高（测试桩）按 120。
export function groundGap(): number {
  const w = (globalThis as { wx?: { getWindowInfo?: () => { screenHeight: number } } }).wx
  const h = w && w.getWindowInfo ? w.getWindowInfo().screenHeight : 0
  return h > 0 && h < 700 ? 56 : 120
}
