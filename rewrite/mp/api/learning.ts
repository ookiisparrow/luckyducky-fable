// 学习域 api（经 app 网关·激活/进课裁决全在云端——一码一用抢占/退货权失效节点都是云端原子操作）
import { callApp, type ApiResult } from '../utils/cloud'
import { markStale } from '../utils/fresh'

// 写完标脏（utils/fresh）：我的课程/「我」页回来必重拉。超时等失败也标——云端可能已成功
const touch = (p: Promise<ApiResult>): Promise<ApiResult> =>
  p.then((r) => {
    markStale('learning')
    return r
  })

export const activateCourse = (code: string): Promise<ApiResult> => touch(callApp('activateCourse', { code }))
export const confirmEnter = (code: string): Promise<ApiResult> => touch(callApp('confirmEnter', { code }))
export const getCourses = (data?: { ids?: string[] }): Promise<ApiResult> =>
  data ? callApp('getCourses', data) : callApp('getCourses')
// 我的课 + 学习进度一次往返（性能批 #1/#4·替代 getMyCourses + getMyProgress 两次）：回 { courses, progress }，进度读失败 progress 为 null
export const getMyLearning = (): Promise<ApiResult> => callApp('getMyLearning')
export const getPlaybackUrl = (courseId: string, segmentId: string): Promise<ApiResult> => callApp('getPlaybackUrl', { courseId, segmentId })
export const getHelpVideos = (): Promise<ApiResult> => callApp('getHelpVideos')
// 求助面板·精选 FAQ 公开读（R37b·KB 单源·无鉴权只读，同 getProducts/getContent 口径）
export const getPublicFaq = (): Promise<ApiResult> => callApp('getPublicFaq')
export const trackEvent = (type: string, page: string, targetId: string, meta: Record<string, unknown> = {}): void => {
  // 带课程的埋点（segment_done/watch_at）云端会折叠进学习进度：发出即标脏，回到课程/「我」页看到新进度。
  // 按 meta.courseId 判、不另抄云端的 type 清单（防两边漂移）；多标一次只是多拉一次，无害
  if (meta.courseId) markStale('learning')
  // 发了就不管（埋点出口：fire-and-forget·失败不反噬播放）
  void callApp('trackEvent', { type, page, targetId, meta }).catch(() => undefined)
}
