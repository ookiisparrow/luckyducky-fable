// #386 告警 webhook 不回显：getSettings 只说「配了没 + 尾号」，不把整条带 key 的地址发给浏览器；
// saveSettings 空串＝保持原值，null＝显式清除。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const HOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd-1234-wxyz'
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: 'super-secret-key', data }),
  }).then((r: any) => ({ status: r.statusCode, raw: String(r.body), ...JSON.parse(r.body) }))
const saved = () => control.dump('adminConfig').find((d: any) => d._id === 'settings')

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' },
    { _id: 'settings', alertWebhook: HOOK, urlPrefix: 'https://p.example/' },
  ])
})

describe('getSettings 不回显 webhook', () => {
  it('大白话：只回「已配置」和尾号 4 位，整条地址不出现在回包里', async () => {
    const r = await post('getSettings')
    expect(r.ok).toBe(true)
    expect(r.settings.alertWebhook).toBeUndefined()
    expect(r.settings).toMatchObject({ alertWebhookSet: true, alertWebhookTail: 'wxyz', urlPrefix: 'https://p.example/' })
    expect(r.raw).not.toContain('abcd-1234')
  })

  it('大白话：没配时两个字段都不带（空配置仍是 {}）', async () => {
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha('super-secret-key'), role: 'superadmin' }])
    expect((await post('getSettings')).settings).toEqual({})
  })
})

describe('saveSettings webhook 三态', () => {
  it('大白话：空串或不传＝保持原值（页面拿不到原值，存别的设置不能把它抹掉）', async () => {
    expect((await post('saveSettings', { alertWebhook: '', urlPrefix: 'https://q.example/' })).ok).toBe(true)
    expect(saved().alertWebhook).toBe(HOOK)
    expect((await post('saveSettings', { urlPrefix: 'https://r.example/' })).ok).toBe(true)
    expect(saved()).toMatchObject({ alertWebhook: HOOK, urlPrefix: 'https://r.example/' })
  })

  it('大白话：null＝清除，推送退回只记日志', async () => {
    expect((await post('saveSettings', { alertWebhook: null })).ok).toBe(true)
    expect(saved().alertWebhook).toBe('')
    expect((await post('getSettings')).settings.alertWebhookSet).toBeUndefined()
  })

  it('大白话：合法新地址替换，野地址拒且不动原值', async () => {
    const next = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=new-9876'
    expect((await post('saveSettings', { alertWebhook: next })).ok).toBe(true)
    expect(saved().alertWebhook).toBe(next)
    expect(await post('saveSettings', { alertWebhook: 'https://evil.example/hook' })).toMatchObject({ ok: false, error: 'BAD_WEBHOOK' })
    expect(saved().alertWebhook).toBe(next)
  })
})
