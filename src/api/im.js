/**
 * 客服 / 企业微信接口（预留空壳）。
 * 接入客服系统、企业微信会话等放这里。
 */
import { request } from './request'

export function startServiceSession() {
  return request({ url: '/im/session', method: 'POST' }) // TODO
}
