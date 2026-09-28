// 底部三键 TabBar（官方 custom-tab-bar：保留 switchTab 语义 + 自绘视觉·v5 键帽：选中浅色键、未选平面键）。
// active 由各 tab 页 onShow 经 getTabBar().setActive() 回写；购物车角标随每次回写刷新。
import { count as cartCount } from '../lib/cart'
import { loginGate } from '../lib/loginGate'
import { keyDown, keyUp } from '../lib/keyFx'

// 每实例一份退订句柄（多 tabBar 页各自挂本组件·同 privacy-sheet/login-sheet 范式）
const unsubs = new WeakMap<object, () => void>()
const bumpTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()
const BUMP_MS = 320 // 设计稿 bumpCart：数字 1→1.5→1 弹一下

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的全局键帽 .k-*
  data: {
    active: 'home',
    cartCount: 0,
    bump: false, // 购物车数字弹跳中（bump() 置真·320ms 复位）
    // 登录半屏打开时隐藏本 tabBar：自定义 tabBar 是框架独立原生层、页面内 z-index 盖不住它，
    // 全屏遮罩想盖住底部只能让 tabBar 自身让位（订阅 loginGate·关闭即恢复）。
    hidden: false,
    tabs: [
      { id: 'home', label: '首页', path: '/pages/home/home' },
      { id: 'cart', label: '购物车', path: '/pages/cart/cart' },
      { id: 'me', label: '我', path: '/pages/me/me' },
    ],
  },
  lifetimes: {
    attached() {
      this.setData({ hidden: loginGate.visible() }) // 挂载即读当前态（弹窗先于本组件 attached 也不漏·同 login-sheet）
      unsubs.set(
        this,
        loginGate.subscribe((v) => this.setData({ hidden: v }))
      )
    },
    detached() {
      unsubs.get(this)?.()
      unsubs.delete(this)
    },
  },
  methods: {
    onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
    onKeyUp: keyUp,
    /** 转场铺到底部时让位（px-fx 调·同登录半屏的理由：页面内 z-index 盖不住本层），跳走后恢复。 */
    setCovered(v: boolean) {
      this.setData({ hidden: v || loginGate.visible() })
    },
    setActive(id: string) {
      this.setData({ active: id, cartCount: cartCount() })
    },
    /** 加购后页面调 getTabBar()?.bump?.()：刷新角标并让数字弹一下。 */
    bump() {
      clearTimeout(bumpTimers.get(this))
      this.setData({ cartCount: cartCount(), bump: true })
      bumpTimers.set(this, setTimeout(() => this.setData({ bump: false }), BUMP_MS))
    },
    onTap(e: WechatMiniprogram.TouchEvent) {
      const { id, path } = e.currentTarget.dataset as { id: string; path: string }
      if (id === this.data.active) {
        // 点已选中的 tab：交给当前页（首页回顶）；页面没实现就什么都不做
        const pages = getCurrentPages()
        const cur = pages[pages.length - 1] as { onTabReselect?: () => void } | undefined
        cur?.onTabReselect?.()
        return
      }
      wx.switchTab({ url: path })
    },
  },
})
