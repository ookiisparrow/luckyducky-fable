/**
 * 用户 / 账号状态（预留）。
 * 以后接「微信登录、个人资料」时在这里管理登录态与用户信息。
 * 现在是空壳，首页用不到，但先占好位置，保证后续扩展是「加代码」而非「改结构」。
 */
import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: '', // 登录令牌（以后微信登录后写入）
    profile: null, // 用户资料
  }),
  getters: {
    isLogin: (state) => !!state.token,
  },
  actions: {
    // TODO: 接入微信登录后实现
    async login() {
      // const { code } = await uni.login(...)
      // this.token = await loginApi(code)
    },
    logout() {
      this.token = ''
      this.profile = null
    },
  },
})
