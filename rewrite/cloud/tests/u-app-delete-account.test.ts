// deleteAccount 失败≠已删除（根因#14）：任一步读/删/改绑失败，都不许回 deleted:true 却留着课权或旧码归属
// ——否则重登扫旧码会走 activateCourse 本人幂等自愈把课拿回来（隐私政策「删除资料」承诺落空）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

beforeEach(() => control.reset())

const boom = (target: string) => ({ coll }: any) => {
  if (coll === target) throw new Error('MOCK_DB_FAIL')
}

const FAULTS: [string, () => void][] = [
  ['qrcodes 读失败', () => control.setBeforeGet(boom('qrcodes'))],
  ['qrcodes 改绑失败', () => control.setBeforeUpdate(boom('qrcodes'))],
  ['activations 删失败', () => control.setBeforeRemove(boom('activations'))],
  ['progress 删失败', () => control.setBeforeRemove(boom('progress'))],
  ['kfIdentity 删失败', () => control.setBeforeRemove(boom('kfIdentity'))],
]

describe('deleteAccount：报已删除 ⇒ 真删干净', () => {
  it.each(FAULTS)('%s：要么 INTERNAL，要么课权/进度/客服桥/旧码归属全摘净', async (_name, inject) => {
    control.setOpenId('oME')
    await call('login')
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', code: 'K1', enteredAt: 111, createdAt: 1 }])
    control.seed('progress', [{ _id: 'oME:c1', _openid: 'oME', courseId: 'c1', done: { s1: true } }])
    control.seed('kfIdentity', [{ _id: 'ext:eu1', openid: 'oME', unionid: 'u1' }])
    control.seed('qrcodes', [{ _id: 'K1', status: 'activated', courseId: 'c1', activatedBy: 'oME' }])
    inject()
    const r = await call('deleteAccount')
    if (!r.ok) return expect(r).toEqual({ ok: false, error: 'INTERNAL' })
    expect(r).toEqual({ ok: true, deleted: true })
    expect(control.dump('activations')).toEqual([])
    expect(control.dump('progress')).toEqual([])
    expect(control.dump('kfIdentity')).toEqual([])
    expect(control.dump('qrcodes')[0].activatedBy).toBe('deleted:oME')
  })
})
