// 学习域 api（经 app 网关·激活/进课裁决全在云端——一码一用抢占/退货权失效节点都是云端原子操作）
import { callApp, type ApiResult } from '../utils/cloud'

export const activateCourse = (code: string): Promise<ApiResult> => callApp('activateCourse', { code })
export const confirmEnter = (code: string): Promise<ApiResult> => callApp('confirmEnter', { code })
export const getCourses = (): Promise<ApiResult> => callApp('getCourses')
export const getMyCourses = (): Promise<ApiResult> => callApp('getMyCourses')
export const getPlaybackUrl = (courseId: string, segmentId: string): Promise<ApiResult> => callApp('getPlaybackUrl', { courseId, segmentId })
export const getHelpVideos = (): Promise<ApiResult> => callApp('getHelpVideos')
// 求助面板·精选 FAQ 公开读（R37b·KB 单源·无鉴权只读，同 getProducts/getContent 口径）
export const getPublicFaq = (): Promise<ApiResult> => callApp('getPublicFaq')
export const trackEvent = (type: string, page: string, targetId: string, meta: Record<string, unknown> = {}): void => {
  // 发了就不管（黄金 §四埋点出口：fire-and-forget·失败不反噬播放）
  void callApp('trackEvent', { type, page, targetId, meta }).catch(() => undefined)
}
