/**
 * 用户 / 登录接口（预留空壳）。微信登录、企业微信对接相关请求放这里。
 */
import { request } from './request'

export function login(code) {
  return request({ url: '/auth/login', method: 'POST', data: { code } }) // TODO
}
