/**
 * 测版客服多气泡：业务话术按换行/句号切开，连续 send 短句。
 * 系统句（刷新确认、人工梯子、菜单）不走这里。正式闸关路径也不走。
 * 硬顶 CS_MAX_BUBBLES（默认 3），避免包装破损 6 连发。
 */

const DEFAULT_GAP_MIN = 300
const DEFAULT_GAP_MAX = 800
const GAP_CAP_MS = 5000
export const DEFAULT_MAX_BUBBLES = 3
const MAX_BUBBLES_CAP = 20

/** 按换行或。！？～切成非空短段；标点留在本段末尾。 */
export function splitBubbles(text: string): string[] {
  return (String(text || '').match(/[^。！？～\n]*[。！？～]|[^。！？～\n]+/g) || []).map((s) => s.trim()).filter(Boolean)
}

export function parseBubbleGapMs(raw?: string): { min: number; max: number } {
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(String(raw ?? '').trim())
  if (!m) return { min: DEFAULT_GAP_MIN, max: DEFAULT_GAP_MAX }
  const a = Math.min(GAP_CAP_MS, Number(m[1]))
  const b = m[2] == null ? a : Math.min(GAP_CAP_MS, Number(m[2]))
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

export function bubbleGapMs(raw?: string, rand: () => number = Math.random): number {
  const { min, max } = parseBubbleGapMs(raw)
  if (max <= min) return min
  return min + Math.floor(rand() * (max - min + 1))
}

/** 硬顶气泡数。非法/空 → 3；至少 1，至多 20。 */
export function parseMaxBubbles(raw?: string): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_BUBBLES_CAP, Math.floor(n)) : DEFAULT_MAX_BUBBLES
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, ms))
}

export async function sendBubbles(
  send: (payload: unknown) => Promise<unknown>,
  makeText: (content: string) => unknown,
  source: string | string[],
  opts?: { sleep?: (ms: number) => Promise<void>; rand?: () => number; gapEnv?: string; raw?: boolean }
): Promise<void> {
  const parts = (
    opts && opts.raw && Array.isArray(source)
      ? source.map((s) => String(s || '').trim()).filter(Boolean)
      : (Array.isArray(source) ? source : [source]).flatMap(splitBubbles)
  ).slice(0, parseMaxBubbles(process.env.CS_MAX_BUBBLES))
  if (!parts.length) return
  const sleep = opts && opts.sleep ? opts.sleep : defaultSleep
  const rand = opts && opts.rand ? opts.rand : Math.random
  const gapEnv = opts && opts.gapEnv !== undefined ? opts.gapEnv : process.env.CS_BUBBLE_GAP_MS
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await sleep(bubbleGapMs(gapEnv, rand))
    await send(makeText(parts[i]))
  }
}
