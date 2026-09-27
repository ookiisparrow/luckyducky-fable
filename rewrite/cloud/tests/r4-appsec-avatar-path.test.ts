// #400-10（头像）：头像只收小程序上传目录 avatars/ 下的文件。内容安全会用管理权限把整个对象下载进内存，
// 以前只看 cloud:// 前缀，填付费课视频之类的大文件就能拖垮函数内存，也能把别处的私有文件设成公开头像。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const avatarNow = () => (control.dump('users')[0] || {}).avatar

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('updateProfile 头像归属', () => {
  it('小程序 profile-edit 上传的 avatars/<文件> 照收，并过内容安全', async () => {
    const dl = vi.spyOn(cloud as any, 'downloadFile')
    const id = 'cloud://prod-env.7072-prod-env-1300000000/avatars/1727400000000-123456.png'
    const r = await call('updateProfile', { avatar: id })
    expect(r.ok).toBe(true)
    expect(avatarNow()).toBe(id)
    expect(dl).toHaveBeenCalledWith({ fileID: id })
    dl.mockRestore()
  })

  it.each([
    ['付费课视频', 'cloud://prod-env.x/videos/course1/seg1.mp4'],
    ['别人的节点照片', 'cloud://prod-env.x/checkpoints/oOTHER/p.jpg'],
    ['商品图', 'cloud://prod-env.x/products/p1/main.jpg'],
    ['根目录文件', 'cloud://prod-env.x/a.png'],
    ['avatars 下再套目录', 'cloud://prod-env.x/avatars/sub/x.png'],
    ['路径穿越', 'cloud://prod-env.x/avatars/../videos/seg1.mp4'],
    ['只有前缀', 'cloud://prod-env.x/avatars/'],
    ['点段文件名', 'cloud://prod-env.x/avatars/..'],
  ])('%s：不收、不下载、不覆盖旧头像', async (_name, id) => {
    const keep = 'cloud://prod-env.x/avatars/old.png'
    await call('updateProfile', { avatar: keep })
    const dl = vi.spyOn(cloud as any, 'downloadFile')
    const r = await call('updateProfile', { avatar: id })
    expect(r).toEqual({ ok: false, error: 'EMPTY_PATCH' })
    expect(dl).not.toHaveBeenCalled()
    expect(avatarNow()).toBe(keep)
    dl.mockRestore()
  })

  it('空串仍是清空头像', async () => {
    await call('updateProfile', { avatar: 'cloud://prod-env.x/avatars/old.png' })
    expect((await call('updateProfile', { avatar: '' })).ok).toBe(true)
    expect(avatarNow()).toBe('')
  })
})
