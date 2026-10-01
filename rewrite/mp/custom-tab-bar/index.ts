// 底部三格 TabBar（官方 custom-tab-bar：保留 switchTab 语义 + 自绘视觉·v6 Lite 5a：全平面，当前格图标紫）。
// active 由各 tab 页 onShow 经 getTabBar().setActive() 回写。v6 Lite 起不显示购物车件数（老板 2026-10-01 照设计稿）。
import { loginGate } from '../lib/loginGate'
import { privacyGate } from '../lib/privacyGate'
import { keyDown, keyUp } from '../lib/keyFx'
import { splashUp } from '../lib/splashGate'

// 每实例一份退订句柄与转场遮挡态（多 tabBar 页各自挂本组件·同 privacy-sheet/login-sheet 范式）
const unsubs = new WeakMap<object, () => void>()
const covered = new WeakMap<object, boolean>()

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的全局键帽 .k-* 与 .press-fade
  data: {
    active: 'home',
    // 登录半屏 / 隐私授权半屏 / 转场铺满时隐藏本 tabBar：自定义 tabBar 是框架独立原生层、页面内 z-index 盖不住它，
    // 全屏遮罩想盖住底部只能让 tabBar 自身让位（订阅 loginGate、旁观 privacyGate·关闭即恢复）。
    // 隐私半屏漏了这一步时按键被 tabBar 盖住、半屏关不掉（老板真机 2026-09-29「我」页换头像）。
    hidden: false,
    fadeIn: false, // 开屏淡出时同步淡入（只给开屏交接用·转场/半屏收起直接回来）
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
    syncHidden(fade = false) {
      this.setData({ hidden: !!covered.get(this) || splashUp() || loginGate.visible() || privacyGate.visible(), fadeIn: fade })
    },
    /** 转场 / 开屏铺到底部时让位（px-fx、brand-splash 调·同登录半屏的理由：页面内 z-index 盖不住本层），撤了恢复；fade＝回来时淡入。 */
    setCovered(v: boolean, fade = false) {
      covered.set(this, v)
      this.syncHidden(!v && fade)
    },
    setActive(id: string) {
      this.setData({ active: id })
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
