/**
 * 学习进度 store（用户态，与课程内容分离——内容在 store/courses.js）。
 * 小程序端：云端 progress 文档（播放页 track() 写、getMyProgress 读，segment 粒度）；
 * H5 / App 或云不可用：lesson 级回退样例 SAMPLE_PROGRESS（演示路径）。
 * 不持久化：进度是服务端状态，进页拉取。
 */
import { defineStore } from 'pinia'
import { getMyProgress } from '@/api/progress.js'
import { SAMPLE_PROGRESS } from '@/data/course.js'
import { logger } from '@/utils/logger.js'

// 演示进度回退只给 H5/App（无云·开发演示）。mp 端云为唯一真相源——云失败时 fail-closed 到「空进度」、
// 绝不回退演示数据（审计 P2-5·根因#8）：真用户云失败时若看到演示的「已学完/观看中」，会误导继续学习路径。
// 默认 true（H5/App 演示）；mp 端编译期改 false（用 let + 单次重赋·避两 const 触 no-redeclare·#ifdef 不被 lint 处理）。
let DEMO_FALLBACK = true
// #ifdef MP-WEIXIN
DEMO_FALLBACK = false
// #endif

export const useProgressStore = defineStore('progress', {
  state: () => ({
    byCourse: {}, // courseId -> { done:{segId:true}, last:{lessonId,segmentId,at,dur}, updatedAt }
    remote: false, // 云端进度是否可用（false = 回退样例）
    loaded: false,
    loading: false,
  }),
  getters: {
    // 某课时的进度（目录角标用），与样例同形：{ done:true } / { watched:0~1 } / {}
    ofLesson: (s) => (courseId, lesson) => {
      if (!lesson) return {}
      // 云未就绪：mp 端 fail-closed 到空（不演示·审计 P2-5），H5/App 演示回退
      if (!s.remote) return DEMO_FALLBACK ? SAMPLE_PROGRESS[lesson.id] || {} : {}
      const doc = s.byCourse[courseId]
      const segs = Array.isArray(lesson.segments) ? lesson.segments : []
      if (!doc || !segs.length) return {}
      const n = segs.filter((seg) => doc.done && doc.done[seg.id]).length
      if (n >= segs.length) return { done: true }
      if (n > 0) return { watched: n / segs.length }
      // 整段还没看完一个、但「最后看到」停在这节 → 按位置给进行中
      const last = doc.last
      if (last && last.lessonId === lesson.id && last.at > 0 && last.dur > 0) {
        return { watched: Math.min(0.99, last.at / last.dur) }
      }
      return {}
    },
    // 最近的继续学习点：{ courseId, lessonId, segmentId, at, dur } | null（「我」页卡回退样例）
    lastWatch: (s) => {
      if (!s.remote) return null
      let best = null
      let bestT = -1
      for (const courseId of Object.keys(s.byCourse)) {
        const doc = s.byCourse[courseId]
        const t = doc.updatedAt || 0
        if (doc.last && doc.last.lessonId && t > bestT) {
          best = { courseId, ...doc.last }
          bestT = t
        }
      }
      return best
    },
  },
  actions: {
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        const list = await getMyProgress()
        if (Array.isArray(list)) {
          const map = {}
          list.forEach((d) => {
            if (d && d.courseId) map[d.courseId] = d
          })
          this.byCourse = map
          this.remote = true
        }
        this.loaded = true
      } catch (e) {
        logger.error('progress', 'load 失败', e)
      } finally {
        this.loading = false
      }
    },
  },
})
