// adminApi v2 客户端（钱链入口·行为测试 tests/client.test.ts 钉）：
// 单 endpoint POST {action, key, data}；key=会话令牌（口令仅登录时用一次·令牌哈希在云端）；
// 401 会话失效 → 清令牌抛 SESSION_LOST（壳层导登录）；错误规整不吞（报错带原文，排障不靠猜）。
export interface ClientResult {
  ok: boolean
  status: number
  error?: string
  [k: string]: unknown
}

/** 按契约类型看的回包：成功带 T 的字段（没有索引签名，字段名写错编译不过）；失败只有 error，外加云端随某些错误码带回的 F（可能不带）。 */
export type TypedResult<T, F = {}> = ({ ok: true; status: number; error?: undefined } & T) | ({ ok: false; status: number; error?: string } & Partial<F>)

export interface ClientDeps {
  endpoint: string
  fetchImpl?: typeof fetch
  storage?: { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }
}

/** 须长于 adminApi 函数超时（以 cloudbaserc.json adminApi.timeout 为准）：短于它，慢但仍在执行的写（批量发货/生成二维码）会被前端先判失败、诱发重复提交。 */
export const CALL_TIMEOUT_MS = 35_000

const TOKEN_KEY = 'ldrw_admin_token'
const WHO_KEY = 'ldrw_admin_who' // 登录操作者名（Shell 显真实身份：写死「管理员」的话多账号无法辨认）

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
  // 各页不各写各的 SESSION_LOST 跳转（各写会漂成卡死「加载中…」/裸显合成码/导登录多种表现）。
  let sessionLostHandler: (() => void) | null = null
  // 失效令牌只试一次（2026-09-28 真事故）：云端把每个带失效令牌的请求都记一次认证失败，每 IP 5 次锁 5 分钟；
  // 看板一打开并发 5 个请求，令牌失效时一次打开就锁死本机。故令牌没被云端认过（verifiedToken）之前，
  // 并发请求排在第一个（probe）后面；它回 401 → 令牌已清，排队的直接判 SESSION_LOST、不再打云端。
  // 断网/超时（status 0）没拿到云端答复，不算认过。
  let verifiedToken = ''
  let probe: Promise<unknown> | null = null

  async function raw(action: string, key: string, data: Record<string, unknown>): Promise<ClientResult> {
    if (!deps.endpoint) return { ok: false, status: 0, error: 'NO_ENDPOINT' } // 未配后端·fail-closed 不假装
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS)
    let res: Response
    let body: unknown
    try {
      res = await doFetch(deps.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, key, data }),
        signal: ctrl.signal,
      })
    } catch (e) {
      clearTimeout(timer)
      if (ctrl.signal.aborted) return { ok: false, status: 0, error: 'CALL_TIMEOUT' }
      return { ok: false, status: 0, error: 'NETWORK:' + String(e instanceof Error ? e.message : e).slice(0, 120) } // 报错带原文·不吞
    }
    try {
      body = await res.json() // 读回包体也可能挂死，计时器要罩到这里
    } catch {
      return { ok: false, status: res.status, error: ctrl.signal.aborted ? 'CALL_TIMEOUT' : 'BAD_JSON_RESPONSE' }
    } finally {
      clearTimeout(timer)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: res.status, error: 'BAD_JSON_RESPONSE' }
    return { status: res.status, ...body, ok: (body as { ok?: unknown }).ok === true } as ClientResult
  }

  return {
    hasSession: () => !!storage.get(TOKEN_KEY),
    who: () => storage.get(WHO_KEY) || '', // 当前登录操作者名（Shell 底部身份条）
    /** 注册会话失效回调（壳层调一次·如 () => router.push('/login')）——会话失效导登录的单一出口。 */
    onSessionLost: (fn: () => void) => {
      sessionLostHandler = fn
    },
    /** 登出：先清本地再吊销服务端令牌（best-effort）。先清是为了网络挂死时人也立刻登出，
     *  而不是卡到超时；吊销失败只剩令牌自然过期，不影响本地登出。 */
    async logout(): Promise<void> {
      const token = storage.get(TOKEN_KEY) || ''
      storage.remove(TOKEN_KEY)
      storage.remove(WHO_KEY)
      if (token) await raw('logout', token, {})
    },

    /** 口令登录：成功存会话令牌（口令不落存储·用完即弃）+ 操作者名（显真实身份）。 */
    async login(password: string): Promise<ClientResult> {
      const r = await raw('login', password, {})
      const token = typeof r.sessionToken === 'string' ? r.sessionToken : ''
      if (r.ok && token) {
        storage.set(TOKEN_KEY, token) // 只存令牌·绝不存口令
        verifiedToken = token // 刚签发的令牌不必再试
        const op = typeof r.operator === 'string' ? r.operator : ''
        if (op) storage.set(WHO_KEY, op)
      }
      if (r.ok && !token) return { ...r, ok: false, error: 'NO_SESSION_TOKEN' } // 云端没发令牌不算登成（fail-closed）
      return r
    },

    /** 业务调用：带会话令牌；401 = 会话失效 → 清令牌·统一 SESSION_LOST（壳层导登录）。 */
    async post(action: string, data: Record<string, unknown> = {}): Promise<ClientResult> {
      let token = storage.get(TOKEN_KEY) || ''
      while (token && token !== verifiedToken && probe) {
        await probe // 排在试令牌的那个请求后面，它落定后按最新令牌再判
        token = storage.get(TOKEN_KEY) || ''
      }
      if (!token) {
        if (sessionLostHandler) sessionLostHandler() // 无令牌调业务＝会话已丢·集中导登录
        return { ok: false, status: 401, error: 'SESSION_LOST' }
      }
      const pending = raw(action, token, data)
      if (token !== verifiedToken) {
        probe = pending.then((res) => {
          if (res.status !== 401 && res.status !== 0) verifiedToken = token
        })
        void probe.finally(() => (probe = null))
      }
      const r = await pending
      if (r.status === 401) {
        if (verifiedToken === token) verifiedToken = ''
        storage.remove(TOKEN_KEY)
        if (sessionLostHandler) sessionLostHandler() // 401＝会话失效·清令牌后集中导登录（单源·各页不再各跳）
        return { ...r, ok: false, error: 'SESSION_LOST' }
      }
      return r
    },
  }
}
