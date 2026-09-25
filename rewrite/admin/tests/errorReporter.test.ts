// 前端错误上报器行为测试（批 B7·治病根#14 client-error 通道 web 半边）：window.onerror/unhandledrejection 的
// 真实 DOM 事件挂接不在此测——vitest 'rw' project 是 environment:'node'，无 window 全局，installErrorReporter
// 里的 typeof window!=='undefined' 分支会被跳过；那部分目前无自动验证，
// 靠真机/浏览器人工核。
// 模块级 seen 状态需在每个 it 前 vi.resetModules() + 动态 import 取全新模块实例（同 rewrite/agent/tests/
// client.test.ts 已有先例，避免跨 it 状态串味）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  vi.spyOn(console, 'error').mockImplementation(() => {}) // errorHandler 必重打 console，测上报行为时不必听
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// reportError 已不对外 export：走外层 installErrorReporter 的 Vue errorHandler
type ReportCli = { hasSession: () => boolean; post: (action: string, data?: Record<string, unknown>) => Promise<unknown> }
async function attachHandler(cli: ReportCli) {
  const { installErrorReporter } = await import('../src/lib/errorReporter')
  const fakeApp = { config: {} } as unknown as import('vue').App
  installErrorReporter(fakeApp, cli)
  const handler = (fakeApp.config as unknown as { errorHandler: (e: unknown, i: unknown, info: string) => void }).errorHandler
  return (msg: unknown, info = 'test') => handler(msg, null, info)
}

describe('admin errorReporter（批 B7·治病根#14 client-error 通道）', () => {
  it('大白话：reportError 只给同文件 installErrorReporter 用，不再对外 export', async () => {
    expect(await import('../src/lib/errorReporter')).not.toHaveProperty('reportError')
  })
  it('大白话：无会话不外呼——不为上报建未鉴权端点', async () => {
    const cli = fakeClient(false)
    const fire = await attachHandler(cli)
    fire('出错了')
    await Promise.resolve()
    expect(cli.post).not.toHaveBeenCalled()
  })

  it('大白话：地址栏有 hash 时 page 记 hash，问号后面的查询串丢掉', async () => {
    vi.stubGlobal('location', { pathname: '/index.html', hash: '#/orders?openid=o1' })
    const cli = fakeClient(true)
    const fire = await attachHandler(cli)
    fire('订单页出错')
    await Promise.resolve()
    expect(cli.posted[0].data?.page).toBe('#/orders')
  })

  it('大白话：地址栏没有 hash 时 page 记 pathname', async () => {
    vi.stubGlobal('location', { pathname: '/desk', hash: '' })
    const cli = fakeClient(true)
    const fire = await attachHandler(cli)
    fire('坐席页出错')
    await Promise.resolve()
    expect(cli.posted[0].data?.page).toBe('/desk')
  })

  it('大白话：有会话时字段正确——action=reportClientError/source=admin/msg 截 500/page 走当前页', async () => {
    const cli = fakeClient(true)
    const fire = await attachHandler(cli)
    fire('x'.repeat(600))
    await Promise.resolve()
    expect(cli.posted.length).toBe(1)
    expect(cli.posted[0].action).toBe('reportClientError')
    expect(cli.posted[0].data?.source).toBe('admin')
    expect((cli.posted[0].data?.msg as string).length).toBe(500)
    expect(cli.posted[0].data?.page).toBe('') // node 无 location·currentPage 回空串
  })

  it('大白话：同一条消息反复调用只外呼一次（会话内去重）', async () => {
    const cli = fakeClient(true)
    const fire = await attachHandler(cli)
    fire('重复错误')
    fire('重复错误')
    fire('重复错误')
    await Promise.resolve()
    expect(cli.posted.length).toBe(1)
  })

  it('大白话：会话内封顶——循环 25 次不同消息，外呼次数恰为 20（MAX_REPORTS）', async () => {
    const cli = fakeClient(true)
    const fire = await attachHandler(cli)
    for (let i = 0; i < 25; i++) fire(`错误-${i}`)
    await Promise.resolve()
    expect(cli.posted.length).toBe(20)
  })

  it('大白话：post 返回 rejected Promise 时上报本身不抛、且不留下未处理的 rejection', async () => {
    const cli = {
      hasSession: () => true,
      post: vi.fn(() => Promise.reject(new Error('network fail'))),
    }
    const fire = await attachHandler(cli)
    expect(() => fire('网络失败错误')).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('大白话：installErrorReporter 接管 app.config.errorHandler 后调用即触发一次上报', async () => {
    const cli = fakeClient(true)
    const fire = await attachHandler(cli)
    fire(new Error('vue 内部错误'), 'render function')
    await Promise.resolve()
    expect(cli.posted.length).toBe(1)
  })
})
