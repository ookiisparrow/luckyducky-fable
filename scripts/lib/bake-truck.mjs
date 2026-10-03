// 货车巡航预渲染核心（纯函数·脚本与 vitest 共用）：lib/pixelTruck 的 sprite（纯时间的巡航画面，无地面）按 SPR_STEP ms 取一个循环的帧，
// 编成横条 PNG；小程序侧（components/px-truck）用 CSS steps 播放，巡航时不再每帧 JS 重画 + setData。地面由 CSS 另滚。
import { encodeStrip } from './bake-px.mjs'

export const ROWS = 17
const CARGO = [0, 1, 2, 3]

/** 变体键：`<c|s><箱数>[m]`（c 巡航 / s 慢速；m 倒车镜像） */
export const keyOf = (slow, shown, mir) => `${slow ? 's' : 'c'}${shown}${mir ? 'm' : ''}`

/** 一个变体的帧序列（长 SPR_COLS×ROWS 的颜色数组，'' ＝透明）。落格规则同 lib/pixelView.plotInto：四舍五入、越界丢、后写覆盖。 */
export function frameAt(mod, slow, shown, mir, t) {
  const truck = mod.createTruckForBake({ pose: slow ? 'slow' : mir ? 'reverse' : 'drive', cargo: shown })
  const cells = new Array(mod.SPR_COLS * ROWS).fill('')
  truck.sprite(t, (fx, fy, col) => {
    const x = Math.round(fx)
    const y = Math.round(fy)
    if (x < 0 || y < 0 || x >= mod.SPR_COLS || y >= ROWS) return
    cells[y * mod.SPR_COLS + x] = col
  })
  return cells
}

export function buildTruckOutputs(mod) {
  const CELL = mod.TRUCK_CELL // 货车场景格（px-truck 默认 scale）；别的 scale 运行时回落 JS 引擎
  const sprites = {}
  const frames = {}
  for (const slow of [false, true]) {
    const period = slow ? mod.IDLE_PERIOD.slow : mod.IDLE_PERIOD.cruise
    const n = period / mod.SPR_STEP
    frames[slow ? 's' : 'c'] = n
    for (const shown of CARGO)
      for (const mir of [false, true]) {
        const fr = Array.from({ length: n }, (_, i) => frameAt(mod, slow, shown, mir, i * mod.SPR_STEP))
        sprites[keyOf(slow, shown, mir)] = encodeStrip(fr, CELL, mod.SPR_COLS, ROWS)
      }
  }
  const W = mod.SPR_COLS * CELL
  const ts = `// 本文件由 scripts/gen-truck-bake.mjs 生成，勿手改（改 lib/pixelTruck 的巡航画面/节拍后重跑）。\n// 货车巡航预渲染精灵图：键＝\`<c巡航|s慢速><箱数>[m倒车镜像]\`，值＝横条 PNG data URI；TRUCK_FRAMES＝各类帧数。\nexport const TRUCK_FRAMES: Record<string, number> = ${JSON.stringify(frames)}\nexport const TRUCK_SPRITES: Record<string, string> = ${JSON.stringify(sprites, null, 2)}\n`
  const kf = (k) => `@keyframes tkb-${k}{from{background-position:0 0}to{background-position:-${frames[k] * W}px 0}}`
  const wxss = `/* 本文件由 scripts/gen-truck-bake.mjs 生成，勿手改。货车巡航：精灵图按 steps 切帧；地面是另一层 4px 虚线（色取 currentColor，由组件内联传入 GROUND_COLOR），按格步进滚动。 */\n${kf('c')}\n${kf('s')}\n.tkb{position:absolute;left:0;top:0;will-change:transform;height:${ROWS * CELL}px;width:${W}px;background-repeat:no-repeat;background-size:auto ${ROWS * CELL}px;animation-iteration-count:infinite;animation-timing-function:steps(${frames.c})}\n.tkb-c{animation-name:tkb-c;animation-duration:${mod.IDLE_PERIOD.cruise}ms}\n.tkb-s{animation-name:tkb-s;animation-duration:${mod.IDLE_PERIOD.slow}ms;animation-timing-function:steps(${frames.s})}\n@keyframes tkg-l{from{background-position:0 0}to{background-position:-${4 * CELL}px 0}}\n@keyframes tkg-r{from{background-position:0 0}to{background-position:${4 * CELL}px 0}}\n.tkg{position:absolute;left:0;right:0;top:${(ROWS - 1) * CELL}px;height:${CELL}px;background-image:linear-gradient(to right,currentColor ${2 * CELL}px,transparent ${2 * CELL}px);background-size:${4 * CELL}px ${CELL}px;background-repeat:repeat-x;animation-timing-function:steps(4);animation-iteration-count:infinite}\n.tkg-m{animation:none}\n.tkg-c{animation-name:tkg-l;animation-duration:${4 * mod.groundCellMs(false)}ms}\n.tkg-s{animation-name:tkg-l;animation-duration:${4 * mod.groundCellMs(true)}ms}\n.tkg-cm{animation-name:tkg-r;animation-duration:${4 * mod.groundCellMs(false)}ms}\n.tkg-sm{animation-name:tkg-r;animation-duration:${4 * mod.groundCellMs(true)}ms}\n`
  return { ts, wxss, frames }
}
