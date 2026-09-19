/**
 * atomic-v1 测版挂接：按 route.json + sequences 取原子 .txt，全文 trim 后原样当一条气泡。
 * 查单门闩 / 多面 / 优先级组装 / 句型 short|long。构建打进 kfCallback，运行时不拉 GitHub。
 * 不现编、不改写。正式闸关路径不走这里。
 */
import ASSETS from './csAtomicAssets.generated.json'

export const PACKAGING_FIRST_TOUCH_ID = 'packaging_damage_first_touch'
export const PACKAGING_WITH_ORDER_SHORT_ID = 'packaging_damage_priority_short'
export const PACKAGING_NO_ORDER_ID = 'packaging_damage_no_order'

export type UtteranceStyle = 'short' | 'long'

type AtomicStep = {
  lib: string
  pick: 'random_one' | 'all' | 'one'
  pool?: string[]
  files?: string[]
  priority?: number
  orLib?: string
  orPool?: string[]
  when?: string
  optional?: boolean
}

type AtomicSequence = {
  id: string
  line?: string
  style?: string
  requiresRecentOrder?: boolean
  steps: AtomicStep[]
}

type AtomicRoute = {
  line?: string
  businessLib?: string
  emotionAlways?: boolean
  emotionLibBySignal?: Record<string, string>
  gate?: { recentOrderRequiredForBusiness?: boolean; noOrderSequence?: string }
  sequences?: { withOrderShort?: string; firstTouchLegacy?: string }
  styleDefault?: string
}

type AtomicAssets = {
  id: string
  route: AtomicRoute
  sequences: Record<string, AtomicSequence>
  files: Record<string, string>
}

export type PackagingFacets = {
  packagingDamage: boolean
  logisticsSevere: boolean
  negative: boolean
}

export type AtomicPlayCtx = {
  severityHigh?: boolean
  logisticsSevere?: boolean
  style?: UtteranceStyle
  skipOptional?: boolean
}

const assets = ASSETS as AtomicAssets

const STITCH_MS = 8000
const SHORT_MAX = 8

export function loadAtomicAssets(): AtomicAssets {
  return assets
}

/** 相对 lib 的路径（如 emotion/surprise/01-啊）→ trim 后原文。禁止改写。 */
export function atomicText(rel: string): string {
  const raw = assets.files[rel]
  return raw == null ? '' : String(raw).trim()
}

export function listAtomicLib(lib: string): string[] {
  const prefix = lib.replace(/\/$/, '') + '/'
  return Object.keys(assets.files)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length))
    .sort()
}

export function detectPackagingFacets(text: string, severity?: string): PackagingFacets {
  const t = String(text || '')
  const packagingDamage = /包装|外箱|压烂|摔坏|破损|压坏|磕坏|摔烂/.test(t)
  const logisticsSevere =
    (/物流|运输|快递/.test(t) && /严重|损坏|砸|压烂|摔坏|破损/.test(t)) || /理赔|索赔/.test(t)
  const negative = packagingDamage || /烦|差|烂|坏|气|无语|失望|破|糟|体验|摔|压/.test(t)
  return {
    packagingDamage,
    logisticsSevere: logisticsSevere || severity === 'high',
    negative,
  }
}

/** 同会话连续短输入可拼；完整句型画像后做。 */
export function stitchUtterance(prevText: string, prevAt: number, text: string, now: number): string {
  const prev = String(prevText || '')
  const cur = String(text || '')
  if (!prev || !cur) return cur
  if (!Number.isFinite(prevAt) || now - prevAt > STITCH_MS) return cur
  const fold = (s: string) => s.replace(/\s+/g, '')
  if (fold(prev).length > SHORT_MAX || fold(cur).length > SHORT_MAX) return cur
  return prev + cur
}

function stemsOf(step: AtomicStep): string[] {
  if (step.files && step.files.length) {
    if (step.pick === 'all' || step.pick === 'one') return step.files
  }
  if ((step.pick === 'random_one' || step.pick === 'one') && step.pool && step.pool.length) return step.pool
  return listAtomicLib(step.lib)
}

function resolveStep(step: AtomicStep, rand: () => number): AtomicStep {
  if (step.orLib && step.orPool && step.orPool.length && rand() >= 0.5) {
    return { ...step, lib: step.orLib, pool: step.orPool, files: undefined }
  }
  return step
}

function stepApplies(step: AtomicStep, ctx: AtomicPlayCtx): boolean {
  if (step.optional && ctx.skipOptional) return false
  if (step.when === 'severity_high_or_logistics_damage') return !!(ctx.severityHigh || ctx.logisticsSevere)
  return !step.when
}

function stepBubbles(step: AtomicStep, rand: () => number): string[] {
  const stems = stemsOf(step)
  if (!stems.length) return []
  const pick = step.pick === 'all' ? stems : [stems[Math.floor(rand() * stems.length)] || stems[0]]
  const out: string[] = []
  for (const stem of pick) {
    const text = atomicText(step.lib.replace(/\/$/, '') + '/' + stem)
    if (text && !/订单号/.test(text)) out.push(text)
  }
  return out
}

function withEmotionAlways(seq: AtomicSequence, steps: AtomicStep[]): AtomicStep[] {
  const route = assets.route
  if (!route.emotionAlways) return steps
  if (seq.requiresRecentOrder === false) return steps
  if (steps.some((s) => String(s.lib || '').startsWith('gate/'))) return steps
  const emoLib =
    (route.emotionLibBySignal && (route.emotionLibBySignal.surprise || route.emotionLibBySignal.default)) || ''
  if (!emoLib) return steps
  const first = steps[0]
  if (first && String(first.lib || '').startsWith('emotion/')) return steps
  return [{ lib: emoLib, pick: 'random_one' }, ...steps]
}

function mergeByPriority(items: Array<{ priority: number; text: string }>, style: UtteranceStyle): string[] {
  if (style !== 'long') return items.map((i) => i.text)
  const out: string[] = []
  let buf = ''
  let pri = items.length ? items[0].priority : 0
  for (const it of items) {
    if (it.priority !== pri && buf) {
      out.push(buf)
      buf = ''
    }
    pri = it.priority
    buf += it.text
  }
  if (buf) out.push(buf)
  return out
}

export function playSequence(id: string, rand: () => number = Math.random, ctx: AtomicPlayCtx = {}): string[] {
  const seq = assets.sequences[id]
  if (!seq || !seq.steps) return []
  const style: UtteranceStyle = ctx.style === 'long' ? 'long' : 'short'
  const items: Array<{ priority: number; text: string }> = []
  for (const raw of withEmotionAlways(seq, seq.steps)) {
    if (!stepApplies(raw, ctx)) continue
    const step = resolveStep(raw, rand)
    const pri = Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 1
    for (const text of stepBubbles(step, rand)) items.push({ priority: pri, text })
  }
  return mergeByPriority(items, style)
}

export function assemblePackagingBubbles(input: {
  text: string
  hasRecentOrder: boolean
  style?: UtteranceStyle
  severity?: string
  rand?: () => number
}): string[] {
  const rand = input.rand || Math.random
  const style: UtteranceStyle = input.style === 'long' ? 'long' : 'short'
  const route = assets.route
  if (route.gate && route.gate.recentOrderRequiredForBusiness && !input.hasRecentOrder) {
    const noId = (route.gate && route.gate.noOrderSequence) || PACKAGING_NO_ORDER_ID
    return playSequence(noId, rand, { style })
  }
  const facets = detectPackagingFacets(input.text, input.severity)
  const id = (route.sequences && route.sequences.withOrderShort) || PACKAGING_WITH_ORDER_SHORT_ID
  return playSequence(id, rand, {
    style,
    severityHigh: input.severity === 'high',
    logisticsSevere: facets.logisticsSevere,
  })
}

export function packagingFirstTouchBubbles(rand: () => number = Math.random): string[] {
  return assemblePackagingBubbles({ text: '包裹被摔坏了', hasRecentOrder: true, style: 'short', rand })
}
