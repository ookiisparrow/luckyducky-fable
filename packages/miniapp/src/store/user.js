/**
 * 用户 / 账号状态（Pinia）。
 * 登录态 token 是用户显式同意后的持久标记；profile 承载「我的页」资料，由资料编辑页读写。
 * 小程序端：登录后云端 users 的非空资料（nickname/avatar/bio）覆盖本地展示（跨设备以云端为准）；
 * 保存资料时头像传云存储、字段经 updateProfile 云函数写回 users。H5 / App 端纯本地。
 *
 * profile 结构：{ name, lv, bio, avatar }（avatar 为图片路径或云存储 fileID，空则灰占位）
 */
import { defineStore } from 'pinia'
import { USER } from '@/data/profile.js'
import { randomAvatar } from '@/data/avatars.js'
import { updateProfile as apiUpdateProfile } from '@/api/user.js'
import { uploadCloudFile } from '@/utils/cloud.js'
import logger from '@/utils/logger.js'

const defaultProfile = () => ({ ...USER, avatar: '' })

export const useUserStore = defineStore('user', {
  state: () => ({
    token: '', // 持久登录标记：用户同意登录后置 openid 或 H5/App 本地标记
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
          this.mergeCloudProfile(u)
        }
      } catch (e) {
        logger.error('login', e)
      }
      // #endif
    },
    // 云端资料的非空字段覆盖本地展示（空字段不动本地，保留默认 / 本机改动）。
    mergeCloudProfile(u) {
      const patch = {}
      if (u.nickname) patch.name = u.nickname
      if (u.avatar) patch.avatar = u.avatar
      if (u.bio) patch.bio = u.bio
      if (Object.keys(patch).length) this.profile = { ...this.profile, ...patch }
    },
    // 保存资料：本地即时生效；已登录云端（有 openid，即小程序端）时同步到 users。
    // 头像若是新选的本地临时路径（非 cloud:// fileID）先传云存储换 fileID；
    // 上传失败不中断——昵称 / 签名照常同步、本次不动云端头像，但整体按「同步失败」上报。
    // 返回云端是否同步成功（纯本地场景视为成功），页面据此提示。
    async saveProfile(patch) {
      this.updateProfile(patch)
      if (!this.openid) return true
      try {
        const data = { nickname: this.profile.name, bio: this.profile.bio }
        let avatar = this.profile.avatar
        let avatarFailed = false
        if (avatar && !avatar.startsWith('cloud://')) {
          let fileID = null
          try {
            const ext = (avatar.match(/\.\w+$/) || ['.png'])[0]
            fileID = await uploadCloudFile(`avatars/${this.openid}-${Date.now()}${ext}`, avatar)
          } catch (e) {
            logger.error('saveProfile.upload', e)
          }
          if (fileID) {
            avatar = fileID
            this.profile = { ...this.profile, avatar }
          } else {
            avatar = null
            avatarFailed = true
          }
        }
        if (avatar !== null) data.avatar = avatar
        const u = await apiUpdateProfile(data)
        if (u) this.cloudUser = u
        return !!u && !avatarFailed
      } catch (e) {
        logger.error('saveProfile', e)
        return false
      }
    },
    // 微信一键登录：用户勾选同意协议后调用（规格 §四-1 第②段）。静默 openid 已是身份
    // （App.onLaunch 已 login，无则此处再静默拿一次）；只置持久化登录标记 token（isLogin 转真、
    // 跨会话不再追问），**登录环节不采集头像昵称**——资料可稍后在「编辑资料」页用微信头像昵称能力补。
    // openid 为空的 H5 / App 端用占位标记 'wx'，纯本地登录。返回 true 表示登录态已建立。
    async consentLogin() {
      // #ifdef MP-WEIXIN
      if (!this.openid) await this.login()
      // #endif
      this.token = this.openid || 'wx'
      // 新用户（还没有头像）→ 从头像库随机分配一个（默认昵称 Lucky friend 已在 defaultProfile）
      if (!this.profile.avatar) this.profile = { ...this.profile, avatar: randomAvatar() }
      return true
    },
    // 退出登录：清持久登录标记 + 内存身份（openid/cloudUser）+ 资料回默认样例。
    // openid 下次冷启动静默 login 会重拿；token 持久化为空 → isLogin 跨会话保持登出，
    // 直到用户重新在登录弹窗显式同意。
    logout() {
      this.token = ''
      this.openid = ''
      this.cloudUser = null
      this.profile = defaultProfile()
    },
  },
})
