import { describe, it, expect } from 'vitest'
import { resolveSessionDeepLink } from '../../packages/agent/src/logic/deepLink.js'

// M⑦ 车道C·会话直达（推送卡片 ?session=<id> 点入）纯决策：open（已在我名下）/ claim（在待接队列）/ notfound / none。
const S = (id) => ({ sessionId: id, status: 'active' })

describe('resolveSessionDeepLink 会话直达决策', () => {
  it('已在我的在接 → open（直接打开·无需认领）', () => {
    const r = resolveSessionDeepLink('s1', { myActive: [S('s1'), S('s2')], queue: [] })
    expect(r.action).toBe('open')
    expect(r.session.sessionId).toBe('s1')
  })

  it('在待接队列（未认领）→ claim（先认领）', () => {
    const r = resolveSessionDeepLink('s3', { myActive: [], queue: [S('s3')] })
    expect(r).toEqual({ action: 'claim', sessionId: 's3' })
  })

  it('我的在接优先于队列（同 id 时不重复认领）', () => {
    const r = resolveSessionDeepLink('s1', { myActive: [S('s1')], queue: [S('s1')] })
    expect(r.action).toBe('open')
  })

  it('都不在 → notfound（已被他人接走/已结束/不可见）', () => {
    expect(resolveSessionDeepLink('ghost', { myActive: [S('s1')], queue: [S('s2')] }).action).toBe('notfound')
  })

  it('无目标 / 空入参 → none（不硬闯）', () => {
    expect(resolveSessionDeepLink('').action).toBe('none')
    expect(resolveSessionDeepLink(null).action).toBe('none')
    expect(resolveSessionDeepLink('x', {}).action).toBe('notfound')
  })
})
