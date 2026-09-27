// 按键手感单源（v5 设计稿「下沉 · 回弹 · 咔嗒」·老板 2026-09-28 拍板照设计稿）：
//   按下 → 轻震 + 「咔嗒」；松开 → 更轻更高的「嗒」。视觉下沉/回弹在 app.wxss 的 .k 与 hover-class。
// 键上写 data-k="ink|light|flat|dk|inv" + bind:touchstart="onKeyDown" bind:touchend="onKeyUp"，
// 页面/组件挂 onKeyDown: keyDown, onKeyUp: keyUp（按住类键的开始处理器里手动调 keyPress）。
// 行/卡片（k-row/k-card）不挂：列表里手指一碰就开始滚，touchstart 就震会让滑动全程乱震，它们只留视觉下沉。
// 音：设计稿 Web Audio 合成原样移植（衰减噪声 → 带通「咔嗒」；墨黑/暗色键按下再叠 170→80Hz 低频「咚」）；
//   行/卡片只震不响。音频接口不支持或出错一律静默（手感是加分项，不能拖垮点按）。
// ponytail: 真机静音键下是否仍出声、是否打断后台音乐未实测——setInnerAudioOption 已设混音+遵从静音键，真机走查确认。
import { keyHaptic } from './haptics'

type Kind = 'ink' | 'light' | 'flat' | 'dk' | 'inv' | 'row' | 'card'
const HEAVY: Kind[] = ['ink', 'dk', 'inv']
const SILENT: Kind[] = ['row', 'card']

type AudioCtx = {
  currentTime: number
  sampleRate: number
  destination: unknown
  createBuffer(ch: number, len: number, rate: number): { getChannelData(i: number): Float32Array }
  createBufferSource(): { buffer: unknown; connect(n: unknown): void; start(t: number): void; stop(t: number): void }
  createBiquadFilter(): { type: string; frequency: { value: number }; Q: { value: number }; connect(n: unknown): void }
  createGain(): { gain: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(n: unknown): void }
  createOscillator(): {
    type: string
    frequency: { setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }
    connect(n: unknown): void
    start(t: number): void
    stop(t: number): void
  }
}

let ctx: AudioCtx | null = null
let noise: unknown = null
let audioBroken = false

function audio(): AudioCtx | null {
  if (audioBroken) return null
  if (ctx) return ctx
  try {
    const w = wx as unknown as { createWebAudioContext?: () => AudioCtx; setInnerAudioOption?: (o: Record<string, unknown>) => void }
    if (typeof w.createWebAudioContext !== 'function') throw new Error('no web audio')
    if (typeof w.setInnerAudioOption === 'function') w.setInnerAudioOption({ mixWithOther: true, obeyMuteSwitch: true }) // 不打断用户在听的音乐·静音键下不响
    ctx = w.createWebAudioContext()
    const len = Math.floor(ctx.sampleRate * 0.04)
    const b = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2)
    noise = b
    return ctx
  } catch {
    audioBroken = true // 刻意静默：没有音频能力就只震不响
    return null
  }
}

/** 合成一声「咔嗒」（设计稿 sound(kind, phase) 原参数）。 */
export function click(kind: Kind, down: boolean): void {
  if (SILENT.includes(kind)) return
  const c = audio()
  if (!c) return
  try {
    const heavy = HEAVY.includes(kind)
    const t = c.currentTime
    const src = c.createBufferSource()
    src.buffer = noise
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = down ? (heavy ? 1900 : 2800) : heavy ? 3200 : 4200
    bp.Q.value = 1.4
    const g = c.createGain()
    g.gain.setValueAtTime(down ? 0.3 : 0.13, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + (down ? 0.03 : 0.018))
    src.connect(bp)
    bp.connect(g)
    g.connect(c.destination)
    src.start(t)
    src.stop(t + 0.045)
    if (down && heavy) {
      const o = c.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(170, t)
      o.frequency.exponentialRampToValueAtTime(80, t + 0.05)
      const g2 = c.createGain()
      g2.gain.setValueAtTime(0.15, t)
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
      o.connect(g2)
      g2.connect(c.destination)
      o.start(t)
      o.stop(t + 0.07)
    }
  } catch {
    audioBroken = true // 刻意静默：个别基础库缺 AudioParam 方法时停用音效，不影响点按
  }
}

// data-k 由 hover-class 推出（k-ink-down → ink）；禁用态 hover-class 是 none/空 → 这里得 null → 不震不响。
const KINDS: Kind[] = ['ink', 'light', 'flat', 'dk', 'inv', 'row', 'card']
const kindOf = (e: WechatMiniprogram.TouchEvent): Kind | null => {
  const k = String((e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.k) || '')
  return KINDS.includes(k as Kind) ? (k as Kind) : null
}

/** 按下：轻震（墨黑/反相主键 medium，其余 light）+ 咔嗒。按住类键的开始处理器直接调这个。 */
export function keyPress(kind: Kind | null): void {
  if (!kind) return
  keyHaptic(kind === 'ink' || kind === 'inv' ? 'medium' : 'light') // 同一次点按里处理器再调 tapHaptic 不叠第二下震
  click(kind, true)
}

/** 键上 bind:touchstart 的处理器。 */
export function keyDown(e: WechatMiniprogram.TouchEvent): void {
  keyPress(kindOf(e))
}

/** 键上 bind:touchend 的处理器。 */
export function keyUp(e: WechatMiniprogram.TouchEvent): void {
  const k = kindOf(e)
  if (k) click(k, false)
}
