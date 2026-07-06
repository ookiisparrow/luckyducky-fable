// 我的课程（M2 批10·C 类补学习进度）：已进课课程列表（join 课程标题 + 段粒度学习进度）。
import { getMyCourses, getCourses } from '../../api/learning'
import { getMyProgress } from '../../api/user'
import { mapMyCourses, type MyCourseVM } from '../../lib/mapLearning'

Page({
  data: {
    list: [] as MyCourseVM[],
    loading: true,
  },
  async onShow() {
    // 三 action 并发组合（云为唯一真相·纯前端 join 段数与 done map·不新增聚合 action）
    const [mine, courses, progress] = await Promise.all([getMyCourses(), getCourses(), getMyProgress()])
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
