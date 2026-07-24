import { request } from 'https'

// 企业微信群机器人告警推送（观测批5·根因#13 钱链可观测落地·移植旧线 kit/botpush.ts）。
// [LD_ALERT] 原只打结构化日志（控制台配日志告警·靠人外部步骤）；本接缝把钱链/安全/异常告警「代码侧直推」
// 群机器人，owner 手机实时收。**单一收口（根因#12 接缝单点·守卫 rw-bot-push-single-seam）**：全库仅本文件
// POST 群机器人；业务码不直调，一律经 kit/observe 的 notifyAlert。
// **fail-soft 铁律**：推送/网络/配置任何失败绝不抛错——可观测性不能反噬主流程（钱链回调照常 ACK）。
// 安全（CLAUDE §7）：webhook URL 是凭证、不进日志；ctx 只放非敏感标识（沿用 observe 约束）。

export type BotFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ json: () => Promise<any>; status?: number }> // status：全局 fetch 天然带；httpsFetch 补 statusCode（可选·旧注入 mock 不带也兼容）

const httpsFetch: BotFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request(
      { method: init?.method || 'GET', hostname: u.hostname, path: u.pathname + u.search, headers: init?.headers },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(body || '{}') }))
      },
    )
    // 对端悬挂不无限等（2026-07-24 变异分诊缺口③同族）：告警推送小包，10 秒不回即掐——destroy 触发 error → reject → fail-soft 兜住。
    req.setTimeout(10_000, () => req.destroy(new Error('TIMEOUT')))
    req.on('error', reject)
    if (init?.body) req.write(init.body)
    req.end()
  })

const defaultFetch: BotFetch = (url, init) =>
  typeof (globalThis as any).fetch === 'function' ? (globalThis as any).fetch(url, init) : httpsFetch(url, init)

// 企微群机器人 webhook 形态校验（凭证 key 在 query·非此形态直接拒，不发·防误发外站）。
const WEBHOOK_RE = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/

// sev→中文标签；anomaly=巡检/采集异常（本线新增·recordAnomaly 直发不经此·仅类型完备兜底）；
// recall=运营召回摘要（非告警）；heartbeat=巡检机每日心跳「报平安」（非告警·观测批 A5·经 notifyHeartbeat 发）。
const SEV_LABEL: Record<string, string> = {
  money: '钱链告警',
  security: '安全告警',
  anomaly: '异常告警',
  recall: '主动召回清单',
  heartbeat: '巡检机心跳',
}

export interface BotAlert {
  sev: 'money' | 'security' | 'anomaly' | 'recall' | 'heartbeat'
  fn: string
  code: string
  ctx?: Record<string, unknown>
}

/**
 * 推一条企微群机器人 markdown 告警；**fail-soft——绝不抛错**（推送失败不反噬主流程）。
 * @returns { ok, error? } 仅供调用方留痕，调用方亦不应因 ok:false 改变业务结果。
 */
export async function pushBotAlert(
  webhookUrl: string,
  a: BotAlert,
  fetchImpl: BotFetch = defaultFetch,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!WEBHOOK_RE.test(String(webhookUrl || ''))) return { ok: false, error: 'BAD_WEBHOOK' }
    let ctxLine = ''
    try {
      const ctx = a.ctx || {}
      const keys = Object.keys(ctx)
      if (keys.length) ctxLine = '\n' + keys.map((k) => `> ${k}: ${ctx[k]}`).join('\n')
    } catch {
      ctxLine = ''
    }
    const icon = a.sev === 'recall' ? '📋' : a.sev === 'heartbeat' ? '💓' : '⚠️' // 召回=运营摘要·心跳=报平安·非告警换中性图标
    const content = `**${icon} Lucky Ducky · ${SEV_LABEL[a.sev] || a.sev}**\n> 来源: ${a.fn}\n> 代码: ${a.code}${ctxLine}`
    const r = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
    })
    // 2026-07-24 变异分诊缺口②：HTTP ≥400 或回包非 JSON（如网关 502 吐 HTML）都不算送达——
    // fail-soft 只要求不抛穿，不要求把「没确认」谎报成 ok:true（调用方留痕语义要真）。
    if (r && r.status != null && r.status >= 400) return { ok: false, error: 'HTTP_' + r.status }
    const j = await r.json().catch(() => null)
    if (!j) return { ok: false, error: 'BAD_RESP' }
    if (j.errcode) return { ok: false, error: 'WX_' + j.errcode }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: 'PUSH_FAIL:' + (e?.message || 'unknown') }
  }
}
