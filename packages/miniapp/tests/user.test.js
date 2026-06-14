import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserStore } from '@/store/user.js'
import { USER } from '@/data/profile.js'

// 不挂 persist 插件，纯测 store 逻辑。
// 云调用统一 mock globalThis.wx（callCloud / uploadCloudFile 都有 typeof wx 守卫，
// 测试环境注入 wx 即模拟小程序端，删掉即模拟 H5 / App 端）。
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => {
  delete globalThis.wx
})

describe('user store · 云端资料回灌（mergeCloudProfile）', () => {
  it('云端非空字段覆盖本地展示（nickname → name）', () => {
    const store = useUserStore()
    store.mergeCloudProfile({ nickname: '云端鸭', avatar: 'cloud://a.png', bio: '云端签名' })
    expect(store.profile.name).toBe('云端鸭')
    expect(store.profile.avatar).toBe('cloud://a.png')
    expect(store.profile.bio).toBe('云端签名')
  })

  it('云端空字段不动本地（保留默认 / 本机改动）', () => {
    const store = useUserStore()
    store.mergeCloudProfile({ nickname: '', avatar: '', bio: '' })
    expect(store.profile.name).toBe(USER.name)
    expect(store.profile.bio).toBe(USER.bio)
    expect(store.profile.avatar).toBe('')
  })

  it('login 拿回云端用户后自动回灌资料', async () => {
    globalThis.wx = {
      cloud: {
        callFunction: async () => ({
          result: { ok: true, user: { _openid: 'oTEST', nickname: '云端鸭', avatar: '', bio: '' } },
        }),
      },
    }
    const store = useUserStore()
    await store.login()
    expect(store.openid).toBe('oTEST')
    expect(store.profile.name).toBe('云端鸭')
  })
})

describe('user store · 保存资料（saveProfile）', () => {
  it('无 openid（H5 / App 或未登录）：只存本地，视为成功', async () => {
    const store = useUserStore()
    const ok = await store.saveProfile({ name: '本机鸭', bio: '', avatar: '' })
    expect(ok).toBe(true)
    expect(store.profile.name).toBe('本机鸭')
  })

  it('有 openid：临时路径头像先传云存储换 fileID，再同步 updateProfile', async () => {
    const calls = []
    globalThis.wx = {
      cloud: {
        uploadFile: async ({ cloudPath }) => ({ fileID: 'cloud://env.x/' + cloudPath }),
        callFunction: async ({ name, data }) => {
          calls.push({ name, data })
          return { result: { ok: true, user: { _openid: 'oTEST', ...data } } }
        },
      },
    }
    const store = useUserStore()
    store.openid = 'oTEST'
    const ok = await store.saveProfile({ name: '小鸭', bio: 'hi', avatar: 'wxfile://tmp/a.jpeg' })
    expect(ok).toBe(true)
    expect(store.profile.avatar.startsWith('cloud://')).toBe(true)
    expect(calls[0].name).toBe('updateProfile')
    expect(calls[0].data.nickname).toBe('小鸭')
    expect(calls[0].data.avatar).toBe(store.profile.avatar)
  })

  it('头像已是 cloud:// fileID：不重复上传，原样同步', async () => {
    const calls = []
    globalThis.wx = {
      cloud: {
        uploadFile: async () => {
          throw new Error('不应上传')
        },
        callFunction: async ({ data }) => {
          calls.push(data)
          return { result: { ok: true, user: { _openid: 'oTEST', ...data } } }
        },
      },
    }
    const store = useUserStore()
    store.openid = 'oTEST'
    const ok = await store.saveProfile({ name: '小鸭', bio: '', avatar: 'cloud://env.x/a.png' })
    expect(ok).toBe(true)
    expect(calls[0].avatar).toBe('cloud://env.x/a.png')
  })

  it('头像上传失败：昵称签名照常同步、不带 avatar 字段（不清掉云端旧头像），整体报同步失败', async () => {
    const calls = []
    globalThis.wx = {
      cloud: {
        uploadFile: async () => {
          throw new Error('upload fail')
        },
        callFunction: async ({ data }) => {
          calls.push(data)
          return { result: { ok: true, user: { _openid: 'oTEST', ...data } } }
        },
      },
    }
    const store = useUserStore()
    store.openid = 'oTEST'
    const ok = await store.saveProfile({ name: '小鸭', bio: 'hi', avatar: 'wxfile://tmp/b.png' })
    expect(ok).toBe(false)
    expect(calls.length).toBe(1)
    expect(calls[0].nickname).toBe('小鸭')
    expect('avatar' in calls[0]).toBe(false)
  })

  it('云函数失败：返回 false，本地保存不受影响', async () => {
    globalThis.wx = {
      cloud: {
        callFunction: async () => ({ result: { ok: false, error: 'X' } }),
      },
    }
    const store = useUserStore()
    store.openid = 'oTEST'
    const ok = await store.saveProfile({ name: '小鸭', bio: '', avatar: '' })
    expect(ok).toBe(false)
    expect(store.profile.name).toBe('小鸭')
  })
})

describe('user store · 显式同意登录（consentLogin）', () => {
  it('小程序端：置登录态（isLogin 转真）并把授权的头像昵称推云端', async () => {
    const calls = []
    globalThis.wx = {
      cloud: {
        callFunction: async ({ name, data }) => {
          if (name === 'login') {
            return { result: { ok: true, user: { _openid: 'oTEST', nickname: '', avatar: '', bio: '' } } }
          }
          calls.push({ name, data })
          return { result: { ok: true, user: { _openid: 'oTEST', ...data } } }
        },
      },
    }
    const store = useUserStore()
    expect(store.isLogin).toBe(false)
    const ok = await store.consentLogin({ name: '小鸭', avatar: 'cloud://env.x/a.png' })
    expect(ok).toBe(true)
    expect(store.isLogin).toBe(true) // token 置位
    expect(store.openid).toBe('oTEST') // 静默身份已就绪
    expect(calls[0].name).toBe('updateProfile')
    expect(calls[0].data.nickname).toBe('小鸭')
    expect(calls[0].data.avatar).toBe('cloud://env.x/a.png')
  })

  it('H5 / App 端（无 wx）：仍置登录态、纯本地保存、返回 true', async () => {
    const store = useUserStore()
    const ok = await store.consentLogin({ name: '本机鸭' })
    expect(ok).toBe(true)
    expect(store.isLogin).toBe(true)
    expect(store.profile.name).toBe('本机鸭')
  })

  it('已有 openid：不再重复静默 login', async () => {
    const names = []
    globalThis.wx = {
      cloud: {
        callFunction: async ({ name, data }) => {
          names.push(name)
          return { result: { ok: true, user: { _openid: 'oTEST', ...data } } }
        },
      },
    }
    const store = useUserStore()
    store.openid = 'oTEST'
    await store.consentLogin({ name: '小鸭', avatar: 'cloud://env.x/a.png' })
    expect(names).not.toContain('login')
  })
})
