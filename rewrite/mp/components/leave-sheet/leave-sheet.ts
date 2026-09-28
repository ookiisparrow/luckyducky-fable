// 放弃编辑确认 <leave-sheet id="leave" dirty="{{dirty}}" title="放弃修改资料？" sub="这次的改动不会保存。" />
// （设计稿 LEAVE·「放弃编辑确认」半屏）。有改动（dirty）时挂隐形 <page-container> 拦侧滑 / 安卓返回键
// （同 utils/exitGuard 的机制·决策§30），拦下就弹本半屏；页面自绘返回键调 selectComponent('#leave').ask()。
// 「放弃」＝撤拦截再返回；「继续编辑」＝收起并重新武装。
// ⚠ 武装期间 page-container 冻结页面级滚动：宿主页内容可能超一屏的，须套 <scroll-view scroll-y>（同 me/home）。
import { goBackOrHome } from '../../lib/nav'
import { keyDown, keyUp } from '../../lib/keyFx'

const OUT_MS = 240 // 设计稿 closeSheet：面板 240ms 下滑后撤节点

Component({
  options: { styleIsolation: 'apply-shared' }, // 吃 app.wxss 的键帽 .k-* 与半屏 .sh-*
  properties: {
    dirty: { type: Boolean, value: false },
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
  },
  data: { open: false, out: false, armed: false },
  observers: {
    dirty(v: boolean) {
      if (!this.data.open) this.setData({ armed: v })
    },
  },
  methods: {
    onKeyDown: keyDown,
    onKeyUp: keyUp,
    noop() {},
    /** 页面自绘返回键：有改动先问，没改动直接返回。 */
    ask() {
      if (this.data.dirty) this.show()
      else goBackOrHome()
    },
    show() {
      this.setData({ armed: false, open: true, out: false })
    },
    /** <page-container bindbeforeleave>：侧滑/返回键被拦下。 */
    onBeforeLeave() {
      this.show()
    },
    close(then: () => void) {
      if (!this.data.open || this.data.out) return
      this.setData({ out: true })
      setTimeout(() => {
        this.setData({ open: false, out: false })
        then()
      }, OUT_MS)
    },
    onStay() {
      this.close(() => this.setData({ armed: this.data.dirty }))
    },
    onGo() {
      this.close(() => goBackOrHome())
    },
  },
})
