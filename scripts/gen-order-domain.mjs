#!/usr/bin/env node
/**
 * 订单域派生物生成器（P3「安全处生成」spike）。
 *
 * 单源：`packages/shared/src/order.spec.ts`（声明式状态机·纯数据）。
 * 本脚本从声明派生三类**安全处**产物（根因#8 铁律：只生成数据/类型/契约/守卫，永不碰运行时/UI）：
 *   ① TS 类型/常量 → `packages/shared/src/order.ts`（状态联合 + 常量 + 机读流转表）
 *   ② 机读流转表 JSON → `scripts/order-domain.generated.json`（守卫 order-transitions-declared 读它，免在守卫里解析 TS）
 *
 * 用法：
 *   node scripts/gen-order-domain.mjs          # 写入派生物
 *   node scripts/gen-order-domain.mjs --check   # 只校验：派生物与声明同步否（漂移→退出码 1，供守卫调用）
 *
 * 改流转：改 order.spec.ts → 跑本脚本 → check 绿。守卫 gen-order-domain-synced 焊「派生物必与声明同步」。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = join(ROOT, 'scripts/order-domain.generated.json')
// 多域声明（北极星 A·新域只加一项 DOMAINS）。每项：声明源 spec → TS 派生物 ts；流转表全并进一个 JSON。
const DOMAINS = [
  {
    spec: join(ROOT, 'packages/shared/src/order.spec.ts'),
    ts: join(ROOT, 'packages/shared/src/order.ts'),
    label: 'order.spec.ts',
    header: `/**\n * 订单域类型/常量/流转表——**生成物**（单源 order.spec.ts·勿手改生成段）。\n * 见 order.spec.ts 头注；改流转改声明再跑 scripts/gen-order-domain.mjs。\n */\n`,
  },
  {
    spec: join(ROOT, 'packages/shared/src/learning.spec.ts'),
    ts: join(ROOT, 'packages/shared/src/learning.ts'),
    label: 'learning.spec.ts',
    header: `/**\n * learning 域类型/常量/流转表——**生成物**（单源 learning.spec.ts·勿手改生成段）。\n * 见 learning.spec.ts 头注；改流转改声明再跑 scripts/gen-order-domain.mjs。\n */\n`,
  },
  {
    spec: join(ROOT, 'packages/shared/src/cs.spec.ts'),
    ts: join(ROOT, 'packages/shared/src/cs.ts'),
    label: 'cs.spec.ts',
    header: `/**\n * cs 域（承面 C 会话）类型/常量/流转表——**生成物**（单源 cs.spec.ts·勿手改生成段）。\n * 见 cs.spec.ts 头注；改流转改声明再跑 scripts/gen-order-domain.mjs。\n */\n`,
  },
]

const GEN_BANNER =
  '// ⚠️ 此段由 scripts/gen-order-domain.mjs 从对应 *.spec.ts 生成——勿手改。改流转改声明源（order.spec.ts/learning.spec.ts）再跑生成器。'
const GEN_BEGIN = '// === GENERATED:order-domain BEGIN ==='
const GEN_END = '// === GENERATED:order-domain END ==='

/**
 * 解析声明单源。spec 是纯数据，但本脚本不引 TS 运行时——用「窄解析器」从源码抠出声明，
 * 既避免编译依赖，又让「生成器读声明」这件事本身不依赖 dist（先有鸡再有蛋问题规避）。
 * 解析的是受控、稳定格式的字面量（本仓自有文件），非通用 TS 解析。
 */
function parseSpec(src) {
  const machines = []
  // 抠每个 *_STATUS_SPEC 块
  const blockRe = /export const (\w+_STATUS_SPEC)\s*=\s*\{([\s\S]*?)\n\}\s*as const/g
  let m
  while ((m = blockRe.exec(src))) {
    const [, name, body] = m
    const collection = (body.match(/collection:\s*'([^']+)'/) || [])[1]
    const initial = pullStringArray(body, 'initial')
    const terminal = pullStringArray(body, 'terminal')
    const transitions = []
    const tBlock = (body.match(/transitions:\s*\[([\s\S]*?)\n\s*\],?/) || [])[1] || ''
    const tRe = /\{\s*from:\s*\[([^\]]*)\]\s*,\s*to:\s*'([^']+)'\s*,\s*trigger:\s*'([^']*)'\s*\}/g
    let t
    while ((t = tRe.exec(tBlock))) {
      const from = [...t[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
      transitions.push({ from, to: t[2], trigger: t[3] })
    }
    machines.push({ name, collection, initial, terminal, transitions })
  }
  if (!machines.length) throw new Error('状态机声明源未解析到任何 *_STATUS_SPEC（声明单源损坏）')
  return machines
}

function pullStringArray(body, key) {
  const block = (body.match(new RegExp(key + ':\\s*\\[([^\\]]*)\\]')) || [])[1] || ''
  return [...block.matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** 一个状态机的全部状态（init + terminal + 流转两端·去重排序）。 */
function statesOf(mc) {
  const set = new Set([...mc.initial, ...mc.terminal])
  for (const t of mc.transitions) {
    t.from.forEach((f) => set.add(f))
    set.add(t.to)
  }
  return [...set].sort()
}

/** PascalCase 类型名前缀：ORDER_STATUS_SPEC → Order；AFTERSALE_STATUS_SPEC → AfterSale；QRCODE_STATUS_SPEC → Qrcode；CS_SESSION_STATUS_SPEC → CsSession。 */
const TYPE_PREFIX = { ORDER_STATUS_SPEC: 'Order', AFTERSALE_STATUS_SPEC: 'AfterSale', QRCODE_STATUS_SPEC: 'Qrcode', CS_SESSION_STATUS_SPEC: 'CsSession' }
/** 常量名前缀：…→ ORDER / AFTERSALE / QRCODE / CS_SESSION。 */
const CONST_PREFIX = { ORDER_STATUS_SPEC: 'ORDER', AFTERSALE_STATUS_SPEC: 'AFTERSALE', QRCODE_STATUS_SPEC: 'QRCODE', CS_SESSION_STATUS_SPEC: 'CS_SESSION' }

function genTs(machines, specLabel) {
  const parts = []
  for (const mc of machines) {
    const tp = TYPE_PREFIX[mc.name]
    const cp = CONST_PREFIX[mc.name]
    if (!tp || !cp) throw new Error(`未为 ${mc.name} 配置类型/常量前缀（gen-order-domain.mjs TYPE_PREFIX/CONST_PREFIX）`)
    const states = statesOf(mc)
    const union = states.map((s) => `'${s}'`).join(' | ')
    // 类型联合
    parts.push(`/** ${mc.collection} 状态联合（从 ${specLabel} 生成·写错状态名编译失败·根因#2）。 */`)
    parts.push(`export type ${tp}Status = ${union}`)
    parts.push('')
    // 常量对象（UPPER_SNAKE → 状态值；连字符状态转下划线键）
    parts.push(`export const ${cp}_STATUS = {`)
    for (const s of states) parts.push(`  ${s.toUpperCase().replace(/-/g, '_')}: '${s}',`)
    parts.push(`} as const satisfies Record<string, ${tp}Status>`)
    parts.push('')
    // 机读流转表
    parts.push(`/** ${mc.collection} 合法流转表（机读·守卫 order-transitions-declared 对账散落实现）。 */`)
    parts.push(`export const ${cp}_TRANSITIONS: ReadonlyArray<{ from: readonly ${tp}Status[]; to: ${tp}Status }> = [`)
    for (const t of mc.transitions) {
      const from = t.from.map((f) => `'${f}'`).join(', ')
      parts.push(`  { from: [${from}], to: '${t.to}' }, // ${t.trigger}`)
    }
    parts.push(`]`)
    parts.push('')
  }
  return parts.join('\n').trimEnd() + '\n'
}

function genDomainTs(machines, header, specLabel) {
  return header + '\n' + GEN_BANNER + '\n' + GEN_BEGIN + '\n' + genTs(machines, specLabel).trimEnd() + '\n' + GEN_END + '\n'
}

function genJson(machines) {
  const out = {}
  for (const mc of machines) {
    out[mc.collection] = {
      states: statesOf(mc),
      initial: mc.initial,
      terminal: mc.terminal,
      // 守卫对账用：每条 from[]→to（trigger 仅供人读）
      transitions: mc.transitions.map((t) => ({ from: t.from, to: t.to, trigger: t.trigger })),
    }
  }
  return JSON.stringify(out, null, 2) + '\n'
}

function main() {
  const check = process.argv.includes('--check')
  // 逐域解析 → 各生成 .ts；全域 machines 并进一个 JSON（守卫对账总源）。
  const allMachines = []
  const tsOut = [] // { ts, content }
  for (const d of DOMAINS) {
    const machines = parseSpec(readFileSync(d.spec, 'utf8'))
    allMachines.push(...machines)
    tsOut.push({ ts: d.ts, content: genDomainTs(machines, d.header, d.label) })
  }
  const json = genJson(allMachines)

  if (check) {
    const drift = []
    for (const { ts, content } of tsOut) {
      if (!existsSync(ts) || readFileSync(ts, 'utf8') !== content) drift.push('packages/shared/src/' + ts.split('/').pop())
    }
    let curJson = ''
    try {
      curJson = readFileSync(JSON_OUT, 'utf8')
    } catch {
      /* 缺失即漂移 */
    }
    if (curJson !== json) drift.push('scripts/order-domain.generated.json')
    if (drift.length) {
      console.error('[gen-order-domain] 派生物与声明不同步：' + drift.join('、') + '——跑 `node scripts/gen-order-domain.mjs` 重生成')
      process.exit(1)
    }
    console.log(`[gen-order-domain] 派生物与声明同步 ✓（${DOMAINS.map((d) => d.label.replace('.spec.ts', '')).join(' + ')}）`)
    return
  }

  for (const { ts, content } of tsOut) writeFileSync(ts, content)
  writeFileSync(JSON_OUT, json)
  console.log(`[gen-order-domain] 已生成 ${DOMAINS.map((d) => d.ts.split('/').pop()).join(' + ')} + order-domain.generated.json`)
}

main()
