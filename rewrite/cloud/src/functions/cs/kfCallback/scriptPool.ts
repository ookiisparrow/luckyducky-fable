/**
 * 客服话术库：从打包进来的 Markdown 抽编号短句，按节点取未用过的一句并填占位。
 */

import SCRIPT_MD from './scriptAssets.generated.json'

export type ScriptPoolId =
  | 'greet'
  | 'greetIssue'
  | 'ack'
  | 'restate'
  | 'trySolve'
  | 'answer'
  | 'askMore'
  | 'apology'
  | 'empathy'
  | 'reassure'
  | 'surprise'
  | 'awkward'
  | 'severity'
  | 'photo'
  | 'hesitate'
  | 'logisticsGreet'
  | 'logisticsEta'
  | 'discountRestate'
  | 'discountConfirm'
  | 'rushConfirm'
  | 'packPhoto'
  | 'missingPhoto'
  | 'coursePhoto'
  | 'clarify'
  | 'humanAskWhat'
  | 'humanSayDirect'

const POOL_HINTS: { file: string; heading: RegExp; id: ScriptPoolId }[] = [
  { file: 'docs/12-开场-打招呼无具体事.md', heading: /话术库/, id: 'greet' },
  { file: 'docs/01-主流程7节点.md', heading: /开场·已带问题/, id: 'greetIssue' },
  { file: 'docs/01-主流程7节点.md', heading: /快速回应反馈/, id: 'ack' },
  { file: 'docs/01-主流程7节点.md', heading: /复述顾客需求/, id: 'restate' },
  { file: 'docs/01-主流程7节点.md', heading: /开始尝试解决问题/, id: 'trySolve' },
  { file: 'docs/01-主流程7节点.md', heading: /给顾客回答/, id: 'answer' },
  { file: 'docs/01-主流程7节点.md', heading: /再次询问其他需求/, id: 'askMore' },
  { file: 'docs/03-情绪-道歉同理安抚.md', heading: /^道歉/, id: 'apology' },
  { file: 'docs/03-情绪-道歉同理安抚.md', heading: /^同理心/, id: 'empathy' },
  { file: 'docs/03-情绪-道歉同理安抚.md', heading: /^安抚/, id: 'reassure' },
  { file: 'docs/04-negative.md', heading: /^惊讶/, id: 'surprise' },
  { file: 'docs/04-negative.md', heading: /^尴尬/, id: 'awkward' },
  { file: 'docs/04-negative.md', heading: /^严重性分析/, id: 'severity' },
  { file: 'docs/05-信息采集-请求拍照.md', heading: /请求拍照/, id: 'photo' },
  { file: 'docs/07-犹豫节点.md', heading: /话术库/, id: 'hesitate' },
  { file: 'docs/11-态度投诉-澄清非有意.md', heading: /话术库/, id: 'clarify' },
  { file: 'topics/发货后-物流.md', heading: /开场/, id: 'logisticsGreet' },
  { file: 'topics/发货后-物流.md', heading: /报节点/, id: 'logisticsEta' },
  { file: 'topics/下单前-打折.md', heading: /^复述/, id: 'discountRestate' },
  { file: 'topics/下单前-打折.md', heading: /无优惠|需确认/, id: 'discountConfirm' },
  { file: 'topics/发货前-加急.md', heading: /不可加急|需如实/, id: 'rushConfirm' },
  { file: 'topics/收到后-包装.md', heading: /要合照/, id: 'packPhoto' },
  { file: 'topics/收到后-缺材料.md', heading: /要图确认/, id: 'missingPhoto' },
  { file: 'topics/收到后-课程程序.md', heading: /要截图/, id: 'coursePhoto' },
  { file: 'docs/14-开场仅人工.md', heading: /怎么了/, id: 'humanAskWhat' },
  { file: 'docs/14-开场仅人工.md', heading: /您直接说吧/, id: 'humanSayDirect' },
]

export function parseNumberedLines(md: string): string[] {
  const out: string[] = []
  for (const raw of String(md || '').split(/\r?\n/)) {
    const m = /^\s*\d+[.、]\s+(.+?)\s*$/.exec(raw)
    if (m) out.push(m[1])
  }
  return out
}

export function parseSections(md: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string[] }[] = [{ heading: '', body: [] }]
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (h) sections.push({ heading: h[2], body: [] })
    else sections[sections.length - 1].body.push(line)
  }
  return sections.map((s) => ({ heading: s.heading, body: s.body.join('\n') }))
}

export function buildPools(files: Record<string, string>): Record<string, string[]> {
  const pools: Record<string, string[]> = {}
  for (const hint of POOL_HINTS) {
    const md = files[hint.file]
    if (!md) continue
    for (const sec of parseSections(md)) {
      if (hint.heading.test(sec.heading)) {
        pools[hint.id] = parseNumberedLines(sec.body)
        break
      }
    }
  }
  return pools
}

let cached: Record<string, string[]> | null = null
export function scriptPools(): Record<string, string[]> {
  if (!cached) cached = buildPools(SCRIPT_MD as Record<string, string>)
  return cached
}

export function pickLine(
  poolId: string,
  used: string[],
  pools: Record<string, string[]> = scriptPools(),
  rand: () => number = Math.random
): string {
  const pool = pools[poolId] || []
  const unused = pool.filter((l) => !used.includes(l))
  const cand = unused.length ? unused : pool.filter((l) => l !== used[used.length - 1])
  const list = cand.length ? cand : pool
  if (!list.length) return ''
  return list[Math.floor(rand() * list.length)] || list[0]
}

export function rememberUsed(used: string[], line: string): string[] {
  if (!line) return used
  return used.concat(line).slice(-40)
}

const SLOT_FALLBACK: Record<string, string> = {
  需求: '您刚说的这件事',
  地址: '订单上的地址',
}

const FACT_SLOTS = new Set(['结论', '地点', '天数'])

export function fillSlots(line: string, slots: Record<string, string>): string {
  const raw = String(line || '')
  const keys = [...raw.matchAll(/【([^】]+)】/g)].map((m) => m[1])
  if (keys.some((k) => FACT_SLOTS.has(k) && !slots[k])) return ''
  return raw.replace(/【([^】]+)】/g, (_, k) => {
    const v = slots[k]
    return v ? v : SLOT_FALLBACK[k] || ''
  })
}
