// 变异测试幸存者击杀·第二轮（kit/observe.ts·观测/告警单出口·守卫 rw-flow-observable）。
// 背景：StrykerJS 基线 43 个幸存（变异分 50.6%·无 NoCoverage）。为何原有测试没杀掉：
//   anomaly.test.ts 只验 notifyAlert→recordAnomaly 桥的 code/severity/count，从未断言 kind 映射
//   （SEV_TO_KIND 整表可清空）、从未数 [LD_ALERT] 行数（alertOnHigh:false 防双告警可翻真）、
//   从未碰 ③ 推送半边（webhook 配置读取/逐事件静音/推送 payload）；notifyRecall/notifyHeartbeat 零测试。
// 本文件补 A 类（真测试缺口）击杀，期望值全部取自 observe.ts 源码常量与注释，未发明行为：
//   ① SEV_TO_KIND 映射逐条锁（money→flow-failure / security→server-exception / anomaly→invariant-violation·
//      源码 L26-30 注释明示桥接落 bug 账本的来源分类）；
//   ② alertOnHigh:false 防递归防双日志（源码 L35 注释「本函数已 alert 过、recordAnomaly 不再重复推告警」——
//      一次 notifyAlert 恰好一行 [LD_ALERT]，翻成 true/{} 就是两行）；
//   ③ 推送接缝契约（vi.mock botpush 单接缝：未配 webhook 不发、alertEvents[code]=false 逐事件静音、
//      payload {sev,fn,code,ctx} 逐字段锁）；
//   ④ [LD_RECALL]/[LD_HEARTBEAT] 结构化日志行形状（控制台按关键字配日志告警——前缀即格式契约，算 A 不算修饰）；
//   ⑤ 心跳 red>0 分档（红/绿两条文案 + HEARTBEAT_RED/GREEN 码 + green/red 数字真透传·源码 L91-93/L104）；
//   ⑥ fail-soft 铁律（推送抛错/summary 为 null 一律不反噬·源码「绝不抛错」注释）。
// C 类不立（等价变异杀不动）：L48/L71/L101 的 `.catch(() => null)`→`() => undefined`——
//   下游 `(got && got.data) || {}` 对 null/undefined 同判 falsy，行为逐位相同，等价变异。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { notifyAlert, notifyRecall, notifyHeartbeat } from '../src/kit/observe'
import { COLLECTIONS } from '@ldrw/shared'

// —— botpush 单接缝内存桩（观测批5：observe→pushBotAlert 是唯一推送出口·mock 它即锁 observe 侧全部推送语义）——
// vi.mock 工厂被提升到 import 前，共享状态须走 vi.hoisted（同 mutation-kill-botpush.test.ts 范式）。
const bp = vi.hoisted(() => ({
  calls: [] as Array<{ webhook: string; alert: Record<string, unknown> }>,
  throwOnPush: false,
}))
vi.mock('../src/kit/botpush', () => ({
  pushBotAlert: async (webhook: string, a: Record<string, unknown>) => {
    bp.calls.push({ webhook, alert: JSON.parse(JSON.stringify(a)) })
    if (bp.throwOnPush) throw new Error('push boom')
    return { ok: true }
  },
}))

// 捕获 console.error 结构化行（同 anomaly.test.ts 的 captureAlerts 风格·多取一层数组便于数行数）
async function captureLines(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  try {
    await fn()
  } finally {
    console.error = orig
  }
  return seen
}

// 形态合法的企微 webhook（botpush 已 mock·但配置值保持真实形状，不喂假样本）
const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key-1234'

function seedSettings(extra: Record<string, unknown> = {}) {
  control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', alertWebhook: WEBHOOK, ...extra }])
}

beforeEach(() => {
  control.reset()
  bp.calls.length = 0
  bp.throwOnPush = false
})

describe('SEV_TO_KIND 桥接映射（告警严重度→异常来源分类·落 bug 账本用·击杀 L26-29）', () => {
  it('大白话：money 告警落账本 kind 必须是 flow-failure（钱链动作失败分类·映射表清空/改串必露）', async () => {
    await captureLines(() => notifyAlert('money', 'payCallback', 'UNKNOWN_ORDER', { id: 'o1' }))
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0].kind).toBe('flow-failure')
  })

  it('大白话：security 告警落账本 kind 必须是 server-exception（安全/验签/探针分类）', async () => {
    await captureLines(() => notifyAlert('security', 'kfHealthProbe', 'KF_TOKEN_FAILED', {}))
    expect(control.dump(COLLECTIONS.anomalies)[0].kind).toBe('server-exception')
  })

  it('大白话：anomaly 告警落账本 kind 必须是 invariant-violation（兜底分类）', async () => {
    await captureLines(() => notifyAlert('anomaly', 'inspect', 'DRIFT', {}))
    expect(control.dump(COLLECTIONS.anomalies)[0].kind).toBe('invariant-violation')
  })
})

describe('alertOnHigh:false 防双告警防递归（本函数已 alert 过·recordAnomaly 不再重复推·击杀 L41）', () => {
  it('大白话：一次 notifyAlert 恰好打一行 [LD_ALERT]（翻成 true/{} 默认值→高危首见会再推一行=双日志）', async () => {
    const lines = await captureLines(() => notifyAlert('money', 'pay', 'FEE_MISMATCH', { fp: 'o1' }))
    expect(lines.filter((s) => s.includes('[LD_ALERT]')).length).toBe(1)
    // 且这一行是 notifyAlert 自己的（sev=money），不是 recordAnomaly 的高危补发（sev=anomaly）
    expect(lines[0]).toBe('[LD_ALERT] sev=money fn=pay code=FEE_MISMATCH ctx={"fp":"o1"}')
  })
})

describe('notifyAlert 推送接缝契约（adminConfig/settings.alertWebhook·击杀 L50/L51/L52）', () => {
  it('大白话：没配 webhook（连 settings 档都没有）→一个包不推（if(false) 化会把 undefined 当 webhook 硬发）', async () => {
    await captureLines(() => notifyAlert('money', 'pay', 'X', {}))
    expect(bp.calls.length).toBe(0)
  })

  it('大白话：settings 在但没 alertWebhook 字段→同样不推', async () => {
    control.seed(COLLECTIONS.adminConfig, [{ _id: 'settings', theme: 'x' }])
    await captureLines(() => notifyAlert('money', 'pay', 'X', {}))
    expect(bp.calls.length).toBe(0)
  })

  it('大白话：配了 webhook→推送 payload {sev,fn,code,ctx} 逐字段不差、webhook 原样透传（击杀 payload 清空）', async () => {
    seedSettings()
    await captureLines(() => notifyAlert('money', 'payCallback', 'PAY_FAIL', { orderId: 'o1' }))
    expect(bp.calls.length).toBe(1)
    expect(bp.calls[0].webhook).toBe(WEBHOOK)
    expect(bp.calls[0].alert).toEqual({ sev: 'money', fn: 'payCallback', code: 'PAY_FAIL', ctx: { orderId: 'o1' } })
  })

  it('大白话：alertEvents 里别的事件静音≠我这条静音（`&& true` 化会一刀切全静音）', async () => {
    seedSettings({ alertEvents: { OTHER_CODE: false } })
    await captureLines(() => notifyAlert('money', 'pay', 'PAY_FAIL', {}))
    expect(bp.calls.length).toBe(1)
  })

  it('大白话：alertEvents[code]=false 本事件静音→不推（逐事件静音是设计·源码 L46 注释）', async () => {
    seedSettings({ alertEvents: { PAY_FAIL: false } })
    await captureLines(() => notifyAlert('money', 'pay', 'PAY_FAIL', {}))
    expect(bp.calls.length).toBe(0)
  })

  it('大白话：推送接缝抛错→notifyAlert 照样正常返回（fail-soft 铁律·可观测性不反噬主流程）', async () => {
    seedSettings()
    bp.throwOnPush = true
    await expect(captureLines(() => notifyAlert('money', 'pay', 'X', {}))).resolves.toBeDefined()
  })
})

describe('notifyRecall（召回汇总·[LD_RECALL] 结构化行 + 推送半边·击杀 L64/L65/L73/L74）', () => {
  it('大白话：[LD_RECALL] 行逐字不差（前缀+JSON 汇总·控制台按关键字配日志告警的格式契约）', async () => {
    const lines = await captureLines(() => notifyRecall({ recovered: 2, pending: 1 }))
    expect(lines).toContain('[LD_RECALL] {"recovered":2,"pending":1}')
  })

  it('大白话：没配 webhook→只打日志、一个包不推', async () => {
    await captureLines(() => notifyRecall({ recovered: 2 }))
    expect(bp.calls.length).toBe(0)
  })

  it('大白话：配了 webhook→sev 必须是 recall（中性图标语义）、fn=recallScan、code=RECALL_SUMMARY、ctx=汇总原样', async () => {
    seedSettings()
    await captureLines(() => notifyRecall({ recovered: 2, pending: 1 }))
    expect(bp.calls.length).toBe(1)
    expect(bp.calls[0].alert).toEqual({ sev: 'recall', fn: 'recallScan', code: 'RECALL_SUMMARY', ctx: { recovered: 2, pending: 1 } })
  })

  it('大白话：召回非异常·绝不落 anomalies 账本（源码明示「不接 recordAnomaly·不污染账本」）', async () => {
    seedSettings()
    await captureLines(() => notifyRecall({ recovered: 2 }))
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })

  it('大白话：推送抛错→notifyRecall 照样正常返回（fail-soft）', async () => {
    seedSettings()
    bp.throwOnPush = true
    await expect(captureLines(() => notifyRecall({ recovered: 1 }))).resolves.toBeDefined()
  })
})

describe('notifyHeartbeat（巡检机每日心跳·红/绿分档文案+码+计数透传·击杀 L88-94/L103/L104）', () => {
  it('大白话：全绿→绿文案逐字不差（green 数字真透传·非写死 0/1）、code=HEARTBEAT_GREEN、ctx 计数原样', async () => {
    seedSettings()
    const lines = await captureLines(() => notifyHeartbeat({ green: 7, red: 0 }))
    expect(lines).toContain('[LD_HEARTBEAT] 巡检机存活·今日体检全绿 green=7')
    expect(bp.calls.length).toBe(1)
    expect(bp.calls[0].alert).toEqual({ sev: 'heartbeat', fn: 'inspect', code: 'HEARTBEAT_GREEN', ctx: { green: 7, red: 0 } })
  })

  it('大白话：red>0→红文案逐字不差（red 照发心跳但明示「红项另有告警通道」）、code=HEARTBEAT_RED', async () => {
    seedSettings()
    const lines = await captureLines(() => notifyHeartbeat({ green: 5, red: 2 }))
    expect(lines).toContain('[LD_HEARTBEAT] 巡检机存活·今日体检 green=5 red=2（红项另有告警通道）')
    expect(bp.calls.length).toBe(1)
    expect(bp.calls[0].alert).toEqual({ sev: 'heartbeat', fn: 'inspect', code: 'HEARTBEAT_RED', ctx: { green: 5, red: 2 } })
  })

  it('大白话：summary 为 null（运行期防御·`?.` 是设计）→绝不抛、按 0 计全绿（削掉 ?. 就当场炸）', async () => {
    const lines: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => {
      lines.push(String(a[0]))
    }
    try {
      await expect(notifyHeartbeat(null as unknown as { green: number; red: number })).resolves.toBeUndefined()
    } finally {
      console.error = orig
    }
    expect(lines).toContain('[LD_HEARTBEAT] 巡检机存活·今日体检全绿 green=0')
  })

  it('大白话：没配 webhook→只打日志、一个包不推', async () => {
    await captureLines(() => notifyHeartbeat({ green: 3, red: 0 }))
    expect(bp.calls.length).toBe(0)
  })

  it('大白话：心跳非异常·绝不落 anomalies 账本（源码明示「不接 recordAnomaly」）+ 推送抛错不反噬（fail-soft）', async () => {
    seedSettings()
    bp.throwOnPush = true
    await expect(captureLines(() => notifyHeartbeat({ green: 1, red: 1 }))).resolves.toBeDefined()
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(0)
  })
})
