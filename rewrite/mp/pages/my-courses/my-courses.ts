// 我的课程（M2 批10·C 类补学习进度）：已进课课程列表（join 课程标题 + 段粒度学习进度）。
import { getMyCourses, getCourses } from '../../api/learning'
import { getMyProgress } from '../../api/user'
import { mapMyCourses, type MyCourseVM } from '../../lib/mapLearning'

Page({
  data: {
    list: [] as MyCourseVM[],
    loading: true,
  },
  _seq: 0, // onShow 代次·丢弃过期回包（同 player playToken）
  async onShow() {
    // 三 action 并发组合（云为唯一真相·纯前端 join 段数与 done map·不新增聚合 action）
    const seq = ++this._seq
    const [mine, courses, progress] = await Promise.all([getMyCourses(), getCourses(), getMyProgress()])
    // 慢/超时回包不覆盖较新结果：tab 来回切/返回触发的后一次 onShow 已落地时，前一次（尤其超时 ok:false）
    // 迟到的 setData 会把有课列表盖成空态、误显「输入激活码」——代次不符即丢弃。
    if (seq !== this._seq) return
    this.setData({
      loading: false,
      list: mine.ok ? mapMyCourses(mine.list, courses.ok ? courses.list : [], progress.ok ? progress.list : []) : [],
    })
  },
  onTapCourse(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/player/player?courseId=' + String(e.currentTarget.dataset.id) })
  },
  onActivate() {
    wx.navigateTo({ url: '/pages/welcome/welcome' })
  },
})
