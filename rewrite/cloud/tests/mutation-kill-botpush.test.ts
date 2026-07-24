// 变异测试幸存者击杀（kit/botpush.ts·企微群机器人单接缝·守卫 rw-bot-push-single-seam）。
// 背景：StrykerJS 注入变异后 80 个幸存/无覆盖，本文件补 A 类（真测试缺口）击杀，不与 botpush.test.ts 重复：
//   ① webhook 形态校验锚点（正则 ^/$ 任一被削都必须仍拒）+ BAD_WEBHOOK 错误码留痕；
//   ② 推送正文格式契约（企微 markdown 模板：图标/sev 中文标签/来源/代码/ctx 行——源码注释明示
//      sev→中文标签映射与「非告警换中性图标」是设计，整段 content 即输出契约，逐字锁）；
//   ③ 请求形状契约（POST + Content-Type: application/json + msgtype:markdown·对端是真实企微 API 形状）；
//   ④ fail-soft 铁律细化（抛的连 Error 都不是也绝不抛穿·PUSH_FAIL:/WX_ 错误码前缀留痕）；
//   ⑤ 无全局 fetch 的 node https 降级线（vi.mock('https') 内存桩锁代码侧逻辑；真实企微对端
//      联通/TLS 属根因#8 真机域，此处不冒充）。
// 期望值全部取自 botpush.ts 源码常量与注释，未发明行为。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { pushBotAlert } from '../src/kit/botpush'

// —— node https 内存桩（击杀 httpsFetch 降级线 L15-29 的无覆盖变异·不碰真实网络）——
// vi.mock 工厂被提升到 import 前，共享状态须走 vi.hoisted。
const h = vi.hoisted(() => ({
  responseBody: '{"errcode":0}',
  emitError: false,
  hang: false, // 对端悬挂：end() 后既不回包也不报错（分诊缺口③同族·验超时防线用）
  timeoutArms: [] as Array<{ ms: number; cb: () => void }>,
  calls: [] as Array<{ options: Record<string, unknown>; written: string }>,
}))
vi.mock('https', () => ({
  request: (options: Record<string, unknown>, onRes: (res: unknown) => void) => {
    const call = { options, written: '' }
    h.calls.push(call)
    const reqHandlers: Record<string, (...a: unknown[]) => void> = {}
    return {
      on(ev: string, cb: (...a: unknown[]) => void) {
        reqHandlers[ev] = cb
      },
      write(chunk: string) {
        call.written += chunk
      },
      setTimeout(ms: number, cb: () => void) {
        h.timeoutArms.push({ ms, cb })
      },
      destroy(e: Error) {
        if (reqHandlers['error']) reqHandlers['error'](e)
      },
      end() {
        queueMicrotask(() => {
          if (h.hang) return // 悬挂：不回包不报错，只有超时防线能救
          if (h.emitError) {
            if (reqHandlers['error']) reqHandlers['error'](new Error('sock boom'))
            return // 无 error handler（变异把事件名削掉）→ 悬挂 → 超时即击杀
          }
          const resHandlers: Record<string, Array<(...a: unknown[]) => void>> = {}
          onRes({
            on(ev: string, cb: (...a: unknown[]) => void) {
              ;(resHandlers[ev] = resHandlers[ev] || []).push(cb)
            },
          })
          queueMicrotask(() => {
            for (const cb of resHandlers['data'] || []) cb(h.responseBody)
            for (const cb of resHandlers['end'] || []) cb()
          })
        })
      },
    }
  },
}))

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-1234'

beforeEach(() => {
  control.reset()
  h.responseBody = '{"errcode":0}'
  h.emitError = false
  h.hang = false
  h.timeoutArms.length = 0
  h.calls.length = 0
})

// spy 版 fetchImpl：记录 url/init 并按需回包（同现有测试的手写 fake 风格）
function spyFetch(result: unknown = { errcode: 0 }) {
  const calls: Array<{ url: string; init: { method?: string; headers?: Record<string, string>; body?: string } }> = []
  const impl = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, init: init || {} })
    return { json: async () => result }
  }
  return { calls, impl }
}

describe('webhook 形态校验锚点（凭证形态·防误发外站·击杀 L35 正则削锚/L64 错误码）', () => {
  it('大白话：别站 URL 里内嵌合法尾巴（削 ^ 锚就会漏）→必须拒发、一个包不发、错误码 BAD_WEBHOOK', async () => {
    const { calls, impl } = spyFetch()
    const r = await pushBotAlert('https://evil.example.com/redirect?to=' + WEBHOOK, { sev: 'money', fn: 'x', code: 'y' }, impl)
    expect(r).toEqual({ ok: false, error: 'BAD_WEBHOOK' })
    expect(calls.length).toBe(0)
  })

  it('大白话：key 后面拖了外站尾巴（削 $ 锚就会漏）→必须拒发、一个包不发', async () => {
    const { calls, impl } = spyFetch()
    const r = await pushBotAlert(WEBHOOK + '&redirect=https://evil.example.com', { sev: 'money', fn: 'x', code: 'y' }, impl)
    expect(r).toEqual({ ok: false, error: 'BAD_WEBHOOK' })
    expect(calls.length).toBe(0)
  })

  it('大白话：webhook 为空串→拒发且错误码留痕是 BAD_WEBHOOK（不是裸 ok:false）', async () => {
    const { calls, impl } = spyFetch()
    expect(await pushBotAlert('', { sev: 'money', fn: 'x', code: 'y' }, impl)).toEqual({ ok: false, error: 'BAD_WEBHOOK' })
    expect(calls.length).toBe(0)
  })
})

describe('推送正文格式契约（企微 markdown 模板·sev→图标/中文标签映射·击杀 L39-44/65-69/73-74/76-78）', () => {
  it('大白话：money 告警→⚠️+钱链告警+来源/代码/ctx 行·POST+JSON 头·整包 msgtype:markdown 逐字不差', async () => {
    const { calls, impl } = spyFetch()
    const r = await pushBotAlert(
      WEBHOOK,
      { sev: 'money', fn: 'payCallback', code: 'FEE_MISMATCH', ctx: { orderId: 'o1', amountFen: 9900 } },
      impl,
    )
    expect(r).toEqual({ ok: true })
    expect(calls.length).toBe(1)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(calls[0].init.body || '')).toEqual({
      msgtype: 'markdown',
      markdown: {
        content: '**⚠️ Lucky Ducky · 钱链告警**\n> 来源: payCallback\n> 代码: FEE_MISMATCH\n> orderId: o1\n> amountFen: 9900',
      },
    })
  })

  it('大白话：无 ctx→正文到代码行为止、不多一个换行', async () => {
    const { calls, impl } = spyFetch()
    await pushBotAlert(WEBHOOK, { sev: 'security', fn: 'adminLogin', code: 'THROTTLED' }, impl)
    expect(JSON.parse(calls[0].init.body || '').markdown.content).toBe(
      '**⚠️ Lucky Ducky · 安全告警**\n> 来源: adminLogin\n> 代码: THROTTLED',
    )
  })

  it('大白话：recall=📋 主动召回清单·heartbeat=💓 巡检机心跳·anomaly=⚠️ 异常告警（非告警换中性图标是设计）', async () => {
    const { calls, impl } = spyFetch()
    await pushBotAlert(WEBHOOK, { sev: 'recall', fn: 'recall', code: 'RECALL_SUMMARY' }, impl)
    await pushBotAlert(WEBHOOK, { sev: 'heartbeat', fn: 'inspect', code: 'HEARTBEAT' }, impl)
    await pushBotAlert(WEBHOOK, { sev: 'anomaly', fn: 'inspect', code: 'DRIFT' }, impl)
    expect(JSON.parse(calls[0].init.body || '').markdown.content).toBe(
      '**📋 Lucky Ducky · 主动召回清单**\n> 来源: recall\n> 代码: RECALL_SUMMARY',
    )
    expect(JSON.parse(calls[1].init.body || '').markdown.content).toBe(
      '**💓 Lucky Ducky · 巡检机心跳**\n> 来源: inspect\n> 代码: HEARTBEAT',
    )
    expect(JSON.parse(calls[2].init.body || '').markdown.content).toBe(
      '**⚠️ Lucky Ducky · 异常告警**\n> 来源: inspect\n> 代码: DRIFT',
    )
  })

  it('大白话：ctx 某个键取值就炸（getter 抛错）→ctx 行整段放弃、正文其余照发（fail-soft 局部化·击杀 L71）', async () => {
    const { calls, impl } = spyFetch()
    const ctx = {} as Record<string, unknown>
    Object.defineProperty(ctx, 'bad', {
      enumerable: true,
      get() {
        throw new Error('boom')
      },
    })
    const r = await pushBotAlert(WEBHOOK, { sev: 'money', fn: 'pay', code: 'X', ctx }, impl)
    expect(r).toEqual({ ok: true })
    expect(JSON.parse(calls[0].init.body || '').markdown.content).toBe('**⚠️ Lucky Ducky · 钱链告警**\n> 来源: pay\n> 代码: X')
  })
})

describe('企微回包 errcode≠0（对端拒收要留痕·击杀 L81）', () => {
  it('大白话：回包 errcode=93000→ok:false 且错误码逐字是 WX_93000', async () => {
    const { impl } = spyFetch({ errcode: 93000 })
    expect(await pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' }, impl)).toEqual({ ok: false, error: 'WX_93000' })
  })
})

describe('fail-soft 铁律细化（推送失败绝不抛穿·错误码留痕·击杀 L84）', () => {
  it('大白话：fetch 抛 Error→ok:false 且错误码 PUSH_FAIL:带原话', async () => {
    const boom = async () => {
      throw new Error('net down')
    }
    await expect(pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' }, boom)).resolves.toEqual({
      ok: false,
      error: 'PUSH_FAIL:net down',
    })
  })

  it('大白话：抛出来的连 Error 都不是（null）→也绝不抛穿·兜底 PUSH_FAIL:unknown', async () => {
    const boomNull = () => Promise.reject(null) as Promise<{ json: () => Promise<unknown> }>
    await expect(pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' }, boomNull)).resolves.toEqual({
      ok: false,
      error: 'PUSH_FAIL:unknown',
    })
  })
})

describe('无全局 fetch 的 node https 降级线（内存桩·真实企微对端属根因#8 真机域·击杀 L15-32）', () => {
  it('大白话：没有全局 fetch→走 https.request·POST 到正确主机/路径/头、写出的就是 markdown 包·errcode=0 判成功', async () => {
    vi.stubGlobal('fetch', undefined)
    try {
      const r = await pushBotAlert(WEBHOOK, { sev: 'money', fn: 'pay', code: 'X', ctx: { id: 'o1' } })
      expect(r).toEqual({ ok: true })
      expect(h.calls.length).toBe(1)
      expect(h.calls[0].options.method).toBe('POST')
      expect(h.calls[0].options.hostname).toBe('qyapi.weixin.qq.com')
      expect(h.calls[0].options.path).toBe('/cgi-bin/webhook/send?key=abc-1234')
      expect(h.calls[0].options.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(h.calls[0].written)).toEqual({
        msgtype: 'markdown',
        markdown: { content: '**⚠️ Lucky Ducky · 钱链告警**\n> 来源: pay\n> 代码: X\n> id: o1' },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('大白话：降级线回包 errcode≠0→同样留痕 WX_ 码（不吞对端拒收）', async () => {
    vi.stubGlobal('fetch', undefined)
    h.responseBody = '{"errcode":45009}'
    try {
      await expect(pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' })).resolves.toEqual({ ok: false, error: 'WX_45009' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('大白话：socket 报错→error 事件 reject 被 fail-soft 兜住·PUSH_FAIL: 留痕不抛穿', async () => {
    vi.stubGlobal('fetch', undefined)
    h.emitError = true
    try {
      await expect(pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' })).resolves.toEqual({
        ok: false,
        error: 'PUSH_FAIL:sock boom',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

// —— 2026-07-24 变异分诊逮出的缺口②③修复锁定（fail-soft 只兜「不抛穿」，不兜「谎报成功/无限等」） ——
describe('pushBotAlert（假成功与悬挂缺口·修复锁定）', () => {
  it('大白话：对端回非 JSON（网关 502 吐 HTML 那种）→ ok:false BAD_RESP——没解析出确认就不能说送达了', async () => {
    const impl = (async () => ({
      json: async () => {
        throw new Error('not json')
      },
    })) as unknown as Parameters<typeof pushBotAlert>[2]
    expect(await pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' }, impl)).toEqual({
      ok: false,
      error: 'BAD_RESP',
    })
  })

  it('大白话：HTTP 状态 ≥400（fetch 不抛错的那种失败）→ ok:false HTTP_502，不谎报', async () => {
    const impl = (async () => ({ status: 502, json: async () => ({}) })) as unknown as Parameters<
      typeof pushBotAlert
    >[2]
    expect(await pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' }, impl)).toEqual({
      ok: false,
      error: 'HTTP_502',
    })
  })

  it('大白话：降级线对端悬挂（不回包不报错）→ 超时防线掐掉（10 秒）·PUSH_FAIL:TIMEOUT，不无限等', async () => {
    vi.stubGlobal('fetch', undefined)
    h.hang = true
    try {
      const p = pushBotAlert(WEBHOOK, { sev: 'money', fn: 'x', code: 'y' })
      await new Promise((r) => setTimeout(r, 0)) // 让请求走到挂起点
      expect(h.timeoutArms.length).toBe(1) // 超时防线必须已布防
      expect(h.timeoutArms[0].ms).toBe(10_000)
      h.timeoutArms[0].cb() // 模拟超时触发
      await expect(p).resolves.toEqual({ ok: false, error: 'PUSH_FAIL:TIMEOUT' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
