import { request } from 'https'

// 企业微信群机器人告警推送（债#23续·根因#13 钱链可观测落地）。
// [LD_ALERT] 原只打结构化日志（控制台配日志告警·靠人外部步骤）；本接缝把钱链/安全告警「代码侧直推」
// 群机器人，owner 手机实时收。**单一收口（根因#12 接缝单点）**：全库仅本文件 POST 群机器人；业务码不
// 直调本文件，一律经 kit/observe 的 notifyAlert（守卫 bot-push-single-seam 机器锁）。
// **fail-soft 铁律**：推送/网络/配置任何失败绝不抛错——可观测性不能反噬主流程（钱链回调照常 ACK）。
// 安全（CLAUDE §7）：webhook URL 是凭证、不进日志；ctx 只放非敏感标识（沿用 observe 约束）。

export type BotFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ json: () => Promise<any> }>

const httpsFetch: BotFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request(
      {
        method: init?.method || 'GET',
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: init?.headers,
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ json: async () => JSON.parse(body || '{}') }))
      }
    )
    req.on('error', reject)
    if (init?.body) req.write(init.body)
    req.end()
  })

const defaultFetch: BotFetch = (url, init) =>
  typeof (globalThis as any).fetch === 'function' ? (globalThis as any).fetch(url, init) : httpsFetch(url, init)

// 企微群机器人 webhook 形态校验（凭证 key 在 query·非此形态直接拒，不发）。
const WEBHOOK_RE = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/

const SEV_LABEL: Record<string, string> = { money: '钱链告警', security: '安全告警' }

export interface BotAlert {
  sev: 'money' | 'security'
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
  fetchImpl: BotFetch = defaultFetch
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
    const content = `**⚠️ Lucky Ducky · ${SEV_LABEL[a.sev] || a.sev}**\n> 来源: ${a.fn}\n> 代码: ${a.code}${ctxLine}`
    const r = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
    })
    const j = await r.json().catch(() => ({}))
    if (j && j.errcode) return { ok: false, error: 'WX_' + j.errcode }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: 'PUSH_FAIL:' + (e?.message || 'unknown') }
  }
}
