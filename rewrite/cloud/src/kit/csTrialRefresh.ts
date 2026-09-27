/**
 * 测版「刷新」：同号当新客（epoch++）。只清会话进度，不动真订单/支付/库存/openid。
 * 刷新＝清会话变量 / 人工中拒刷 / 只打会话层。
 * 预发（微信 trial）+ 正式（release / 生产云）硬关。口令默认可改：刷新 / #reset。
 * 放 kit：客服 bot（kfCallback）和后台手动刷新（adminApi）都要调，云函数之间不互相 import。
 */

import { COLLECTIONS, CS_REFRESH_PASSPHRASES } from '@ldrw/shared'
import { recordAudit } from './audit'
import { transition } from './transition'
import { err } from './reply'

export const DEFAULT_REFRESH_WORDS = CS_REFRESH_PASSPHRASES

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

/** 正式 release / 微信预发 / 生产云：测版能力硬关。 */
function isOfficialHardOff(): boolean {
  const ver = envVersion()
  return ver === 'release' || ver === 'trial' || isProdCloud()
}

/** 测版口径：yaliceshi* / develop；正式线硬关。 */
function isCsTrialLikeEnv(): boolean {
  if (isOfficialHardOff()) return false
  return envVersion() === 'develop' || isYaliceshiCloud()
}

/**
 * 测版默认当有近期订单（方便走有单话术）。
 * CS_TEST_ASSUME_ORDER：1 或缺省＝开；0/false＝关（真查单）。
 * 正式/生产硬关，旗标开了也不假设。
 */
export function csTestAssumeRecentOrder(): boolean {
  if (!isCsTrialLikeEnv()) return false
  const raw = String(process.env.CS_TEST_ASSUME_ORDER ?? '')
    .trim()
    .toLowerCase()
  return raw !== '0' && raw !== 'false'
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

// 刷新要清的 kfState 会话文档：键名与初值放这里，kfCallback 读写同一批文档时从这里取，两边不各写一份
export function sessionEpochId(euid: string): string {
  return 'jevsession:' + euid
}

export function flowStateId(euid: string): string {
  return 'jevflow:' + euid
}

export function packSessionId(euid: string): string {
  return 'jevpack:' + euid
}

/** 话术流程状态（jevflow 文档）的初值，字段顺序即落库顺序。used 是数组，取用时须换新数组。 */
export const EMPTY_FLOW = {
  node: '',
  topic: '',
  orderStatus: '',
  acting: '',
  checkpoint: '',
  greeted: false,
  hesitated: false,
  surprised: false,
  photoAsked: false,
  severitySaid: false,
  restated: false,
  promised: false,
  solved: false,
  humanAsks: 0,
  used: [],
  stitchText: '',
  stitchAt: 0,
} as const

export async function readEpochForHandoff(db: any, euid: string): Promise<number> {
  const got = await db
    .collection(COLLECTIONS.kfState)
    .doc(sessionEpochId(euid))
    .get()
    .catch(() => null)
  const n = Number(got && got.data && got.data.epoch)
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
}

export function trialRefreshDenyStatus(): 403 | 404 {
  const ver = envVersion()
  if (ver === 'release' || isProdCloud()) return 404
  return 403
}

export async function loadTrialRefreshGate(db: any): Promise<TrialRefreshGate> {
  const off = { on: false, words: [] as string[] }
  if (isOfficialHardOff()) return off
  const got = await db
    .collection(COLLECTIONS.secureConfig)
    .doc('typesafe')
    .get()
    .catch(() => null)
  const d = (got && got.data) || {}
  const on = process.env.CS_TRIAL_REFRESH === '1' || String(d.CS_TRIAL_REFRESH || '') === '1' || isCsTrialLikeEnv()
  if (!on) return off
  const fromEnv = parseWords(process.env.CS_TRIAL_REFRESH_WORDS)
  const fromDb = parseWords(d.CS_TRIAL_REFRESH_WORDS || d.refreshPassphrases)
  const words = fromEnv.length ? fromEnv : fromDb.length ? fromDb : [...DEFAULT_REFRESH_WORDS]
  return { on: true, words }
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

// 守卫 rw-status-transitions-declared 只扫 functions/，这里的边由 trial-refresh.test.ts 对着 CS_SESSION_STATUS_SPEC 锁
async function forceCloseHeld(db: any, held: Array<{ _id: string }>): Promise<void> {
  const now = Date.now()
  for (const s of held) {
    await transition(COLLECTIONS.csSession, s._id, ['pending', 'active', 'escalated'], 'closed', {
      updatedAt: now,
    }).catch(() => ({ moved: false }))
  }
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
  if (!euid) return err('BAD_ARGS')
  const gate = await loadTrialRefreshGate(db)
  if (!gate.on) return err('TRIAL_ONLY', { externalUserId: euid })
  const held = await listHeldSessions(db, euid, opts.openKfId)
  const force = !!opts.force
  if (held.length && !force) return err('HUMAN_ACTIVE', { externalUserId: euid })
  if (held.length && force) await forceCloseHeld(db, held)

  const epochFrom = await readEpochForHandoff(db, euid)
  const epochTo = epochFrom + 1
  const now = Date.now()
  const kf = db.collection(COLLECTIONS.kfState)
  await kf
    .doc(sessionEpochId(euid))
    .set({
      data: {
        epoch: epochTo,
        refreshedAt: now,
        boundOrderId: '',
        via: opts.via,
      },
    })
  // epoch 先落（失败即抛）；三项清理互不依赖、各自吞错，并发
  await Promise.all([
    kf.doc(flowStateId(euid)).set({ data: { at: Date.now(), ...EMPTY_FLOW, used: [] } }).catch(() => {}),
    kf.doc(packSessionId(euid)).remove().catch(() => {}),
    kf.doc('csatask:' + euid).remove().catch(() => {}),
  ])

  const reason = String(opts.reason || opts.via).slice(0, 80)
  await recordAudit({
    action: 'refreshTrialSession',
    module: 'cs',
    operator: String(opts.operator || opts.via).slice(0, 60),
    data: {
      via: opts.via,
      reason,
      epochFrom: String(epochFrom),
      epochTo: String(epochTo),
      externalUserId: euid,
      force: force ? '1' : '0',
    },
    ok: true,
  })
  return { ok: true, externalUserId: euid, epochFrom, epochTo, forced: force && !!held.length }
}
