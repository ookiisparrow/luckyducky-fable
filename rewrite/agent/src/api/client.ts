// 坐席台客户端（与 admin client 同构·独立包小副本：令牌键独立·支持企微 ?code= 免登）。
export interface ClientResult {
  ok: boolean
  status: number
  error?: string
  [k: string]: unknown
}

const TOKEN_KEY = 'ldrw_agent_token'
const ENDPOINT = import.meta.env.VITE_AGENT_API || ''

// 会话失效集中回调（单源·根因#5 收口·对照 admin client.ts 同构移植）：post 遇无令牌/401 清令牌后触发一次，
// 壳层（App.vue）注册为「登出并回登录视图」，各调用点不再各写各的 SESSION_LOST 跳转（同 admin 病史：
// 曾漂成 3 种——卡死「加载中…」/裸显合成码/导登录）。login/loginByWecomCode 不触发（登录页自己处理错误）。
let sessionLostHandler: (() => void) | null = null
/** 注册会话失效回调（壳层调一次·如 () => { logout(); authed.value = false }）——会话失效导登录的单一出口。 */
export const onSessionLost = (fn: () => void) => {
  sessionLostHandler = fn
}

async function raw(action: string, key: string, data: Record<string, unknown>): Promise<ClientResult> {
  if (!ENDPOINT) return { ok: false, status: 0, error: 'NO_ENDPOINT' }
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, key, data }),
    })
  } catch (e) {
    return { ok: false, status: 0, error: 'NETWORK:' + String(e instanceof Error ? e.message : e).slice(0, 120) }
  }
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, status: res.status, error: 'BAD_JSON_RESPONSE' }
  }
  return { status: res.status, ...body, ok: body.ok === true } as ClientResult
}

export const hasSession = () => !!localStorage.getItem(TOKEN_KEY)
export const logout = () => localStorage.removeItem(TOKEN_KEY)

export async function login(password: string): Promise<ClientResult> {
  const r = await raw('login', password, {})
  const token = typeof r.sessionToken === 'string' ? r.sessionToken : ''
  if (r.ok && token) localStorage.setItem(TOKEN_KEY, token)
  if (r.ok && !token) return { ...r, ok: false, error: 'NO_SESSION_TOKEN' }
  return r
}

/** 企微免登（URL ?code=·pre-auth）：换会话令牌。 */
export async function loginByWecomCode(code: string): Promise<ClientResult> {
  const r = await raw('loginByWecomCode', '', { code })
  const token = typeof r.sessionToken === 'string' ? r.sessionToken : ''
  if (r.ok && token) localStorage.setItem(TOKEN_KEY, token)
  if (r.ok && !token) return { ...r, ok: false, error: 'NO_SESSION_TOKEN' }
  return r
}

export async function post(action: string, data: Record<string, unknown> = {}): Promise<ClientResult> {
  const token = localStorage.getItem(TOKEN_KEY) || ''
  if (!token) {
    sessionLostHandler?.() // 无令牌调业务＝会话已丢·集中导登录
    return { ok: false, status: 401, error: 'SESSION_LOST' }
  }
  const r = await raw(action, token, data)
  if (r.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    sessionLostHandler?.() // 401＝会话失效·清令牌后集中导登录（单源·各调用点不再各跳）
    return { ...r, ok: false, error: 'SESSION_LOST' }
  }
  return r
}
