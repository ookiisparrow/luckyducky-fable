/**
 * 测版客服多气泡：业务话术按换行/句号切开，连续 send 短句。
 * 系统句（刷新确认、人工梯子、菜单）不走这里。正式闸关路径也不走。
 */

const DEFAULT_GAP_MIN = 300
const DEFAULT_GAP_MAX = 800
const GAP_CAP_MS = 5000

/** 按换行或。！？～切成非空短段；标点留在本段末尾。 */
export function splitBubbles(text: string): string[] {
  const out: string[] = []
  for (const para of String(text || '').split(/\r?\n+/)) {
    let rest = para.trim()
    if (!rest) continue
    while (rest) {
      const m = /[。！？～]/.exec(rest)
      if (!m || m.index == null) {
        out.push(rest)
        break
      }
      const end = m.index + m[0].length
      const piece = rest.slice(0, end).trim()
      if (piece) out.push(piece)
      rest = rest.slice(end).trim()
    }
  }
  return out
}

export function parseBubbleGapMs(raw?: string): { min: number; max: number } {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return { min: DEFAULT_GAP_MIN, max: DEFAULT_GAP_MAX }
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(s)
  if (!m) return { min: DEFAULT_GAP_MIN, max: DEFAULT_GAP_MAX }
  let a = Math.min(GAP_CAP_MS, Math.max(0, Number(m[1])))
  let b = m[2] == null ? a : Math.min(GAP_CAP_MS, Math.max(0, Number(m[2])))
  if (b < a) {
    const t = a
    a = b
    b = t
  }
  return { min: a, max: b }
}

export function bubbleGapMs(raw?: string, rand: () => number = Math.random): number {
  const { min, max } = parseBubbleGapMs(raw)
  if (max <= min) return min
  return min + Math.floor(rand() * (max - min + 1))
}

function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, ms))
}

export async function sendBubbles(
  send: (payload: unknown) => Promise<unknown>,
  makeText: (content: string) => unknown,
  source: string | string[],
  opts?: { sleep?: (ms: number) => Promise<void>; rand?: () => number; gapEnv?: string }
): Promise<void> {
  const parts = (Array.isArray(source) ? source : [source]).flatMap(splitBubbles)
  if (!parts.length) return
  const sleep = opts && opts.sleep ? opts.sleep : defaultSleep
  const rand = opts && opts.rand ? opts.rand : Math.random
  const gapEnv = opts && opts.gapEnv !== undefined ? opts.gapEnv : process.env.CS_BUBBLE_GAP_MS
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await sleep(bubbleGapMs(gapEnv, rand))
    await send(makeText(parts[i]))
  }
}
