// 隐私授权闸 + 数据共享提示态黄金语义（守卫 rw-mp-privacy-golden·承旧线 privacyGate.test 语义）。
// 钉住的不变量：resolve 只回一次（同意后再拒不重复回调）；agree 带能力按钮 id；disagree 中止；
// 退订即止（泄漏纪律）；register 缺 API 安全空转；consent 提示回灌只认 boolean（storage 不可信）。
import { describe, it, expect, vi } from 'vitest'
import { createPrivacyGate, type PrivacyResolve } from '../lib/privacyGate'
import { sanitizeConsentHint, consentLabel } from '../lib/consent'

describe('privacyGate 授权链', () => {
  it('register 挂上 onNeedPrivacyAuthorization，触发即开弹窗', () => {
    const gate = createPrivacyGate()
    let hook: ((resolve: PrivacyResolve) => void) | null = null
    gate.register({ onNeedPrivacyAuthorization: (cb) => (hook = cb) })
    expect(hook).toBeTruthy()
    const seen: boolean[] = []
    gate.subscribe((v) => seen.push(v))
    hook!(vi.fn())
    expect(gate.visible()).toBe(true)
    expect(seen).toEqual([true])
  })

  it('agree 回 {buttonId, event:agree} 并关弹窗——放行本次接口', () => {
    const gate = createPrivacyGate()
    const resolve = vi.fn()
    gate.open(resolve)
    gate.agree('privacy-agree-btn')
    expect(resolve).toHaveBeenCalledWith({ buttonId: 'privacy-agree-btn', event: 'agree' })
    expect(gate.visible()).toBe(false)
  })

  it('disagree 回 {event:disagree}——中止本次接口', () => {
    const gate = createPrivacyGate()
    const resolve = vi.fn()
    gate.open(resolve)
    gate.disagree()
    expect(resolve).toHaveBeenCalledWith({ event: 'disagree' })
  })

  it('resolve 只回一次：同意后再拒绝不再回调（重复回调=微信侧行为未定义）', () => {
    const gate = createPrivacyGate()
    const resolve = vi.fn()
    gate.open(resolve)
    gate.agree()
    gate.disagree()
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('open 收到非函数 resolve 不崩，agree 安全空转', () => {
    const gate = createPrivacyGate()
    gate.open(undefined)
    expect(() => gate.agree()).not.toThrow()
  })

  it('退订即止：detached 后不再收可见态广播（泄漏纪律）', () => {
    const gate = createPrivacyGate()
    const seen: boolean[] = []
    const unsub = gate.subscribe((v) => seen.push(v))
    gate.open(vi.fn())
    unsub()
    gate.disagree()
    expect(seen).toEqual([true])
  })

  it('register 遇缺 API 环境（测试/旧基础库）安全空转', () => {
    const gate = createPrivacyGate()
    expect(() => gate.register(undefined)).not.toThrow()
    expect(() => gate.register({})).not.toThrow()
  })
})

describe('consent 提示态（本地只提示·服务端为真值）', () => {
  it('回灌只认 boolean：脏数据一律回 null=未知（storage 不可信）', () => {
    expect(sanitizeConsentHint(true)).toBe(true)
    expect(sanitizeConsentHint(false)).toBe(false)
    expect(sanitizeConsentHint('yes')).toBeNull()
    expect(sanitizeConsentHint(1)).toBeNull()
    expect(sanitizeConsentHint(undefined)).toBeNull()
    expect(sanitizeConsentHint({ agreed: true })).toBeNull()
  })

  it('三态文案：同意/撤回/未选各有其词，未知不冒充已选', () => {
    expect(consentLabel(true)).toContain('已同意')
    expect(consentLabel(false)).toContain('已撤回')
    expect(consentLabel(null)).toContain('尚未选择')
  })
})
