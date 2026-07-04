// 我的课程（M2 批10）：已进课课程列表（join 课程标题）。播放页随批11 接。
import { getMyCourses, getCourses } from '../../api/learning'
import { mapMyCourses, type MyCourseVM } from '../../lib/mapLearning'

Page({
  data: {
    list: [] as MyCourseVM[],
    loading: true,
  },
  async onShow() {
    const [mine, courses] = await Promise.all([getMyCourses(), getCourses()])
    this.setData({
      loading: false,
      list: mine.ok ? mapMyCourses(mine.list, courses.ok ? courses.list : []) : [],
    })
  },
  onTapCourse(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/player/player?courseId=' + String(e.currentTarget.dataset.id) })
  },
  onActivate() {
    wx.navigateTo({ url: '/pages/welcome/welcome' })
  },
})
