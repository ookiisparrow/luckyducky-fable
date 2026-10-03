// 货车烘焙层的「该显示什么」：把 Truck.view() 翻译成 px-truck 模板要的数据（纯函数，便于测）。
// 静止循环（mv=false）：精灵图与地面各自 CSS 动画循环，只给相位；移动（mv=true）：tx/gp 由 JS 每帧推。
import { GROUND_COLOR, groundCellMs, SPR_ORG, SPR_ORG_MIR, TRUCK_CELL, type Truck } from './pixelTruck'
import { TRUCK_SPRITES } from './truckBaked'

export interface Layer {
  k: string // 地面样式后缀：c|s[m]（移动时为 m）
  s: 'c' | 's' // 精灵图动画：c 巡航 / s 慢速
  img: string // 精灵图 data URI
  gc: string // 地面虚线色
  mv: boolean
  tx: number // 精灵图 translateX（px）
  gp: number // 移动时地面 background-position-x（px）
  gd: number // 静止时地面 animation-delay 的负值（ms）：接上 JS 的相位
}

type View = NonNullable<ReturnType<Truck['view']>>

/** 没有对应精灵图（箱数/镜像组合没烘）返回 null，调用方回落逐行渐变。 */
export function layerOf(v: View): Layer | null {
  const s = v.slow ? 's' : 'c'
  const img = TRUCK_SPRITES[`${s}${v.shown}${v.mir ? 'm' : ''}`]
  if (!img) return null
  const org = (v.mir ? SPR_ORG_MIR : SPR_ORG) * TRUCK_CELL
  if (v.move) return { k: 'm', s: 'c', img, gc: GROUND_COLOR, mv: true, tx: Math.round(v.x * TRUCK_CELL - org), gp: -Math.floor(v.ground) * TRUCK_CELL, gd: 0 }
  const k = ((Math.floor(v.ground) % 4) + 4) % 4 // 地面虚线周期 4 格；镜像时滚动方向相反，起点取补数
  return { k: `${s}${v.mir ? 'm' : ''}`, s, img, gc: GROUND_COLOR, mv: false, tx: v.home * TRUCK_CELL - org, gp: 0, gd: (v.mir ? (4 - k) % 4 : k) * groundCellMs(v.slow) }
}
