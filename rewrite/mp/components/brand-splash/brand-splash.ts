// 品牌启动 splash（冷启动开屏·对齐 Claude Design 通过稿）：淡紫渐变底 + 居中品牌字标（轻浮动）+
// 「创造幸运~」+ 脚注，纯计时器驱动 —— 停留后加 leaving 淡出、动画结束 triggerEvent('done') 请父级撤下。
// 只做开屏观感，不挂钩数据加载（首页 loading/骨架屏另有其人）。有界自撤守卫见 rw-mp-splash-auto-dismiss。
const HOLD_MS = 1500 // 停留时长
const FADE_MS = 500 // 淡出时长（须与 wxss .ld-splash.leaving 动画时长一致）

// 每实例一份计时器句柄（页面栈可同时多处挂载·不共用模块级单变量·同 login-sheet WeakMap 范式）
const timers = new WeakMap<object, ReturnType<typeof setTimeout>[]>()

Component({
  data: { leaving: false },
  lifetimes: {
    attached() {
      const hold = setTimeout(() => this.setData({ leaving: true }), HOLD_MS)
      const fade = setTimeout(() => this.triggerEvent('done'), HOLD_MS + FADE_MS)
      timers.set(this, [hold, fade])
    },
    detached() {
      for (const t of timers.get(this) || []) clearTimeout(t)
      timers.delete(this)
    },
  },
  methods: {},
})
