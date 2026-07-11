// 首页定格动画模块（三档拨杆·状态切换器）纯逻辑单源。语义移植自设计稿 主版本/Sections.jsx
// FlipFrame（2026-07-11 用户拍板定性「状态切换器」·先在 pages/flip-demo 隔离真机验证）。
// 页面层只做 touch 采集与 setData，入档决策/帧映射/占位帧数据全在这（可测、入首页时零改动搬走）。

export const FLIP_N = 36
export const FLIP_ZERO = 17 // 索引 17 ↔ 编号 00（左 -17 … 右 +18）

/** 松手入档决策：顺拖动方向进档，不看松手落点在哪区（除非大幅拖拽跨区直达）。
 *  j0 = 按下时手柄位移 px；x0 = 松手时手柄位移 px；maxJ = 半行程 px。返回档位 -1|0|1。 */
export function leverTarget(j0: number, x0: number, maxJ: number): -1 | 0 | 1 {
  const startD = Math.abs(j0) < maxJ / 2 ? 0 : Math.sign(j0)
  const dxT = x0 - j0
  if (Math.abs(dxT) < 6) return startD as -1 | 0 | 1 // 未成势：回起始档
  const zone = zoneOf(x0, maxJ)
  return (dxT > 0 ? Math.min(1, Math.max(startD + 1, zone)) : Math.max(-1, Math.min(startD - 1, zone))) as -1 | 0 | 1
}

/** 手柄位移比例 → 帧索引（绝对映射：居中 00，右满行 +18，左满行 -17）。 */
export function frameForRatio(ratio: number): number {
  const r = Math.max(-1, Math.min(1, ratio))
  return Math.max(0, Math.min(FLIP_N - 1, FLIP_ZERO + Math.round(r * (r > 0 ? 18 : 17))))
}

/** 当前位移所在档区（震动跨区提示用）：±半行程一半为界。 */
export function zoneOf(x: number, maxJ: number): -1 | 0 | 1 {
  return x < -maxJ / 2 ? -1 : x > maxJ / 2 ? 1 : 0
}

export interface FlipFrame {
  label: string
  bg: string // linear-gradient(155deg, hex, hex)
  x: number // 小球横向位置 %
  y: number // 小球纵向位置 %
}

// 36 帧渐变色对：设计稿为 oklch(0.945 .03 h)→oklch(0.885 .055 h+42)、h=140→300（鼠尾草绿→丁香紫），
// 部分安卓 XWeb 内核不认 oklch，构建期预计算成 hex 写死（scripts 见重构日志本批记账）。
const FLIP_BG: ReadonlyArray<readonly [string, string]> = [
  ['#e3f2df', '#b2e6dc'], ['#e1f3e1', '#b1e6df'], ['#e0f3e2', '#b0e5e2'], ['#def3e4', '#afe5e5'],
  ['#ddf3e5', '#afe5e8'], ['#dcf4e7', '#afe4ea'], ['#dbf4e9', '#afe4ed'], ['#daf4ea', '#b0e3ef'],
  ['#d9f4ec', '#b1e3f2'], ['#d8f4ee', '#b2e2f4'], ['#d8f4f0', '#b4e1f6'], ['#d7f4f1', '#b6e0f8'],
  ['#d7f4f3', '#b8dff9'], ['#d7f3f5', '#badffb'], ['#d7f3f6', '#bcdefc'], ['#d7f3f8', '#bfddfd'],
  ['#d7f3f9', '#c1dcfe'], ['#d8f2fa', '#c4dbfe'], ['#d8f2fc', '#c7d9ff'], ['#d9f1fd', '#cad8ff'],
  ['#daf1fe', '#cdd7fe'], ['#dbf1ff', '#d0d6fe'], ['#dcf0ff', '#d3d5fd'], ['#ddf0ff', '#d6d4fc'],
  ['#deefff', '#d9d3fb'], ['#e0eeff', '#dcd2fa'], ['#e1eeff', '#dfd1f9'], ['#e3edff', '#e2d1f7'],
  ['#e4edff', '#e4d0f5'], ['#e6ecff', '#e7cff3'], ['#e7ecff', '#e9cef1'], ['#e9ebff', '#eccdee'],
  ['#ebeaff', '#eecdec'], ['#eceaff', '#f0cce9'], ['#eee9ff', '#f2cce6'], ['#f0e9ff', '#f4cbe3'],
]

const fmt = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + String(Math.abs(n)).padStart(2, '0')

/** 36 张占位帧（编号 + 预计算渐变 + 弧线跳动的小球坐标）——真实连拍素材到位后整体替换帧源。 */
export function flipFrames(): FlipFrame[] {
  return Array.from({ length: FLIP_N }, (_, i) => {
    const p = i / (FLIP_N - 1)
    return {
      label: fmt(i - FLIP_ZERO),
      bg: `linear-gradient(155deg, ${FLIP_BG[i][0]}, ${FLIP_BG[i][1]})`,
      x: 8 + p * 84,
      y: 64 - Math.abs(Math.sin(p * Math.PI * 2)) * 32,
    }
  })
}
