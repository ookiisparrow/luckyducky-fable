// 坐席台前端错误上报器行为测试（批 B7·治病根#14 client-error 通道 web 半边·与 admin 版同构测试，唯一差异是
// 断言 source==='agent'）：window.onerror/unhandledrejection 的真实 DOM 事件挂接不在此测——同 admin 版头注，
// 交给 scripts/check-structure.mjs 的 rw-web-error-reporter-wired 源码扫描断言。模块级 seen/sent 状态需在
// 每个 it 前 vi.resetModules() + 动态 import 取全新模块实例（同本包已有的 tests/client.test.ts 先例）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

function fakeClient(hasSession = true) {
  const posted: Array<{ action: string; data?: Record<string, unknown> }> = []
  return {
    hasSession: () => hasSession,
    post: vi.fn((action: string, data?: Record<string, unknown>) => {
      posted.push({ action, data })
      return Promise.resolve({ ok: true })
    }),
    posted,
  }
}

beforeEach(() => {
  vi.resetModules()
})

describe('agent errorReporter（批 B7·治病根#14 client-error 通道）', () => {
  it('大白话：无会话不外呼——不为上报建未鉴权端点', async () => {
    const { reportError } = await import('../src/lib/errorReporter')
    const cli = fakeClient(false)
    reportError(cli, '出错了')
    await Promise.resolve()
    expect(cli.post).not.toHaveBeenCalled()
  })

  it('大白话：有会话时字段正确——action=reportClientError/source=agent/msg 截 500/page 透传', async () => {
    const { reportError } = await import('../src/lib/errorReporter')
    const cli = fakeClient(true)
    const longMsg = 'x'.repeat(600)
    reportError(cli, longMsg, '/desk')
    await Promise.resolve()
    expect(cli.posted.length).toBe(1)
    expect(cli.posted[0].action).toBe('reportClientError')
    expect(cli.posted[0].data?.source).toBe('agent')
    expect((cli.posted[0].data?.msg as string).length).toBe(500)
    expect(cli.posted[0].data?.page).toBe('/desk')
  })

  it('大白话：同一条消息反复调用只外呼一次（会话内去重）', async () => {
    const { reportError } = await import('../src/lib/errorReporter')
    const cli = fakeClient(true)
    reportError(cli, '重复错误')
    reportError(cli, '重复错误')
    reportError(cli, '重复错误')
    await Promise.resolve()
    expect(cli.posted.length).toBe(1)
  })

  it('大白话：会话内封顶——循环 25 次不同消息，外呼次数恰为 20（MAX_REPORTS）', async () => {
    const { reportError } = await import('../src/lib/errorReporter')
    const cli = fakeClient(true)
    for (let i = 0; i < 25; i++) reportError(cli, `错误-${i}`)
    await Promise.resolve()
    expect(cli.posted.length).toBe(20)
  })

  it('大白话：post 返回 rejected Promise 时 reportError 本身不抛、且不留下未处理的 rejection', async () => {
    const { reportError } = await import('../src/lib/errorReporter')
    const cli = {
      hasSession: () => true,
      post: vi.fn(() => Promise.reject(new Error('network fail'))),
    }
    expect(() => reportError(cli, '网络失败错误')).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('大白话：installErrorReporter 接管 app.config.errorHandler 后调用即触发一次上报', async () => {
    const { installErrorReporter } = await import('../src/lib/errorReporter')
    const cli = fakeClient(true)
    const fakeApp = { config: {} } as unknown as import('vue').App
    installErrorReporter(fakeApp, cli)
    expect(typeof (fakeApp.config as unknown as { errorHandler?: unknown }).errorHandler).toBe('function')
    ;(fakeApp.config as unknown as { errorHandler: (e: unknown, i: unknown, info: string) => void }).errorHandler(
      new Error('vue 内部错误'),
      null,
      'render function'
    )
    await Promise.resolve()
    expect(cli.posted.length).toBe(1)
  })
})
