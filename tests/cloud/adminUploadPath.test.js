import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { storeImage } from '../../packages/cloud/src/functions/admin/adminApi/lib'

// 云存储上传路径消毒（深审 P3·根因#3 不信前端）：客户端 pid/courseId 直接拼对象键，'../' 等路径字符
// 必须剥净（与 getVideoUploadMeta 的 name 同款 [^\w-] 白名单）。守卫 upload-path-sanitized 的行为侧。
beforeEach(() => control.reset())

describe('storeImage 路径消毒（深审 P3·#3）', () => {
  it("pid 含 '../'/斜杠 → 剥净不入对象键（防越出 products/<pid>/ 前缀）", async () => {
    const r = await storeImage(cloud, Buffer.from('hi').toString('base64'), { pid: '../../evil/p1', ext: 'png' })
    expect(r.ok).toBe(true)
    const up = control.lastUpload()
    expect(up.cloudPath).not.toContain('..')
    expect(up.cloudPath).not.toContain('//')
    expect(up.cloudPath).toMatch(/^products\/[\w-]+\//) // 前缀完好·pid 段只剩白名单字符
  })

  it('全非法 pid 回退 misc（不产生空段路径）；kind=video 走 videos/ 前缀', async () => {
    await storeImage(cloud, 'aGk=', { pid: '///', ext: 'jpg' })
    expect(control.lastUpload().cloudPath).toMatch(/^products\/misc\//)
    await storeImage(cloud, 'aGk=', { pid: 'p1', ext: 'mp4', kind: 'video' })
    expect(control.lastUpload().cloudPath).toMatch(/^videos\/p1\//)
  })
})
