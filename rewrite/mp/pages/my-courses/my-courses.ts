// 我的课程（M2 批10·C 类补学习进度）：已进课课程列表（join 课程标题 + 段粒度学习进度）。
import { getMyCourses } from '../../api/learning'
import { getMyProgress } from '../../api/user'
import { getAllCourses } from '../../lib/courses'
import { mapMyCourses, type MyCourseVM } from '../../lib/mapLearning'

Page({
  data: {
    list: [] as MyCourseVM[],
    loading: true,
    loadFailed: false, // 失败≠空态（根因#14·守卫 rw-mp-list-loadfailed-state）：与「输入激活码」引导分治——付费用户弱网一次失败不该被引导输码
    highlightId: '', // 扫码激活定位：welcome.ts onEnter 带 courseId 跳回本页，高亮刚拿到的那张课卡
  },
  _seq: 0, // onShow 代次·丢弃过期回包（同 player playToken）
  onLoad(query: Record<string, string | undefined>) {
    // query 只在 onLoad 拿得到（onShow 无参）；先存起来供 onShow 渲染时读
    this.setData({ highlightId: String(query.courseId || '') })
  },
  onShow() {
    void this.reload()
  },
  async reload() {
    // 三路组合（云为唯一真相·纯前端 join 段数与 done map·不新增聚合 action）：getMyCourses/getMyProgress
    // 每次实时（进度返回页面必须新鲜）；课程目录本会话内不变，走 lib/courses 会话缓存（根因账本#15）。
    const seq = ++this._seq
    const [mine, courses, progress] = await Promise.all([getMyCourses(), getAllCourses(), getMyProgress()])
    // 慢/超时回包不覆盖较新结果：tab 来回切/返回触发的后一次 onShow 已落地时，前一次（尤其超时 ok:false）
    // 迟到的 setData 会把有课列表盖成空态、误显「输入激活码」——代次不符即丢弃。
    if (seq !== this._seq) return
    // 失败≠空态（根因#14）：失败不覆盖已展示课程；一无所有时落 loadFailed 给重试，不误导去输激活码。
    if (!mine.ok) {
      this.setData({ loading: false, loadFailed: !this.data.list.length })
      if (this.data.list.length) wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
      return
    }
    this.setData({
      loading: false,
      loadFailed: false,
      list: mapMyCourses(mine.list, courses || [], progress.ok ? progress.list : []),
    })
  },
  onRetryLoad() {
    this.setData({ loading: true, loadFailed: false })
    void this.reload()
  },
  onTapCourse(e: WechatMiniprogram.TouchEvent) {
    // 课卡进目录（章>课时两层浏览），目录再进播放——播放器重设计战役批E 接线，highlightId 高亮逻辑不变。
    wx.navigateTo({ url: '/pages/catalog/catalog?courseId=' + String(e.currentTarget.dataset.id) })
  },
  onActivate() {
    wx.navigateTo({ url: '/pages/welcome/welcome' })
  },
})
