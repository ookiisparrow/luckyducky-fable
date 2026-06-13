/**
 * 课程激活 store（Pinia）。我的已解锁课程（已确认 enteredAt 的激活集）收口于此；
 * catalog（锁态）/ player（鉴权）/ welcome（激活+确认）从这里走。
 *
 * 不持久化：解锁状态是服务端事实，每次启动从云端拉（H5/App 回退演示模式全解锁）。
 */
import { defineStore } from 'pinia'
import { activateCourse, confirmEnter, getMyCourses } from '@/api/activation.js'
import { logger } from '@/utils/logger.js'

export const useActivationStore = defineStore('activation', {
  state: () => ({
    mine: [], // [{ courseId, enteredAt }]
    loaded: false,
    loading: false,
  }),
  getters: {
    unlocked: (s) => (courseId) => s.mine.some((m) => m.courseId === courseId),
  },
  actions: {
    async loadMine(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        this.mine = await getMyCourses()
        this.loaded = true
      } catch (e) {
        logger.error('activation', 'loadMine 失败', e)
      } finally {
        this.loading = false
      }
    },
    // 扫码激活（绑定账户）。返回云函数结果，页面按 state / error 分流。
    async activate(code) {
      return activateCourse(code)
    },
    // 确认开始观看（退货权法律节点）。成功后本地同步解锁，不必强刷。
    async confirm(code, courseId) {
      const res = await confirmEnter(code)
      if (res?.ok && courseId && !this.unlocked(courseId)) {
        this.mine.push({ courseId, enteredAt: res.enteredAt })
      }
      return res
    },
  },
})
