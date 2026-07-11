// 定格动画（三档拨杆·状态切换器）隔离验证页——语义见 lib/flipLever（纯逻辑单源，入首页时整体搬走）。
// 交互：touch 相对拖动（等效 pointer capture：touch 事件天然绑定起始节点）→ setData 跟手（同 player
// 进度条先例）；松手 leverTarget 决策 → easeIn 立方 110–220ms 冲档硬停（设计稿「咕嗒入档」）。
// 震动（2026-07-11 用户需求）：入档 medium、拖过档区边界/到行程尽头 light，全程 ≥80ms 节流——
// 禁逐帧震（安卓马达糊成嗡）；工具端不震、真机才有（根因#8）。
import { leverTarget, frameForRatio, zoneOf, flipFrames, FLIP_ZERO } from '../../lib/flipLever'

const SNAP_TICK_MS = 16 // 入档动画步进（≈60fps 定时器·页面 JS 无 rAF）
const VIBE_GAP_MS = 80

Page({
  data: {
    frames: flipFrames(),
    frame: FLIP_ZERO,
    jog: 0, // 手柄位移 px（transform 用）
    leverDeg: 0, // 杆身微旋转（设计：位移/12 度）
    dragging: false,
  },

  // 非渲染态（不进 data：不触发 setData）
  jogPx: 0,
  maxJ: 0, // 半行程 px（onReady 量得）
  down: false,
  startX: 0,
  startJog: 0,
  lastZone: 0 as -1 | 0 | 1,
  atEnd: false,
  lastVibe: 0,
  snapTimer: 0 as ReturnType<typeof setInterval> | 0,

  onReady() {
    // 量滑轨与杆宽出半行程：maxJ = 轨半宽 - 杆半宽 - 2（承设计稿 railMax()）
    wx.createSelectorQuery()
      .in(this)
      .select('.fd-rail')
      .boundingClientRect()
      .select('.fd-lever')
      .boundingClientRect()
      .exec((res: { width: number }[]) => {
        const rail = res[0]
        const lever = res[1]
        if (rail && lever) this.maxJ = rail.width / 2 - lever.width / 2 - 2
      })
  },

  onUnload() {
    this.stopSnap()
  },

  /* ---------- touch ---------- */
  onRailStart(e: WechatMiniprogram.TouchEvent) {
    if (!this.maxJ) return // 量宽未回来（极早触摸）：本次不响应，下次即好
    this.stopSnap()
    this.down = true
    this.startX = e.touches[0].clientX
    this.startJog = this.jogPx
    this.lastZone = zoneOf(this.jogPx, this.maxJ)
    this.atEnd = false
    this.setData({ dragging: true })
  },

  onRailMove(e: WechatMiniprogram.TouchEvent) {
    if (!this.down) return
    const raw = this.startJog + (e.touches[0].clientX - this.startX)
    const x = Math.max(-this.maxJ, Math.min(this.maxJ, raw))
    // 行程尽头轻震（每次抵边只震一下，离开边界后再触发才再震）
    const hitEnd = Math.abs(raw) > this.maxJ
    if (hitEnd && !this.atEnd) this.vibe('light')
    this.atEnd = hitEnd
    // 跨档区轻震（预告松手会进这档）
    const zone = zoneOf(x, this.maxJ)
    if (zone !== this.lastZone) {
      this.lastZone = zone
      this.vibe('light')
    }
    this.applyJog(x)
  },

  onRailEnd() {
    if (!this.down) return
    this.down = false
    this.setData({ dragging: false })
    const target = leverTarget(this.startJog, this.jogPx, this.maxJ)
    this.snapTo(target * this.maxJ)
  },

  /* ---------- 入档动画：easeIn 立方加速冲进档位，抵达硬停（无回弹）+ medium 震 ---------- */
  snapTo(target: number) {
    const x0 = this.jogPx
    const dist = target - x0
    if (Math.abs(dist) < 1) {
      this.applyJog(target)
      return
    }
    const D = 110 + Math.min(110, Math.abs(dist) * 0.55)
    const t0 = Date.now()
    this.snapTimer = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / D)
      if (k >= 1) {
        this.stopSnap()
        this.applyJog(target)
        this.vibe('medium') // 咕嗒
        return
      }
      this.applyJog(x0 + dist * k * k * k)
    }, SNAP_TICK_MS)
  },

  stopSnap() {
    if (this.snapTimer) {
      clearInterval(this.snapTimer)
      this.snapTimer = 0
    }
  },

  applyJog(x: number) {
    this.jogPx = x
    this.setData({
      jog: Math.round(x * 10) / 10,
      leverDeg: Math.round((x / 12) * 100) / 100,
      frame: frameForRatio(this.maxJ > 0 ? x / this.maxJ : 0),
    })
  },

  /* ---------- 震动：≥80ms 节流单出口 ---------- */
  vibe(type: 'light' | 'medium') {
    const now = Date.now()
    if (now - this.lastVibe < VIBE_GAP_MS) return
    this.lastVibe = now
    wx.vibrateShort({ type })
  },
})
