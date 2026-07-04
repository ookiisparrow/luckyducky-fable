// 坐席台客户端（与 admin client 同构·独立包小副本：令牌键独立·支持企微 ?code= 免登）。
export interface ClientResult {
  ok: boolean
  status: number
  error?: string
  [k: string]: unknown
}

const TOKEN_KEY = 'ldrw_agent_token'
const ENDPOINT = import.meta.env.VITE_AGENT_API || ''

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
  if (!token) return { ok: false, status: 401, error: 'SESSION_LOST' }
  const r = await raw(action, token, data)
  if (r.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    return { ...r, ok: false, error: 'SESSION_LOST' }
  }
  return r
}
