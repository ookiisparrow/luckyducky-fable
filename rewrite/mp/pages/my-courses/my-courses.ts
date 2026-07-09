// 我的课程（M2 批10·C 类补学习进度）：已进课课程列表（join 课程标题 + 段粒度学习进度）。
import { getMyCourses } from '../../api/learning'
import { getMyProgress } from '../../api/user'
import { getAllCourses } from '../../lib/courses'
import { mapMyCourses, type MyCourseVM } from '../../lib/mapLearning'

Page({
  data: {
    list: [] as MyCourseVM[],
    loading: true,
    highlightId: '', // 扫码激活定位：welcome.ts onEnter 带 courseId 跳回本页，高亮刚拿到的那张课卡
  },
  _seq: 0, // onShow 代次·丢弃过期回包（同 player playToken）
  onLoad(query: Record<string, string | undefined>) {
    // query 只在 onLoad 拿得到（onShow 无参）；先存起来供 onShow 渲染时读
    this.setData({ highlightId: String(query.courseId || '') })
  },
  async onShow() {
    // 三路组合（云为唯一真相·纯前端 join 段数与 done map·不新增聚合 action）：getMyCourses/getMyProgress
    // 每次实时（进度返回页面必须新鲜）；课程目录本会话内不变，走 lib/courses 会话缓存（根因账本#15）。
    const seq = ++this._seq
    const [mine, courses, progress] = await Promise.all([getMyCourses(), getAllCourses(), getMyProgress()])
    // 慢/超时回包不覆盖较新结果：tab 来回切/返回触发的后一次 onShow 已落地时，前一次（尤其超时 ok:false）
    // 迟到的 setData 会把有课列表盖成空态、误显「输入激活码」——代次不符即丢弃。
    if (seq !== this._seq) return
    this.setData({
      loading: false,
      list: mine.ok ? mapMyCourses(mine.list, courses || [], progress.ok ? progress.list : []) : [],
    })
  },
  onTapCourse(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: '/pages/player/player?courseId=' + String(e.currentTarget.dataset.id) })
  },
  onActivate() {
    wx.navigateTo({ url: '/pages/welcome/welcome' })
  },
})
