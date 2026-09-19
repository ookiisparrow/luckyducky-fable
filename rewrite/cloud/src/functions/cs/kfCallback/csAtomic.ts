/**
 * atomic-v1 测版挂接：按 route.json + sequences 取原子 .txt，全文 trim 后原样当一条气泡。
 * 构建打进 kfCallback，运行时不拉 GitHub。不现编、不改写。正式闸关路径不走这里。
 */
import ASSETS from './csAtomicAssets.generated.json'

export const PACKAGING_FIRST_TOUCH_ID = 'packaging_damage_first_touch'

type AtomicStep = {
  lib: string
  pick: 'random_one' | 'all'
  pool?: string[]
  files?: string[]
}

type AtomicSequence = {
  id: string
  line?: string
  steps: AtomicStep[]
}

type AtomicRoute = {
  line?: string
  businessLib?: string
  emotionAlways?: boolean
  emotionLibBySignal?: Record<string, string>
}

type AtomicAssets = {
  id: string
  route: AtomicRoute
  sequences: Record<string, AtomicSequence>
  files: Record<string, string>
}

const assets = ASSETS as AtomicAssets

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

function stemsOf(step: AtomicStep): string[] {
  if (step.pick === 'all' && step.files && step.files.length) return step.files
  if (step.pick === 'random_one' && step.pool && step.pool.length) return step.pool
  return listAtomicLib(step.lib)
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

function withEmotionAlways(steps: AtomicStep[]): AtomicStep[] {
  const route = assets.route
  if (!route.emotionAlways) return steps
  const emoLib = (route.emotionLibBySignal && (route.emotionLibBySignal.surprise || route.emotionLibBySignal.default)) || ''
  if (!emoLib) return steps
  const first = steps[0]
  if (first && String(first.lib || '').startsWith('emotion/')) return steps
  return [{ lib: emoLib, pick: 'random_one' }, ...steps]
}

export function playSequence(id: string, rand: () => number = Math.random): string[] {
  const seq = assets.sequences[id]
  if (!seq || !seq.steps) return []
  const out: string[] = []
  for (const step of withEmotionAlways(seq.steps)) out.push(...stepBubbles(step, rand))
  return out
}

export function packagingFirstTouchBubbles(rand: () => number = Math.random): string[] {
  return playSequence(PACKAGING_FIRST_TOUCH_ID, rand)
}
