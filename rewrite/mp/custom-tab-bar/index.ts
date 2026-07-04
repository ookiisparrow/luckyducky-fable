// 自绘浮动 TabBar（官方 custom-tab-bar 机制：保留 switchTab 语义 + 自绘视觉——旧线「悬浮药丸」设计的原生承接，
// spike T4 双引擎真机 ✅）。active 由各 tab 页 onShow 经 getTabBar().setActive() 回写（官方推荐模式），
// 购物车角标顺路随每次回写刷新（加购/改量后切回 tab 页即见最新件数）。
import { count as cartCount } from '../lib/cart'

Component({
  data: {
    active: 'home',
    cartCount: 0,
    tabs: [
      { id: 'home', label: '首页', icon: 'house', path: '/pages/home/home' },
      { id: 'cart', label: '购物车', icon: 'shopping-cart', path: '/pages/cart/cart' },
      { id: 'me', label: '我', icon: 'user', path: '/pages/me/me' },
    ],
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
