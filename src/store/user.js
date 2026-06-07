/**
 * 用户 / 账号状态（Pinia）。
 * 登录态（token）仍为预留（微信登录后续做）；profile 现在承载「我的页」资料，
 * 由资料编辑页读写。以后微信登录拿到真实资料后，覆盖到 profile 即可，页面不动。
 *
 * profile 结构：{ name, phone, lv, bio, avatar }（avatar 为图片路径，空则灰占位）
 */
import { defineStore } from 'pinia'
import { USER } from '@/data/profile.js'
import logger from '@/utils/logger.js'

const defaultProfile = () => ({ ...USER, avatar: '' })

export const useUserStore = defineStore('user', {
  state: () => ({
    token: '', // 登录令牌（以后微信登录后写入）
    profile: defaultProfile(), // 用户资料（现为样例，可在资料编辑页修改）
    openid: '', // 微信登录后的 openid（不持久化，每次启动静默 login 重新拿）
    cloudUser: null, // 云端 users 记录（P0 起步；资料展示迁移留待"完善资料"步）
  }),
  // 登录态与资料都要跨会话保留。回灌守卫：token 须为字符串、profile 须为普通对象，
  // 否则该字段不回灌（保留初始默认）；profile 缺字段由 defaultProfile 深合并兜底。
  persist: {
    paths: ['token', 'profile'],
    sanitize: (s) => {
      const out = {}
      if (typeof s.token === 'string') out.token = s.token
      if (s.profile && typeof s.profile === 'object' && !Array.isArray(s.profile)) {
        out.profile = s.profile
      }
      return out
    },
  },
  getters: {
    isLogin: (state) => !!state.token,
  },
  actions: {
    updateProfile(patch) {
      this.profile = { ...this.profile, ...patch }
    },
    // 静默登录:调云函数 login（后端用可信 openid upsert users），拿回用户。
    // 仅小程序端有 wx.cloud；H5 / App 端为空操作（保留本地样例 profile）。
    async login() {
      // #ifdef MP-WEIXIN
      try {
        const res = await wx.cloud.callFunction({ name: 'login' })
        const u = res && res.result && res.result.ok && res.result.user
        if (u) {
          this.openid = u._openid || ''
          this.cloudUser = u
        }
      } catch (e) {
        logger.error('login', e)
      }
      // #endif
    },
    logout() {
      this.token = ''
      this.profile = defaultProfile()
    },
  },
})
