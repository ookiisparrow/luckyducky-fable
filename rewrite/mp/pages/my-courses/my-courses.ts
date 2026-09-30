// 我的课程：已进课课程列表（join 课程标题 + 段粒度学习进度）。
import { tapHaptic } from '../../lib/haptics'
import { getMyLearning } from '../../api/learning'
import { getAllCourses } from '../../lib/courses'
import { mapMyCourses, type MyCourseVM } from '../../lib/mapLearning'
import { keyDown, keyUp } from '../../lib/keyFx'
import { groundGap } from '../../lib/ground'
import { goHomeTab } from '../../lib/homeIntent'
import { fxHint } from '../../lib/pxFx'
import { FRESH_MS, isFresh } from '../../utils/fresh'

Page({
  onKeyDown: keyDown, // v5 按键手感（lib/keyFx）
  onKeyUp: keyUp,
  data: {
    groundGap: groundGap(), // 空态纸箱落地线（同售后页·本页多一行大标题故 −36）
    list: [] as MyCourseVM[],
    loading: true,
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：与「输入激活码」引导分治——付费用户弱网一次失败不该被引导输码
  },
  _seq: 0, // onShow 代次·丢弃过期回包（同 player playToken）
  _freshAt: 0, // 上次 reload 成功落地的时刻（utils/fresh）：返回 30s 内且期间没激活/进课/写进度就不重拉
  onShow() {
    // 返回免重拉（性能批 #2）：看视频的进度埋点、激活/进课在 api 层已标脏，回来必拉；只是进目录看了眼就不拉
    if (!isFresh('learning', this._freshAt, FRESH_MS)) void this.reload()
  },
  async reload() {
    // 两路组合（云为唯一真相·纯前端 join 段数与 done map）：getMyLearning 一次拿我的课 + 进度（性能批 #4·进度写过回来必新鲜·
    // 由 utils/fresh 标脏保证）；课程目录本会话内不变，走 lib/courses 会话缓存（根因账本#15）。
    const seq = ++this._seq
    const [mine, courses] = await Promise.all([getMyLearning(), getAllCourses()])
    // 慢/超时回包不覆盖较新结果：tab 来回切/返回触发的后一次 onShow 已落地时，前一次（尤其超时 ok:false）
    // 迟到的 setData 会把有课列表盖成空态、误显「输入激活码」——代次不符即丢弃。
    if (seq !== this._seq) return
    // 失败≠空态（根因#14）：失败不覆盖已展示课程；一无所有时落 loadFailed 给重试，不误导去输激活码。
    // courses===null（目录拉取失败·getAllCourses 失败语义）同判失败——否则 mapMyCourses 查不到课程标题，
    // 课卡会显示原始 courseId、进度条整行消失，用户以为数据坏了（口径对齐 me.ts contFetchFailed）。
    if (!mine.ok || courses === null) {
      this.setData({ loading: false, loadFailed: !this.data.list.length })
      if (this.data.list.length) fxHint(this, '刷新失败，请稍后重试')
      return
    }
    this.setData({
      loading: false,
      loadFailed: false,
      // 进度失败云端给 null 而非 []（根因#14）：[] 与「真的一段没学过」不可区分，课卡会谎报
      // 「已学 0/80 · 0%」；null 落 progressUnknown，界面显示「进度暂时读不到，点此重试」（点按走 onRetryLoad，本页无下拉刷新）。
      // 课程列表本身照常渲染（进度只是卡上一行，不该因它失败把整页打成失败态）。
      list: mapMyCourses(mine.courses, courses || [], Array.isArray(mine.progress) ? mine.progress : null),
    })
    if (Array.isArray(mine.progress)) this._freshAt = Date.now() // 进度没拉到不记新鲜（下次 onShow 再试，别把「读不到」缓存住）
  },
  // 空态「去逛逛」：回首页（从首屏购买区看起·15 问 12b）
  onGoShop() {
    goHomeTab()
  },
  onRetryLoad() {
    tapHaptic()
    this.setData({ loading: true, loadFailed: false })
    void this.reload()
  },
  onTapCourse(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/catalog/catalog?courseId=' + String(e.currentTarget.dataset.id) })
  },
})
