// 品牌启动 splash（冷启动开屏·对齐 Claude Design 通过稿）：淡紫渐变底 + 居中品牌字标（轻浮动）+
// 「创造幸运~」+ 脚注。撤场＝**min-hold 保底停留 + 数据就绪 race + 硬上限兜底**（2026-07-18 丝滑战役
// 批2 拍板升级·前身 PR #34「纯计时器固定 1.5s、不挂钩数据」设计有意识推翻）：
//  · 至少停 MIN_HOLD_MS——低于此一闪而过、观感差；
//  · 过了 min-hold 后，父级 ready（首页数据就绪）即淡出——好网络下 splash 撤得比死等 1.5s 更快；
//  · 数据迟迟不来（弱网/云未部署）则 HARD_CAP_MS 无条件撤场——防「数据永不就绪」splash 永久盖死首页
//    （根因#8 build 绿·真机陷死）。
// 有界自撤守卫见 rw-mp-splash-auto-dismiss（三断言＋硬上限断言④·HARD_CAP_MS 改名须同步守卫）。
const MIN_HOLD_MS = 800 // 最短停留（低于此一闪而过·观感差）
const FADE_MS = 500 // 淡出时长（须与 wxss .ld-splash.leaving 动画时长一致）
const HARD_CAP_MS = 4000 // 硬上限：数据永不就绪也无条件撤场（HARD_CAP_MS 改名须同步守卫 rw-mp-splash-auto-dismiss 断言④）

// 撤场判定（纯函数·供测试直测 rewrite/mp/tests/brand-splash.test.ts）：过了最短停留且父级 ready 才放行离场。
export function shouldLeave(now: number, t0: number, ready: boolean): boolean {
  return ready && now - t0 >= MIN_HOLD_MS
}

// 每实例一份句柄（页面栈可同时多处挂载·不共用模块级单变量·同 login-sheet WeakMap 范式）：
// timers=定时器句柄（detached 统一清），starts=attached 记的 t0（min-hold 计时锚点）。
const timers = new WeakMap<object, ReturnType<typeof setTimeout>[]>()
const starts = new WeakMap<object, number>()

Component({
  properties: {
    // 父级（home）数据就绪信号：置 true 触发 observer → maybeLeave（过了 min-hold 即淡出）
    ready: { type: Boolean, value: false, observer() { this.maybeLeave() } },
  },
  data: { leaving: false },
  lifetimes: {
    attached() {
      starts.set(this, Date.now())
      const minHold = setTimeout(() => this.maybeLeave(), MIN_HOLD_MS)
      const hardCap = setTimeout(() => this.leave(), HARD_CAP_MS) // 无条件兜底撤场
      timers.set(this, [minHold, hardCap])
    },
    detached() {
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
      const fade = setTimeout(() => this.triggerEvent('done'), FADE_MS) // 淡出动画结束请父级撤下
      const arr = timers.get(this)
      if (arr) arr.push(fade)
      else timers.set(this, [fade])
    },
  },
})
