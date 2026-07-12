// 课程目录主页（C1·播放器重设计战役 批E）：hero 产品主图 + 大章节>小课时两层目录（段落层级只活在播放页
// segstrip，不在此出现）。数据源＝批A 落地的 lib/mapLearning mapCatalog（课时状态判定/续播段解耦，见其头注）。
// 课程结构走 lib/courses 会话缓存（本会话内不变·根因账本#15）；学习进度每次实时（onShow 重拉，同
// my-courses.ts 注释口径）；hero 背景图与目录/进度拉取并行发起，互不阻塞（同 welcome.ts homeReady 范式）。
import { getContent } from '../../api/catalog'
import { getCourseByIdDetailed } from '../../lib/courses'
import { getMyProgress } from '../../api/user'
import { mapCatalog, bgFor, type CatalogChapterVM } from '../../lib/mapLearning'
import type { ApiResult } from '../../utils/cloud'

Page({
  data: {
    statusBarHeight: 0,
    courseId: '',
    state: 'loading' as 'loading' | 'ok' | 'missing' | 'failed', // failed=目录拉取网络失败（可重试·根因#14），与 missing「课程不存在」分治
    bg: '',
    chapters: [] as CatalogChapterVM[],
    continueTarget: null as { segmentId: string; lessonId: string; lessonName: string } | null,
  },
  home: null as unknown,
  // hero 背景图请求（与 onShow 的目录+进度请求并行，互不依赖，省一次串行往返；页实例持有——同 welcome.ts
  // homeReady 注释：跟着本次 onLoad 走，避免跨实例复用陈旧 promise）。
  homeReady: null as Promise<ApiResult> | null,
  _seq: 0, // onShow 代次·丢弃过期回包（同 my-courses.ts _seq 范式）
  onLoad(query: Record<string, string | undefined>) {
    const info = wx.getWindowInfo()
    const courseId = String(query.courseId || '')
    this.setData({ statusBarHeight: info.statusBarHeight, courseId })
    if (!courseId) {
      this.setData({ state: 'missing' })
      return
    }
    this.homeReady = getContent()
    void this.homeReady.then((content) => {
      // fail-soft：拿不到内容→home 置空，bgFor 走回退链落空串，hero 渲染渐变占位，不阻塞目录本体。
      this.home = content.ok ? content.home : null
      this.setData({ bg: bgFor(this.home, courseId, 'activated') })
    })
  },
  async onShow() {
    const courseId = this.data.courseId
    if (!courseId) return // onLoad 已落 missing 态（courseId 缺失），onShow 不重复处理
    const seq = ++this._seq
    const [d, progress] = await Promise.all([getCourseByIdDetailed(courseId), getMyProgress()])
    if (seq !== this._seq) return // 慢回包已被更晚一次 onShow 接管，丢弃（同 my-courses.ts）
    // 失败≠不存在（根因#14）：目录拉取失败落 failed 给重试；只有拉取成功且查无此课才是 missing。
    // 已在 ok 态（返回页触发的 onShow 刷新失败）不降级覆盖，保留已展示目录。
    if (d.failed) {
      if (this.data.state !== 'ok') this.setData({ state: 'failed' })
      return
    }
    if (!d.course) {
      this.setData({ state: 'missing' })
      return
    }
    const { chapters, continueTarget } = mapCatalog(d.course, progress.ok ? progress.list : [], courseId)
    this.setData({ state: 'ok', chapters, continueTarget })
  },
  onRetryLoad() {
    this.setData({ state: 'loading' })
    void this.onShow()
  },
  // 「开始学习」CTA：continueTarget 非空跳播放页续播；为空（全课无可播段）诚实提示，不留死跳转。
  onStart() {
    const t = this.data.continueTarget
    if (!t) {
      wx.showToast({ title: '课程视频整理中', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/player/player?courseId=' + this.data.courseId + '&segmentId=' + t.segmentId })
  },
  // 课时行点击：firstPlayableSegId 非空跳该段；空＝本课时无可播视频（半上线），诚实提示。
  onTapLesson(e: WechatMiniprogram.TouchEvent) {
    const segId = String(e.currentTarget.dataset.seg || '')
    if (!segId) {
      wx.showToast({ title: '这节课还在整理中', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/player/player?courseId=' + this.data.courseId + '&segmentId=' + segId })
  },
})
