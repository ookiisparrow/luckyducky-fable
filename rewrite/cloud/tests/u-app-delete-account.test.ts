// deleteAccount 失败≠已删除（根因#14）：任一步删/改失败，都不许回 deleted:true 却留着客服身份桥。
// 老板 2026-09-30（§39）：删除个人资料**不再**摘课程权限、学习进度与激活卡归属——付费买的课不因删资料而丢，
// 所以不管成败，课单、进度、激活卡归属都原样保留。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

beforeEach(() => control.reset())

const boom = (target: string) => ({ coll }: any) => {
  if (coll === target) throw new Error('MOCK_DB_FAIL')
}

const FAULTS: [string, () => void][] = [
  ['无故障', () => undefined],
  ['kfIdentity 删失败', () => control.setBeforeRemove(boom('kfIdentity'))],
  ['reviews 改匿名失败', () => control.setBeforeUpdate(boom('reviews'))],
]

describe('deleteAccount：报已删除 ⇒ 个人资料删净；课程/进度/激活卡归属始终保留', () => {
  it.each(FAULTS)('%s：要么 INTERNAL，要么客服桥摘净；课单、进度、激活卡归属都不动', async (_name, inject) => {
    control.setOpenId('oME')
    await call('login')
    control.seed('activations', [{ _id: 'A1', _openid: 'oME', courseId: 'c1', code: 'K1', enteredAt: 111, createdAt: 1 }])
    control.seed('progress', [{ _id: 'oME:c1', _openid: 'oME', courseId: 'c1', done: { s1: true } }])
    control.seed('kfIdentity', [{ _id: 'ext:eu1', openid: 'oME', unionid: 'u1' }])
    control.seed('qrcodes', [{ _id: 'K1', status: 'activated', courseId: 'c1', activatedBy: 'oME' }])
    control.seed('reviews', [{ _id: 'o1__l1', _openid: 'oME', productId: 'p1', name: '小鸭', rating: 5, text: '好看', tags: [], photos: [], createdAt: 2, picked: true }])
    inject()
    const r = await call('deleteAccount')
    expect(control.dump('activations')).toHaveLength(1)
    expect(control.dump('progress')).toHaveLength(1)
    expect(control.dump('qrcodes')[0].activatedBy).toBe('oME')
    if (!r.ok) return expect(r).toEqual({ ok: false, error: 'INTERNAL' })
    expect(r).toEqual({ ok: true, deleted: true })
    expect(control.dump('kfIdentity')).toEqual([])
  })
})
