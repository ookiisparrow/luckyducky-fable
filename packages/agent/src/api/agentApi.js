/**
 * 承面 C 坐席台 · 前后端接缝（**单点**·唯一 mock ↔ 真接口切换处）。
 *
 * 组件/页面只经本模块调用后端，**绝不直接引 api/mock.js**（守卫 agent-api-single-seam 焊之）——
 * 配 VITE_ADMIN_API（.env.production 已配生产网关）即自动从 mock 切到真 adminApi 网关，组件零改。
 * 10 个坐席 action + listKb 均走同一网关（同 admin/api/cloud.js 的 `{ action, key, data }` POST 形状；
 * cap 全部 agent:handle——外包无 customer:view，360 走 getSessionCustomer360 scoped 路径·见 shared/csAgentDesk.ts）。
 *
 * 模式：
 *  - mock（默认·车道 B 对 mock 建）：不配 VITE_ADMIN_API 或 VITE_AGENT_MOCK=1 → 走 mock.handle。
 *  - 真接口（整合后）：配 VITE_ADMIN_API → POST 到 adminApi。
 */
import * as mock from './mock.js'

const API_BASE = import.meta.env.VITE_ADMIN_API || ''
const FORCE_MOCK = import.meta.env.VITE_AGENT_MOCK === '1' || import.meta.env.VITE_AGENT_MOCK === 'true'
export const useMock = !API_BASE || FORCE_MOCK

const AUTH_KEY = 'ld_agent_auth'

// ── 会话（登录态存本机·同 admin 单口令 v1；真接口下 key 用于每次请求签发）─────
export function isLoggedIn() {
  return !!localStorage.getItem(AUTH_KEY)
}
function session() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY)) || {}
  } catch {
    return {}
  }
}
export function currentAgent() {
  return session().operator || ''
}
export function currentCaps() {
  const c = session().caps
  return Array.isArray(c) ? c : []
}
export function logout() {
  localStorage.removeItem(AUTH_KEY)
}
function persist(s) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ ...s, at: Date.now() }))
}
function hasAgentCap(caps) {
  const c = Array.isArray(caps) ? caps : []
  return c.includes('*') || c.includes('agent:handle')
}

async function realPost(action, data = {}) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, key: session().key || '', data }),
  })
  const r = await res.json()
  if (r.ok === undefined && r.code) throw new Error(`网关拒绝（${r.code}）`)
  return r
}

// 统一调用（**单点接缝**）：mock 或真网关，其余代码不感知差异。
async function call(action, data = {}) {
  return useMock ? mock.handle(action, data) : realPost(action, data)
}

const LOGIN_ERR = { KEY_TOO_SHORT: '口令至少 6 位', BAD_KEY: '口令不正确', ACCOUNT_DISABLED: '账号已停用' }

export async function login(password) {
  if (!password) return { ok: false, error: '请输入登录口令' }
  let r
  try {
    if (useMock) {
      r = mock.login(password)
    } else {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', key: password }),
      })
      r = await res.json()
    }
  } catch {
    return { ok: false, error: '连不上服务，请检查网络' }
  }
  if (!r.ok) return { ok: false, error: LOGIN_ERR[r.error] || '登录失败' }
  // 外包最小权闸（§1 定稿）：无坐席台能力位（agent:handle / '*'）不得进工作台。
  if (!hasAgentCap(r.caps)) return { ok: false, error: '该账号无坐席台权限（需 agent:handle），请联系商户开通' }
  // agentId：真后端由登录态派生（服务端不信前端传身份·§1.5）；mock 下同用 operator 作 agentId。
  persist({ operator: r.operator || '坐席', caps: r.caps, key: password })
  if (useMock) mock.resume('agent_demo')
  return { ok: true }
}

const WECOM_LOGIN_ERR = {
  BAD_CODE: '企业微信授权失败，请重试',
  NO_BOUND_ACCOUNT: '你的企业微信未绑定坐席账号，请联系商户在控制台绑定',
  ACCOUNT_DISABLED: '账号已停用',
  KF_TOKEN_UNAVAILABLE: '服务暂时不可用，请稍后重试或用口令登录',
  BAD_ARGS: '缺少授权码',
}

// M⑦ 车道B·企微 OAuth 免登：在企业微信自建应用内静默授权拿 code → 换 session 令牌进工作台（免口令）。
// 令牌作 key 存本机·后续请求带它（服务端 checkKey 认）。失败回退口令登录（Login.vue 兜底）。
export async function loginByWecomCode(code) {
  if (!code) return { ok: false, error: '缺少授权码' }
  let r
  try {
    if (useMock) {
      r = { ok: true, sessionToken: 'mock-wecom-token', operator: '演示坐席', caps: ['agent:handle'] }
    } else {
      const res = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'loginByWecomCode', data: { code } }),
      })
      r = await res.json()
    }
  } catch {
    return { ok: false, error: '连不上服务，请检查网络' }
  }
  if (!r.ok) return { ok: false, error: WECOM_LOGIN_ERR[r.error] || '免登失败', code: r.error }
  if (!hasAgentCap(r.caps)) return { ok: false, error: '该账号无坐席台权限（需 agent:handle），请联系商户开通' }
  persist({ operator: r.operator || '坐席', caps: r.caps, key: r.sessionToken })
  if (useMock) mock.resume('agent_demo')
  return { ok: true }
}

// 刷新页面后恢复 mock 内部 agentId（保 claim 归属一致·mock 态不持久）。
if (useMock && isLoggedIn()) mock.resume('agent_demo')

// ── 10 个坐席 action（严格贴 shared/csAgentDesk.ts 的 Req/Res）──────────────
export const listQueue = (params = {}) => call('listQueue', params) // { limit?, cursor? } → { ok, items, nextCursor? }
export const claimConversation = (sessionId) => call('claimConversation', { sessionId }) // → { ok, session }
export const releaseConversation = (sessionId) => call('releaseConversation', { sessionId }) // → { ok }
export const sendAgentMessage = (sessionId, text) => call('sendAgentMessage', { sessionId, text }) // → { ok, errcode? }
export const getThread = (sessionId, cursor) => call('getThread', { sessionId, cursor }) // → { ok, session, messages, nextCursor? }
export const setAgentStatus = (status) => call('setAgentStatus', { status }) // → { ok }
export const escalateToMerchant = (sessionId) => call('escalateToMerchant', { sessionId }) // → { ok }
export const closeConversation = (sessionId) => call('closeConversation', { sessionId }) // → { ok }
export const listMyActive = () => call('listMyActive', {}) // → { ok, sessions }（刷新恢复在接·follow-up ②）

// ── 侧栏 360（scoped 版·follow-up ①：外包无 customer:view·按会话经双闸看对应客户）+ 快捷回复 ──
export const getSessionCustomer360 = (sessionId) => call('getSessionCustomer360', { sessionId }) // → { ok, openid, panels } | { ok:false, error:'NO_BRIDGE'|'NO_CONSENT' }
export const listKb = () => call('listKb', {}) // → { ok, list:[{id,question,answer}] }
