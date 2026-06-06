/**
 * 用户 / 账号状态（Pinia）。
 * 登录态（token）仍为预留（微信登录后续做）；profile 现在承载「我的页」资料，
 * 由资料编辑页读写。以后微信登录拿到真实资料后，覆盖到 profile 即可，页面不动。
 *
 * profile 结构：{ name, phone, lv, bio, avatar }（avatar 为图片路径，空则灰占位）
 */
import { defineStore } from 'pinia'
import { USER } from '@/data/profile.js'

const defaultProfile = () => ({ ...USER, avatar: '' })

export const useUserStore = defineStore('user', {
  state: () => ({
    token: '', // 登录令牌（以后微信登录后写入）
    profile: defaultProfile(), // 用户资料（现为样例，可在资料编辑页修改）
  }),
  getters: {
    isLogin: (state) => !!state.token,
  },
  actions: {
    updateProfile(patch) {
      this.profile = { ...this.profile, ...patch }
    },
    // TODO: 接入微信登录后实现
    async login() {
      // const { code } = await uni.login(...)
      // this.token = await loginApi(code)
    },
    logout() {
      this.token = ''
      this.profile = defaultProfile()
    },
  },
})
