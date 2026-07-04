// 用户域 api（经 app 网关·身份=可信 openid·登录零资料采集）
import { callApp, type ApiResult } from '../utils/cloud'

export const login = (): Promise<ApiResult> => callApp('login')
export const updateProfile = (patch: { nickname?: string; bio?: string; avatar?: string }): Promise<ApiResult> => callApp('updateProfile', patch)
export const getMyProgress = (): Promise<ApiResult> => callApp('getMyProgress')
export const submitFeedback = (content: string, category: string, contact: string): Promise<ApiResult> =>
  callApp('submitFeedback', { content, category, contact, page: 'feedback', version: 'rw-m2', platform: 'mp' })
// 数据共享授权同意/撤回（服务端 users.csDataShare 为真值·外包坐席看 360 前 fail-closed 校验）
export const setDataShareConsent = (agree: boolean): Promise<ApiResult> => callApp('dataConsent', { agree })
