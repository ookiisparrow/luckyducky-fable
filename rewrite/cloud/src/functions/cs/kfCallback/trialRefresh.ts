/**
 * 测版「刷新」：同号当新客（epoch++）。只清会话进度，不动真订单/支付/库存/openid。
 * 预发（微信 trial）+ 正式（release / 生产云）硬关。口令默认可改：刷新 / #reset。
 */

import { COLLECTIONS, CS_REFRESH_COPY, CS_REFRESH_PASSPHRASES, formatRefreshDone } from '@ldrw/shared'
import { recordAudit, transition } from '../../../kit'
import { emptyFlow, persistableFlow } from './scriptReply'

export const DEFAULT_REFRESH_WORDS = CS_REFRESH_PASSPHRASES
export const REFRESH_MENU_ASK = 'trial:refresh'
export const REFRESH_MENU_OK = 'trial:refresh:ok'
export const REFRESH_MENU_NO = 'trial:refresh:no'
export const REFRESH_BTN_LABEL = CS_REFRESH_COPY.buttonLabel

const HELD = new Set(['pending', 'active', 'escalated'])

export type RefreshVia = 'passphrase' | 'button' | 'admin'
export type RefreshFail = 'TRIAL_ONLY' | 'HUMAN_ACTIVE' | 'BAD_ARGS'
export type RefreshOk = {
  ok: true
  externalUserId: string
  epochFrom: number
  epochTo: number
  forced: boolean
}
export type RefreshErr = { ok: false; error: RefreshFail; externalUserId?: string }
export type RefreshResult = RefreshOk | RefreshErr

export type TrialRefreshGate = { on: boolean; words: string[] }

function envVersion(): string {
  return String(process.env.WX_ENV_VERSION || process.env.TCB_ENV_VERSION || '').toLowerCase()
}

function cloudEnvId(): string {
  return String(process.env.TCB_ENV || process.env.SCF_NAMESPACE || '')
}

/** 生产云门牌以 cloudbase- 起头；测版云以 yaliceshi 起头。不抄完整 id（门牌单源在 scripts/lib/env.mjs）。 */
function isProdCloud(): boolean {
  return cloudEnvId().startsWith('cloudbase-')
}

function isYaliceshiCloud(): boolean {
  return cloudEnvId().startsWith('yaliceshi')
}

function parseWords(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((w) => String(w || '').trim()).filter(Boolean)
  }
  const s = String(raw || '').trim()
  if (!s) return []
  return s
    .split(/[,，\n]/)
    .map((w) => w.trim())
    .filter(Boolean)
}

export function sessionEpochId(euid: string): string {
  return 'jevsession:' + euid
}

export function flowStateId(euid: string): string {
  return 'jevflow:' + euid
}

export function isRefreshMenuId(menuId: string): boolean {
  return menuId === REFRESH_MENU_ASK || menuId === REFRESH_MENU_OK || menuId === REFRESH_MENU_NO
}

/** 口令精确比对（去首尾空白；英文口令不区分大小写）。 */
export function matchRefreshPassphrase(text: string, words: readonly string[]): boolean {
  const t = String(text || '').trim()
  if (!t) return false
  const lower = t.toLowerCase()
  return words.some((w) => {
    const ww = String(w || '').trim()
    if (!ww) return false
    return /[A-Za-z#]/.test(ww) ? ww.toLowerCase() === lower : ww === t
  })
}

export function trialRefreshDenyStatus(): 403 | 404 {
  const ver = envVersion()
  if (ver === 'release' || isProdCloud()) return 404
  return 403
}

export function trialRefreshConfirmMenu(kind: 'passphrase' | 'button' = 'button'): {
  head_content: string
  list: { type: 'click'; click: { id: string; content: string } }[]
  tail_content: string
} {
  return {
    head_content: kind === 'passphrase' ? CS_REFRESH_COPY.confirmPassphrase : CS_REFRESH_COPY.confirmButton,
    list: [
      { type: 'click', click: { id: REFRESH_MENU_OK, content: '确认重来' } },
      { type: 'click', click: { id: REFRESH_MENU_NO, content: '取消' } },
    ],
    tail_content: '',
  }
}

export async function loadTrialRefreshGate(db: any): Promise<TrialRefreshGate> {
  const ver = envVersion()
  const off = { on: false, words: [] as string[] }
  if (ver === 'release' || ver === 'trial') return off
  if (isProdCloud()) return off
  const envFlag = process.env.CS_TRIAL_REFRESH === '1'
  const develop = ver === 'develop'
  const got = await db
    .collection(COLLECTIONS.secureConfig)
    .doc('typesafe')
    .get()
    .catch(() => null)
  const d = (got && got.data) || {}
  const dbFlag = String(d.CS_TRIAL_REFRESH || '') === '1'
  const on = envFlag || dbFlag || develop || isYaliceshiCloud()
  if (!on) return off
  const fromEnv = parseWords(process.env.CS_TRIAL_REFRESH_WORDS)
  const fromDb = parseWords(d.CS_TRIAL_REFRESH_WORDS || d.refreshPassphrases)
  const words = fromEnv.length ? fromEnv : fromDb.length ? fromDb : [...DEFAULT_REFRESH_WORDS]
  return { on: true, words }
}

async function readEpoch(db: any, euid: string): Promise<{ epoch: number; boundOrderId: string }> {
  const got = await db
    .collection(COLLECTIONS.kfState)
    .doc(sessionEpochId(euid))
    .get()
    .catch(() => null)
  const d = (got && got.data) || {}
  const epoch = Number.isFinite(Number(d.epoch)) ? Math.max(0, Math.floor(Number(d.epoch))) : 0
  return { epoch, boundOrderId: String(d.boundOrderId || '') }
}

export async function listHeldSessions(
  db: any,
  euid: string,
  openKfId?: string
): Promise<Array<{ _id: string; status: string }>> {
  if (openKfId) {
    const got = await db
      .collection(COLLECTIONS.csSession)
      .doc('wxkf:' + openKfId + ':' + euid)
      .get()
      .catch(() => null)
    const s = got && got.data
    return s && HELD.has(String(s.status || '')) ? [{ _id: 'wxkf:' + openKfId + ':' + euid, status: String(s.status) }] : []
  }
  const res = await db
    .collection(COLLECTIONS.csSession)
    .where({ externalUserId: euid })
    .get()
    .catch(() => ({ data: [] }))
  return ((res && res.data) || [])
    .filter((s: any) => s && HELD.has(String(s.status || '')))
    .map((s: any) => ({ _id: String(s._id), status: String(s.status) }))
}

async function forceCloseHeld(db: any, held: Array<{ _id: string }>): Promise<void> {
  const now = Date.now()
  for (const s of held) {
    await transition('csSession', s._id, ['pending', 'active', 'escalated'], 'closed', {
      updatedAt: now,
    }).catch(() => ({ moved: false }))
  }
}

export function refreshDoneText(epochTo: number): string {
  return formatRefreshDone(epochTo)
}

export async function applyTrialRefresh(
  db: any,
  opts: {
    externalUserId: string
    openKfId?: string
    via: RefreshVia
    reason: string
    force?: boolean
    operator?: string
  }
): Promise<RefreshResult> {
  const euid = String(opts.externalUserId || '').trim()
  if (!euid) return { ok: false, error: 'BAD_ARGS' }
  const gate = await loadTrialRefreshGate(db)
  if (!gate.on) return { ok: false, error: 'TRIAL_ONLY', externalUserId: euid }
  const held = await listHeldSessions(db, euid, opts.openKfId)
  const force = !!opts.force
  if (held.length && !force) return { ok: false, error: 'HUMAN_ACTIVE', externalUserId: euid }
  if (held.length && force) await forceCloseHeld(db, held)

  const prev = await readEpoch(db, euid)
  const epochTo = prev.epoch + 1
  const now = Date.now()
  await db
    .collection(COLLECTIONS.kfState)
    .doc(sessionEpochId(euid))
    .set({
      data: {
        epoch: epochTo,
        refreshedAt: now,
        boundOrderId: '',
        via: opts.via,
      },
    })
  await db
    .collection(COLLECTIONS.kfState)
    .doc(flowStateId(euid))
    .set({ data: persistableFlow(emptyFlow()) })
    .catch(() => {})
  await db
    .collection(COLLECTIONS.kfState)
    .doc('csatask:' + euid)
    .remove()
    .catch(() => {})

  const reason = String(opts.reason || opts.via).slice(0, 80)
  await recordAudit({
    action: 'refreshTrialSession',
    module: 'cs',
    operator: String(opts.operator || opts.via).slice(0, 60),
    data: {
      via: opts.via,
      reason,
      epochFrom: String(prev.epoch),
      epochTo: String(epochTo),
      externalUserId: euid,
      force: force ? '1' : '0',
    },
    ok: true,
  })
  return { ok: true, externalUserId: euid, epochFrom: prev.epoch, epochTo, forced: force && !!held.length }
}

export type IncomingLite = { externalUserId: string; menuId: string; text: string }

/** 闸开时拦在 Jev/话术前。闸关：口令当普通字，菜单点了也不提示「这是口令」。 */
export async function interceptTrialRefresh(
  db: any,
  incoming: IncomingLite,
  openKfId: string,
  send: (payload: any) => Promise<any>
): Promise<boolean> {
  const menuId = String(incoming.menuId || '')
  const text = String(incoming.text || '')
  const looksLike = isRefreshMenuId(menuId)
  const gate = await loadTrialRefreshGate(db)
  if (!gate.on) return false
  const passphrase = !menuId && matchRefreshPassphrase(text, gate.words)
  if (!looksLike && !passphrase) return false

  const to = incoming.externalUserId
  const base = { touser: to, open_kfid: openKfId }
  if (menuId === REFRESH_MENU_NO) {
    await send({ ...base, msgtype: 'text', text: { content: '已取消，还按刚才的会话继续。' } })
    return true
  }
  if (menuId === REFRESH_MENU_ASK || passphrase) {
    const held = await listHeldSessions(db, to, openKfId)
    if (held.length) {
      await send({ ...base, msgtype: 'text', text: { content: CS_REFRESH_COPY.rejectInHuman } })
      return true
    }
    const via: RefreshVia = passphrase ? 'passphrase' : 'button'
    await db
      .collection(COLLECTIONS.kfState)
      .doc('refreshask:' + to)
      .set({ data: { via, at: Date.now() } })
      .catch(() => {})
    await send({
      ...base,
      msgtype: 'msgmenu',
      msgmenu: trialRefreshConfirmMenu(via === 'passphrase' ? 'passphrase' : 'button'),
    })
    return true
  }

  const ask = await db
    .collection(COLLECTIONS.kfState)
    .doc('refreshask:' + to)
    .get()
    .catch(() => null)
  const via: RefreshVia = ask && ask.data && ask.data.via === 'passphrase' ? 'passphrase' : 'button'
  await db
    .collection(COLLECTIONS.kfState)
    .doc('refreshask:' + to)
    .remove()
    .catch(() => {})
  const r = await applyTrialRefresh(db, {
    externalUserId: to,
    openKfId,
    via,
    reason: via,
    force: false,
    operator: via,
  })
  if (!r.ok && r.error === 'HUMAN_ACTIVE') {
    await send({ ...base, msgtype: 'text', text: { content: CS_REFRESH_COPY.rejectInHuman } })
    return true
  }
  if (!r.ok) {
    await send({ ...base, msgtype: 'text', text: { content: '这次没刷成，请稍后再试。' } })
    return true
  }
  await send({ ...base, msgtype: 'text', text: { content: refreshDoneText(r.epochTo) } })
  return true
}
