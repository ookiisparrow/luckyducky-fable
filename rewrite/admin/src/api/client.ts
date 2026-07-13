// adminApi v2 客户端（钱链入口·行为测试钉·守卫 rw-admin-ui-in-gates）：
// 单 endpoint POST {action, key, data}；key=会话令牌（口令仅登录时用一次·令牌哈希在云端）；
// 401 会话失效 → 清令牌抛 SESSION_LOST（壳层导登录）；错误规整不吞（承接调试案 A 教训：报错带原文）。
export interface ClientResult {
  ok: boolean
  status: number
  error?: string
  [k: string]: unknown
}

export interface ClientDeps {
  endpoint: string
  fetchImpl?: typeof fetch
  storage?: { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }
}

const TOKEN_KEY = 'ldrw_admin_token'
const WHO_KEY = 'ldrw_admin_who' // 登录操作者名（Shell 显真实身份·换皮硬编码「管理员」·多账号无法辨认）

const defaultStorage = {
  get: (k: string) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
  set: (k: string, v: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v)
  },
  remove: (k: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k)
  },
}

export function createClient(deps: ClientDeps) {
  const storage = deps.storage || defaultStorage
  const doFetch = deps.fetchImpl || fetch
  // 会话失效集中回调（单源·根因#5 收口）：post 遇 401 清令牌后触发一次，壳层注册为「导登录」，
  // 各页不再各写各的 SESSION_LOST 跳转（曾漂成 3 种：卡死「加载中…」/裸显合成码/导登录）。
  let sessionLostHandler: (() => void) | null = null

  async function raw(action: string, key: string, data: Record<string, unknown>): Promise<ClientResult> {
    if (!deps.endpoint) return { ok: false, status: 0, error: 'NO_ENDPOINT' } // 未配后端·fail-closed 不假装
    let res: Response
    try {
      res = await doFetch(deps.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, key, data }),
      })
    } catch (e) {
      return { ok: false, status: 0, error: 'NETWORK:' + String(e instanceof Error ? e.message : e).slice(0, 120) } // 报错带原文·不吞
    }
    let body: Record<string, unknown> = {}
    try {
      body = (await res.json()) as Record<string, unknown>
    } catch {
      return { ok: false, status: res.status, error: 'BAD_JSON_RESPONSE' }
    }
    return { status: res.status, ...body, ok: body.ok === true } as ClientResult
  }

  return {
    token: () => storage.get(TOKEN_KEY) || '',
    hasSession: () => !!storage.get(TOKEN_KEY),
    who: () => storage.get(WHO_KEY) || '', // 当前登录操作者名（Shell 底部身份条）
    /** 注册会话失效回调（壳层调一次·如 () => router.push('/login')）——会话失效导登录的单一出口。 */
    onSessionLost: (fn: () => void) => {
      sessionLostHandler = fn
    },
    logout: () => {
      storage.remove(TOKEN_KEY)
      storage.remove(WHO_KEY)
    },

    /** 口令登录：成功存会话令牌（口令不落存储·用完即弃）+ 操作者名（显真实身份）。 */
    async login(password: string): Promise<ClientResult> {
      const r = await raw('login', password, {})
      const token = typeof r.sessionToken === 'string' ? r.sessionToken : ''
      if (r.ok && token) {
        storage.set(TOKEN_KEY, token) // 只存令牌·绝不存口令
        const op = typeof r.operator === 'string' ? r.operator : ''
        if (op) storage.set(WHO_KEY, op)
      }
      if (r.ok && !token) return { ...r, ok: false, error: 'NO_SESSION_TOKEN' } // 云端没发令牌不算登成（fail-closed）
      return r
    },

    /** 业务调用：带会话令牌；401 = 会话失效 → 清令牌·统一 SESSION_LOST（壳层导登录）。 */
    async post(action: string, data: Record<string, unknown> = {}): Promise<ClientResult> {
      const token = storage.get(TOKEN_KEY) || ''
      if (!token) {
        if (sessionLostHandler) sessionLostHandler() // 无令牌调业务＝会话已丢·集中导登录
        return { ok: false, status: 401, error: 'SESSION_LOST' }
      }
      const r = await raw(action, token, data)
      if (r.status === 401) {
        storage.remove(TOKEN_KEY)
        if (sessionLostHandler) sessionLostHandler() // 401＝会话失效·清令牌后集中导登录（单源·各页不再各跳）
        return { ...r, ok: false, error: 'SESSION_LOST' }
      }
      return r
    },
  }
}
