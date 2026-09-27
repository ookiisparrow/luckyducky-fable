// v5 二级页顶栏 <v5-nav title="我的订单" />：状态栏 + 44 高一条，左侧浅色返回小键（32×30，44 热区），
// 旁边可选一行 13px 页名；右侧 104 留给微信胶囊。页面需 navigationStyle: custom。
// 自己占位（状态栏+44），页面内容照常从它下面流下去；栏本身 fixed 不随页面滚。
// 返回走 lib/nav goBackOrHome：深链进来没有上一页时回首页，不留死按钮。
import { goBackOrHome } from '../../lib/nav'

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的全局键帽 .k-*
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: true },
  },
  data: { sb: 20 },
  lifetimes: {
    attached() {
      this.setData({ sb: wx.getWindowInfo().statusBarHeight || 20 })
    },
  },
  methods: {
    onBack() {
      goBackOrHome()
    },
  },
})
