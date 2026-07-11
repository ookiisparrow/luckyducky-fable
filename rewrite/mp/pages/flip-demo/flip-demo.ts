// 定格动画两方案隔离验证页——语义见 lib/flipLever（纯逻辑单源，入首页时整体搬走）。
// 方案一「拟物凹槽」：相对拨动翻帧，松手阻尼钟摆回中（pendulumAt 逐帧驱动·摆过中点轻震）。
// 方案二「三档拨杆」：三稳态，松手顺拖动方向咔哒入档（leverTarget 决策 + easeIn 立方冲档硬停）。
// 交互：touch 相对拖动 + setData 跟手（同 player 进度条先例）；动画均定时器驱动（页面 JS 无 rAF）。
// 震动（2026-07-11 用户需求两则）：① 事件震——入档 medium、跨档区/到行程尽头/摆过中点 light，≥80ms 节流；
// ② 方案一拖动持续阻尼震感——翻过一帧即「嗒」（shouldTick·40ms 最小间隔钳制，快扫自动跳齿防安卓马达糊嗡）。
// 工具端不震、真机才有（根因#8）。
import { leverTarget, frameForRatio, zoneOf, flipFrames, pendulumAt, shouldTick, FLIP_ZERO } from '../../lib/flipLever'

const TICK_MS = 16 // 动画步进（≈60fps 定时器）
const VIBE_GAP_MS = 80 // 事件震节流
const DRAG_TICK_GAP_MS = 40 // 拖动阻尼「嗒」最小间隔

interface RailState {
  jog: number // 手柄位移 px
  maxJ: number // 半行程 px（onReady 量得）
  down: boolean
  startX: number
  startJog: number
  lastZone: -1 | 0 | 1
  atEnd: boolean
  timer: ReturnType<typeof setInterval> | 0
  lastTickFrame: number // 上次「嗒」时的帧（拖动阻尼震感·只在真嗒时更新＝快扫跳齿后可补嗒）
}
const railState = (): RailState => ({ jog: 0, maxJ: 0, down: false, startX: 0, startJog: 0, lastZone: 0, atEnd: false, timer: 0, lastTickFrame: FLIP_ZERO })

Page({
  data: {
    frames: flipFrames(),
    frameA: FLIP_ZERO,
    jogA: 0,
    dragA: false,
    frameB: FLIP_ZERO,
    jogB: 0,
    leverDeg: 0, // 杆身微旋转（设计：位移/12 度）
    dragB: false,
  },

  // 非渲染态（不进 data：不触发 setData）
  A: railState(), // 方案一 · 拟物凹槽
  B: railState(), // 方案二 · 三档拨杆
  lastVibe: 0, // 事件震时间戳
  lastTick: 0, // 拖动阻尼「嗒」时间戳

  onLoad() {
    this.A = railState()
    this.B = railState()
  },

  onReady() {
    // 量滑轨与手柄宽出各自半行程：maxJ = 轨半宽 - 柄半宽 - 2（承设计稿 railMax()）
    wx.createSelectorQuery()
      .in(this)
      .select('.fd-rail-jog')
      .boundingClientRect()
      .select('.fd-fader')
      .boundingClientRect()
      .select('.fd-rail-lever')
      .boundingClientRect()
      .select('.fd-lever')
      .boundingClientRect()
      .exec((res: { width: number }[]) => {
        if (res[0] && res[1]) this.A.maxJ = res[0].width / 2 - res[1].width / 2 - 2
        if (res[2] && res[3]) this.B.maxJ = res[2].width / 2 - res[3].width / 2 - 2
      })
  },

  onUnload() {
    this.stopTimer(this.A)
    this.stopTimer(this.B)
  },

  /* ================= 共用 ================= */
  stopTimer(s: RailState) {
    if (s.timer) {
      clearInterval(s.timer)
      s.timer = 0
    }
  },

  // 拖动公共段：按下记锚点 / 移动出钳位位移（顺带行程尽头轻震）
  railDown(s: RailState, e: WechatMiniprogram.TouchEvent) {
    this.stopTimer(s)
    s.down = true
    s.startX = e.touches[0].clientX
    s.startJog = s.jog
    s.lastZone = zoneOf(s.jog, s.maxJ)
    s.atEnd = false
  },
  railDrag(s: RailState, e: WechatMiniprogram.TouchEvent): number {
    const raw = s.startJog + (e.touches[0].clientX - s.startX)
    const x = Math.max(-s.maxJ, Math.min(s.maxJ, raw))
    const hitEnd = Math.abs(raw) > s.maxJ // 每次抵边只震一下，离开边界后再触发才再震
    if (hitEnd && !s.atEnd) this.vibe('light')
    s.atEnd = hitEnd
    return x
  },

  /* ================= 方案一 · 拟物凹槽 ================= */
  onJogStart(e: WechatMiniprogram.TouchEvent) {
    if (!this.A.maxJ) return // 量宽未回来（极早触摸）：本次不响应，下次即好
    this.railDown(this.A, e)
    this.A.lastTickFrame = this.data.frameA
    this.setData({ dragA: true })
  },

  onJogMove(e: WechatMiniprogram.TouchEvent) {
    if (!this.A.down) return
    const f = this.applyA(this.railDrag(this.A, e))
    // 持续阻尼震感：翻帧即嗒（拖得快嗒得密·40ms 钳制快扫跳齿）；与事件震共用时间地板防叠震
    const now = Date.now()
    if (shouldTick(this.A.lastTickFrame, f, now - Math.max(this.lastTick, this.lastVibe), DRAG_TICK_GAP_MS)) {
      this.lastTick = now
      this.A.lastTickFrame = f
      wx.vibrateShort({ type: 'light' })
    }
  },

  onJogEnd() {
    if (!this.A.down) return
    this.A.down = false
    this.setData({ dragA: false })
    this.settleA()
  },

  // 松手：阻尼钟摆回中——手柄带着画面左右摆动、振幅衰减，最终停回 00 帧；摆过中点轻震
  settleA() {
    const x0 = this.A.jog
    if (!x0) {
      this.applyA(0)
      return
    }
    const t0 = Date.now()
    let prevX = x0
    this.A.timer = setInterval(() => {
      const { x, done } = pendulumAt(x0, Date.now() - t0)
      if ((prevX > 0 && x < 0) || (prevX < 0 && x > 0)) this.vibe('light') // 过中点
      prevX = x
      this.applyA(x)
      if (done) this.stopTimer(this.A)
    }, TICK_MS)
  },

  applyA(x: number): number {
    this.A.jog = x
    const frame = frameForRatio(this.A.maxJ > 0 ? x / this.A.maxJ : 0)
    this.setData({ jogA: Math.round(x * 10) / 10, frameA: frame })
    return frame
  },

  /* ================= 方案二 · 三档拨杆 ================= */
  onLeverStart(e: WechatMiniprogram.TouchEvent) {
    if (!this.B.maxJ) return
    this.railDown(this.B, e)
    this.setData({ dragB: true })
  },

  onLeverMove(e: WechatMiniprogram.TouchEvent) {
    if (!this.B.down) return
    const x = this.railDrag(this.B, e)
    // 跨档区轻震（预告松手会进这档）
    const zone = zoneOf(x, this.B.maxJ)
    if (zone !== this.B.lastZone) {
      this.B.lastZone = zone
      this.vibe('light')
    }
    this.applyB(x)
  },

  onLeverEnd() {
    if (!this.B.down) return
    this.B.down = false
    this.setData({ dragB: false })
    const target = leverTarget(this.B.startJog, this.B.jog, this.B.maxJ)
    this.snapB(target * this.B.maxJ)
  },

  // 入档动画：easeIn 立方加速冲进档位，抵达硬停（无回弹）+ medium 震
  snapB(target: number) {
    const x0 = this.B.jog
    const dist = target - x0
    if (Math.abs(dist) < 1) {
      this.applyB(target)
      return
    }
    const D = 110 + Math.min(110, Math.abs(dist) * 0.55)
    const t0 = Date.now()
    this.B.timer = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / D)
      if (k >= 1) {
        this.stopTimer(this.B)
        this.applyB(target)
        this.vibe('medium') // 咕嗒
        return
      }
      this.applyB(x0 + dist * k * k * k)
    }, TICK_MS)
  },

  applyB(x: number) {
    this.B.jog = x
    this.setData({
      jogB: Math.round(x * 10) / 10,
      leverDeg: Math.round((x / 12) * 100) / 100,
      frameB: frameForRatio(this.B.maxJ > 0 ? x / this.B.maxJ : 0),
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
