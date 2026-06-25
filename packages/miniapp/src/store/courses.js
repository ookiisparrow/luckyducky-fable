/**
 * 课程 store（Pinia）。小程序端从云端拉的三层课程（chapter/lesson/segment）收口于此；
 * catalog / player 页面从这里取，不再直接 import 静态 data/course.js。
 *
 * api 层在云端失败 / 非小程序端时已回退本地 data/course.js，所以 load 后
 * list 恒为可用列表；load 前 getters 给安全空形状，页面不用判空。
 *
 * 不持久化：课程内容以云端为准，每次启动拉最新。
 * 学习进度是用户态，不在这里；segment 粒度进度由 progress store 从云端读取。
 */
import { defineStore } from 'pinia'
import { getCourses, getPlaybackUrl } from '@/api/course.js'
import { createPlaybackResolver } from '@/utils/playbackCache.js'
import { logger } from '@/utils/logger.js'

const EMPTY_COURSE = { id: '', title: '', chapters: [] }

// 分段播放地址解析器（模块层单例·跨播放页/组件共享缓存）：按 segId 缓存临时 URL + in-flight 去重 +
// 预取（见 utils/playbackCache.js）。解析器放 utils（主包）而非 pkg-video（分包）——store 在主包，
// 主包 require 分包模块在 mp-weixin 会运行时崩（白屏·根因#8·守卫 main-no-subpackage-import）。
// fetcher 闭包绑「当前聚焦课 id」——一次播放会话同一门课，
// 取址/预取前由 action 同步 _courseId（getPlaybackUrl 鉴权按 courseId+segmentId）。治真机段间转场卡顿（根因#8）。
let _courseId = ''
const _resolver = createPlaybackResolver({ fetcher: (segId) => getPlaybackUrl(_courseId, segId) })

export const useCoursesStore = defineStore('courses', {
  state: () => ({
    list: [],
    currentId: '', // 当前聚焦课程 id（扫码激活/继续学习/目录入口设）；空＝回退第一门
    loaded: false,
    loading: false,
  }),
  getters: {
    // 当前课程：优先 currentId 指定的那门（扫码激活的课）；未指定 / 指向不存在的课 → 回退 list[0]。
    // 根因#8：原来恒 list[0]，单课样本下恰好对，真上第二门课（小熊）后激活它却仍显第一门，故改按 currentId 取。
    current: (s) =>
      (s.currentId && s.list.find((c) => c.id === s.currentId)) || s.list[0] || EMPTY_COURSE,
    // 按 id 取课程（欢迎页按激活码渲染课程标题用；取不到返回 null）
    getById: (s) => (id) => s.list.find((c) => c.id === id) || null,
    // 当前课程拍平课时表（带 chapter 归属）：目录进度统计 / 播放页上下集用
    allLessons() {
      return this.current.chapters.flatMap((c) => c.lessons.map((l) => ({ ...l, chapter: c.id })))
    },
  },
  actions: {
    // 聚焦某门课（welcome 激活后 / catalog 带 courseId 进入 / 默认激活集时设）；空＝回退第一门。
    setCurrent(id) {
      this.currentId = id || ''
    },
    // 拉取课程列表。已加载则跳过；force=true 强制刷新。
    async load(force = false) {
      if (this.loading) return
      if (this.loaded && !force) return
      this.loading = true
      try {
        this.list = await getCourses()
        this.loaded = true
      } catch (e) {
        logger.error('courses', 'load 失败', e)
      } finally {
        this.loading = false
      }
    },
    // 取当前课程某分段的播放地址：经解析器缓存优先（命中即返回·回看/重复段零云往返），未命中才换址。
    // URL 是瞬时态、不入 state；服务端鉴权按 courseId+segmentId（见 getPlaybackUrl 云函数）。
    async playbackUrl(segmentId) {
      _courseId = this.current.id
      return _resolver.load(segmentId)
    },
    // 预取某分段地址（当前段播放期间预热下一段·静默失败不影响主流程）→ 切段时直接命中缓存、接近秒切。
    prefetchPlaybackUrl(segmentId) {
      _courseId = this.current.id
      _resolver.prefetch(segmentId)
    },
  },
})
