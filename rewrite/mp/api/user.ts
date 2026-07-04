// 用户域 api（经 app 网关·身份=可信 openid·登录零资料采集）
import { callApp, type ApiResult } from '../utils/cloud'

export const login = (): Promise<ApiResult> => callApp('login')
export const updateProfile = (patch: { nickname?: string; bio?: string; avatar?: string }): Promise<ApiResult> => callApp('updateProfile', patch)
export const getMyProgress = (): Promise<ApiResult> => callApp('getMyProgress')
export const submitFeedback = (content: string, category: string, contact: string): Promise<ApiResult> =>
  callApp('submitFeedback', { content, category, contact, page: 'feedback', version: 'rw-m2', platform: 'mp' })
