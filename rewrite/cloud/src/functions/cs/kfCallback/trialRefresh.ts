/**
 * 测版「刷新」在客服会话里的入口：口令 / 菜单按钮 → 确认菜单 → 调 kit applyTrialRefresh。
 * 刷新本身（闸、清哪些文档、审计）在 kit/csTrialRefresh.ts，后台手动刷新也走那里。
 */

import { COLLECTIONS, CS_REFRESH_COPY, formatRefreshDone } from '@ldrw/shared'
import { applyTrialRefresh, listHeldSessions, loadTrialRefreshGate, type RefreshVia } from '../../../kit'

export const REFRESH_MENU_ASK = 'trial:refresh'
export const REFRESH_MENU_OK = 'trial:refresh:ok'
export const REFRESH_MENU_NO = 'trial:refresh:no'
export const REFRESH_BTN_LABEL = CS_REFRESH_COPY.buttonLabel

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

export function refreshDoneText(epochTo: number): string {
  return formatRefreshDone(epochTo)
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
  if (menuId && !isRefreshMenuId(menuId)) return false // 普通菜单不可能是刷新，不读闸
  const gate = await loadTrialRefreshGate(db)
  if (!gate.on) return false
  const passphrase = !menuId && matchRefreshPassphrase(String(incoming.text || ''), gate.words)
  if (!menuId && !passphrase) return false

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
