// 结业页（v5「字重」稿 C10 结业·小鸭孵化）：播放页整门课最后一节播完点「完成课程」进来（?courseId=）。
// 孵化动画同一只鸭（hatch-key＝courseId）只播一次，之后在「我」页陪着；数据只读课程本身，拿不到就只显示祝贺。
import { getCourseById } from '../../lib/courses'
import { mapFinish } from '../../lib/mapLearning'
import { tapHaptic } from '../../lib/haptics'
import { keyDown, keyUp } from '../../lib/keyFx'
import { fxParty } from '../../lib/pxFx'
import { groundGap } from '../../lib/ground'

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 地面线上方留白（屏高<700 用 56·UI 审查 6 问 2a）
    courseId: '',
    name: '',
    lessonsLabel: '',
    durLabel: '',
  },
  unloaded: false, // 已退页标记（await 恢复点复核·同 welcome 范式）
  onUnload() {
    this.unloaded = true
  },
  onReady() {
    setTimeout(() => void fxParty(this, '.fn-egg', true), 700) // 小鸭孵出来那一下整屏大撒花（设计稿 party big）
  },
  async onLoad(query: Record<string, string | undefined>) {
    const courseId = String(query.courseId || '')
    this.setData({ courseId })
    if (!courseId) return
    const course = await getCourseById(courseId)
    if (this.unloaded || !course) return
    this.setData(mapFinish(course))
  },
  onCatalog() {
    tapHaptic()
    wx.redirectTo({ url: '/pages/catalog/catalog?courseId=' + this.data.courseId })
  },
  // 去评价：评价挂在订单行上，结业页不知道是哪笔订单——带去「我的订单 · 已完成」挑一单写（订单页有「写评价」）
  onReview() {
    tapHaptic()
    wx.redirectTo({ url: '/pages/order-list/order-list?tab=done' })
  },
})
