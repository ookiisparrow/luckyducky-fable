// 物流页壳（设计稿「物流轨迹」·拍板 8）：小货车按订单态摆姿势 + 承运方 + 大号运单号 + 复制；
// 实时轨迹不自造——「查看物流详情」进快递100 插件（同 AppID 已授权·app.json 声明即用），插件打不开复制运单号兜底。
// ponytail: 设计稿的下拉刷新与站内时间轴没做（没有轨迹数据源）；接了轨迹接口再在「查看物流详情」上方铺时间轴。
import { tapHaptic } from '../../lib/haptics'
import { getOrderById } from '../../api/orders'
import { mapOrder } from '../../lib/mapOrders'
import { expressCode } from '../../lib/express'
import { keyDown, keyUp } from '../../lib/keyFx'
import { goBackOrHome } from '../../lib/nav'
import { groundGap } from '../../lib/ground'

const POSE: Record<string, string> = { paid: 'drive', shipped: 'drive', done: 'unload' }

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    loading: true,
    loadFailed: false, // 失败≠没有运单（根因#14）
    notFound: false, // 缺单号 / 查无此单：「找不到这个订单」+ 返回（不亮重试、不误报没发货）
    company: '',
    trackingNo: '',
    pose: 'park',
    cargo: 0,
  },
  orderId: '',
  onLoad(query: Record<string, string | undefined>) {
    this.orderId = String(query.id || '')
  },
  onShow() {
    void this.reload()
  },
  async reload() {
    if (!this.orderId) {
      this.setData({ loading: false, loadFailed: false, notFound: true })
      return
    }
    const r = await getOrderById(this.orderId)
    const vm = r.ok ? mapOrder(r.order) : null
    if (!r.ok) {
      const notFound = r.error === 'NOT_FOUND' || r.error === 'NO_ID'
      this.setData({ loading: false, notFound, loadFailed: !notFound && !this.data.trackingNo })
      return
    }
    this.setData({
      loading: false,
      loadFailed: false,
      notFound: !vm,
      company: vm ? vm.shipCompany : '',
      trackingNo: vm ? vm.trackingNo : '',
      pose: (vm && POSE[vm.status]) || 'park',
      cargo: vm && vm.status !== 'closed' ? Math.min(3, vm.items.length) : 0,
    })
  },
  onRetryLoad() {
    tapHaptic()
    this.setData({ loading: true, loadFailed: false })
    return this.reload()
  },
  onBack() {
    goBackOrHome()
  },
  onCopy() {
    this.copyNo('已复制运单号') // 事件处理器会收到事件对象，提示文案另走 copyNo 参数
  },
  copyNo(okText: string) {
    const no = this.data.trackingNo
    if (!no) return
    wx.setClipboardData({
      data: no,
      success: () => wx.showToast({ title: okText, icon: 'none' }),
      fail: () => wx.showToast({ title: '复制没成功，长按运单号手动复制', icon: 'none' }),
    })
  },
  // 快递100 插件结果页。插件打不开（未安装/版本不匹配等）不静默——回退复制运单号并说明去处，用户仍能自行查（根因#14）。
  onOpen() {
    const no = this.data.trackingNo
    if (!no) return
    const com = expressCode(this.data.company)
    const url = 'plugin://kuaidi100/index?num=' + no + '&appName=' + encodeURIComponent('小棉鸭') + (com ? '&com=' + com : '')
    wx.navigateTo({ url, fail: () => this.copyNo('物流详情暂时打不开，运单号已复制，可到快递官网查询') })
  },
})
