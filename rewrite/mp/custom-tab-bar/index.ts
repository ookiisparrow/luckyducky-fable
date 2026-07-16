// 自绘贴边通栏 TabBar（官方 custom-tab-bar 机制：保留 switchTab 语义 + 自绘视觉——2026-07-13 由「悬浮药丸」
// 改通栏不透明，视觉见 index.wxss 头注；spike T4 双引擎真机 ✅）。active 由各 tab 页 onShow 经 getTabBar().setActive() 回写（官方推荐模式），
// 购物车角标顺路随每次回写刷新（加购/改量后切回 tab 页即见最新件数）。
import { count as cartCount } from '../lib/cart'
import { loginGate } from '../lib/loginGate'

// 每实例一份退订句柄（多 tabBar 页各自挂本组件·同 privacy-sheet/login-sheet 范式）
const unsubs = new WeakMap<object, () => void>()

Component({
  data: {
    active: 'home',
    cartCount: 0,
    // 登录半屏打开时隐藏本 tabBar：自定义 tabBar 是框架独立原生层、页面内 z-index 盖不住它，
    // 全屏遮罩想盖住底部只能让 tabBar 自身让位（订阅 loginGate·关闭即恢复）。
    hidden: false,
    tabs: [
      { id: 'home', label: '首页', icon: 'house', path: '/pages/home/home' },
      { id: 'cart', label: '购物车', icon: 'shopping-cart', path: '/pages/cart/cart' },
      { id: 'me', label: '我', icon: 'user', path: '/pages/me/me' },
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
    setActive(id: string) {
      this.setData({ active: id, cartCount: cartCount() })
    },
    onTap(e: WechatMiniprogram.TouchEvent) {
      const { id, path } = e.currentTarget.dataset as { id: string; path: string }
      if (id === this.data.active) return
      wx.switchTab({ url: path })
    },
  },
})
