// settleAllSaves：向导跳步/重载前要等所有共享槽位的在途保存落盘；任一失败要抛出来，不能当成已存好。
import { describe, it, expect } from 'vitest'
import { serialSave, settleAllSaves } from '../src/lib/serialSave'

const deferred = () => {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

describe('settleAllSaves', () => {
  it('空闲槽位不挡；等到所有在途保存都完成才返回', async () => {
    serialSave(async () => {}, 'settle-idle')
    await expect(settleAllSaves()).resolves.toBeUndefined()

    const a = deferred()
    const b = deferred()
    const ta = serialSave(() => a.promise, 'settle-a')
    const tb = serialSave(() => b.promise, 'settle-b')
    void ta()
    void tb()
    let done = false
    const all = settleAllSaves().then(() => (done = true))
    a.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false) // b 还在途
    b.resolve()
    await all
    expect(done).toBe(true)
  })

  it('任一在途保存失败 → settleAllSaves 拒绝（失败≠已落盘）', async () => {
    const c = deferred()
    const tc = serialSave(() => c.promise, 'settle-fail')
    tc().catch(() => {})
    const all = settleAllSaves()
    c.reject(new Error('SAVE_FAILED'))
    await expect(all).rejects.toThrow('SAVE_FAILED')
  })
})
