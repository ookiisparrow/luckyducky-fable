// 品牌启动 splash（冷启动开屏·v5 稿 data-splash）：#fafaf8 底 + 居中品牌字标 + 等宽英文口号。撤场＝**min-hold 保底停留 + 数据就绪 race + 硬上限兜底**（不用纯计时器固定时长）：
//  · 至少停 MIN_HOLD_MS——低于此一闪而过、观感差；
//  · 过了 min-hold 后，父级 ready（首页数据就绪）即淡出——好网络下 splash 撤得比死等 1.5s 更快；
//  · 数据迟迟不来（弱网/云未部署）则 HARD_CAP_MS 无条件撤场——防「数据永不就绪」splash 永久盖死首页
//    （根因#8 build 绿·真机陷死）。
import { BRAND_SLOGAN_EN } from '../../lib/brand'
import { setSplashUp } from '../../lib/splashGate'

const MIN_HOLD_MS = 800 // 最短停留（低于此一闪而过·观感差）
const FADE_MS = 500 // 淡出时长（须与 wxss .ld-splash.leaving 动画时长一致）
const HARD_CAP_MS = 4000 // 硬上限：数据永不就绪也无条件撤场

// 撤场判定（纯函数·供测试直测 rewrite/mp/tests/brand-splash.test.ts）：过了最短停留且父级 ready 才放行离场。
export function shouldLeave(now: number, t0: number, ready: boolean): boolean {
  return ready && now - t0 >= MIN_HOLD_MS
}

// 每实例一份句柄（页面栈可同时多处挂载·不共用模块级单变量·同 login-sheet WeakMap 范式）：
// timers=定时器句柄（detached 统一清），starts=attached 记的 t0（min-hold 计时锚点）。
const timers = new WeakMap<object, ReturnType<typeof setTimeout>[]>()
const starts = new WeakMap<object, number>()

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的 .mono 与 .v5-scope 色票
  properties: {
    // 父级（home）数据就绪信号：置 true 触发 observer → maybeLeave（过了 min-hold 即淡出）
    ready: { type: Boolean, value: false, observer() { this.maybeLeave() } },
  },
  // sloganEn 恒引 lib/brand 单源（病根#5）：本组件硬编码的话大小写易与单源不一致，
  // 开屏第一眼与支付成功页两种写法。™ 留在模板里。
  data: { leaving: false, sloganEn: BRAND_SLOGAN_EN },
  lifetimes: {
    // 开屏期间所有底部 TabBar 让位（自定义 TabBar 是框架独立层、z-index 盖不住）：经 lib/splashGate 广播，
    // 已挂的当场藏、后挂的挂上即藏；撤场同样广播，开屏期间切到别页的 TabBar 也回来。
    attached() {
      setSplashUp(true)
      starts.set(this, Date.now())
      const minHold = setTimeout(() => this.maybeLeave(), MIN_HOLD_MS)
      const hardCap = setTimeout(() => this.leave(), HARD_CAP_MS) // 无条件兜底撤场
      timers.set(this, [minHold, hardCap])
    },
    detached() {
      setSplashUp(false)
      for (const t of timers.get(this) || []) clearTimeout(t)
      timers.delete(this)
      starts.delete(this)
    },
  },
  methods: {
    maybeLeave() {
      const t0 = starts.get(this)
      if (t0 == null) return // attached 尚未记 t0（property observer 早于 attached 的保险）
      if (shouldLeave(Date.now(), t0, this.properties.ready)) this.leave()
    },
    leave() {
      if (this.data.leaving) return // 幂等：淡出已启动不重入（min-hold/ready/hard-cap 三处都可能触发）
      this.setData({ leaving: true })
      // TabBar 一开淡就回来并同步淡入（同 500ms）：等淡完才回，淡出期间首页已透出、底部空着（老板真机 2026-10-02）
      setSplashUp(false, true)
      const fade = setTimeout(() => this.triggerEvent('done'), FADE_MS) // 淡出动画结束请父级撤下
      const arr = timers.get(this)
      if (arr) arr.push(fade)
      else timers.set(this, [fade])
    },
  },
})
