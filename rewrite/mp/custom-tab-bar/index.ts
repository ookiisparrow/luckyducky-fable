// 底部三键 TabBar（官方 custom-tab-bar：保留 switchTab 语义 + 自绘视觉·v5 键帽：选中浅色键、未选平面键）。
// active 由各 tab 页 onShow 经 getTabBar().setActive() 回写；购物车角标随每次回写刷新。
import { count as cartCount } from '../lib/cart'
import { loginGate } from '../lib/loginGate'
import { privacyGate } from '../lib/privacyGate'
import { keyDown, keyUp } from '../lib/keyFx'

// 每实例一份退订句柄与转场遮挡态（多 tabBar 页各自挂本组件·同 privacy-sheet/login-sheet 范式）
const unsubs = new WeakMap<object, () => void>()
const covered = new WeakMap<object, boolean>()
const bumpTimers = new WeakMap<object, ReturnType<typeof setTimeout>>()
const BUMP_MS = 320 // 设计稿 bumpCart：数字 1→1.5→1 弹一下

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的全局键帽 .k-*
  data: {
    active: 'home',
    cartCount: 0,
    bump: false, // 购物车数字弹跳中（bump() 置真·320ms 复位）
    // 登录半屏 / 隐私授权半屏 / 转场铺满时隐藏本 tabBar：自定义 tabBar 是框架独立原生层、页面内 z-index 盖不住它，
    // 全屏遮罩想盖住底部只能让 tabBar 自身让位（订阅 loginGate、旁观 privacyGate·关闭即恢复）。
    // 隐私半屏漏了这一步时按键被 tabBar 盖住、半屏关不掉（老板真机 2026-09-29「我」页换头像）。
    hidden: false,
    tabs: [
      // 键里只放像素图标（id 即 px-i 字形名·老板 2026-09-30 照设计稿去文字）
      { id: 'home', path: '/pages/home/home' },
      { id: 'cart', path: '/pages/cart/cart' },
      { id: 'me', path: '/pages/me/me' },
    ],
  },
  lifetimes: {
    attached() {
      this.syncHidden() // 挂载即读当前态（弹窗先于本组件 attached 也不漏·同 login-sheet）
      const offLogin = loginGate.subscribe(() => this.syncHidden())
      // observe 而非 subscribe：tabBar 常驻，若算作「挂着隐私弹窗的页面」会让「页面走了没选按不同意收场」永不触发
      const offPrivacy = privacyGate.observe(() => this.syncHidden())
      unsubs.set(this, () => {
        offLogin()
        offPrivacy()
      })
    },
    detached() {
      unsubs.get(this)?.()
      unsubs.delete(this)
      covered.delete(this)
    },
  },
  methods: {
    onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
    onKeyUp: keyUp,
    syncHidden() {
      this.setData({ hidden: !!covered.get(this) || loginGate.visible() || privacyGate.visible() })
    },
    /** 转场铺到底部时让位（px-fx 调·同登录半屏的理由：页面内 z-index 盖不住本层），跳走后恢复。 */
    setCovered(v: boolean) {
      covered.set(this, v)
      this.syncHidden()
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
