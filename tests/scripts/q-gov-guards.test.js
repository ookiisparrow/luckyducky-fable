// 部署闸 / MCP 放行名单 / 频控守卫 / 状态建档守卫的行为钉。
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { repoChecks } from '../../scripts/check-structure.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const guard = (id) => repoChecks.find((r) => r.id === id)

describe('部署闸 deploy-gated', () => {
  it('guard-deploy 实跑结果与 deploy-gated 用例表一致（invoke/detail/code update/config update/secureConfig 均 ask）', () => {
    expect(guard('deploy-gated').run()).toEqual([])
  })

  it('package.json script 包了闸会确认的 tcb/wechatide 命令 → 红；白名单只读 → 绿', () => {
    const root = scratch({
      'package.json': JSON.stringify({
        scripts: {
          peek: 'tcb fn detail app',
          ide: 'wechatide -c x cloud_fn_info --names app',
          logs: 'tcb fn log app',
          preview: 'wechatide -c ldrw-cli auto_preview --project x',
        },
      }),
    })
    const flagged = guard('deploy-gated')
      .run(root)
      .filter((m) => m.includes('package.json script'))
      .map((m) => m.match(/script「(\w+)」/)[1])
    expect(flagged.sort()).toEqual(['ide', 'peek'])
  }, 20000)
})

describe('MCP 自动放行名单不含能读出密钥的工具', () => {
  const { allow = [], deny = [] } = JSON.parse(readFileSync(resolve(ROOT, '.claude/settings.json'), 'utf8')).permissions ?? {}
  // 这些「只读」工具能读 secureConfig 文档或打印函数环境变量/API key，每次调用须人确认
  const SECRET_READERS = [
    'mcp__wechat-devtools__cloud_db_read_doc',
    'mcp__wechat-devtools__cloud_fn_info',
    'mcp__cloudbase__readNoSqlDatabaseContent',
    'mcp__cloudbase__queryFunctions',
    'mcp__cloudbase__queryAppAuth',
  ]
  it.each(SECRET_READERS)('%s 不在 allow、也不在 deny（每次询问）', (tool) => {
    expect(allow).not.toContain(tool)
    expect(deny).not.toContain(tool)
  })
})

const tmps = []
const scratch = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'q-gov-'))
  tmps.push(root)
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), src)
  }
  return root
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop(), { recursive: true, force: true })
})

describe('rw-user-writes-throttled 从 ACTIONS 注册表推导', () => {
  const APP = 'rewrite/cloud/src/functions/app'
  const index = (names) =>
    `import { a, getProducts } from './actions/x'\nimport { b } from './actions/y'\n` +
    `const ACTIONS: Record<string, any> = Object.assign(Object.create(null), {\n  ${names.join(',\n  ')},\n} satisfies Record<string, any>)\n`
  const x = `export const a = withOpenId(\n  // 频控\n  withRateLimit('a', { max: 1, windowMs: 1 }, async () => ok({}))\n)\nexport const getProducts = async () => ok({})\n`
  const run = (files) => guard('rw-user-writes-throttled').run(scratch(files))

  it('每个 action 要么 withRateLimit 包裹、要么在只读豁免表 → 绿', () => {
    const y = `export const b = withOpenId(withRateLimit('b', {}, async () => ok({})))\n`
    expect(run({ [`${APP}/index.ts`]: index(['a', 'getProducts', 'b']), [`${APP}/actions/x.ts`]: x, [`${APP}/actions/y.ts`]: y })).toEqual([])
  })

  it('注册表新增一个没包 withRateLimit 的写 action → 红并点名', () => {
    const y = `export const b = withOpenId(async () => ok({}))\n`
    const bad = run({ [`${APP}/index.ts`]: index(['a', 'getProducts', 'b']), [`${APP}/actions/x.ts`]: x, [`${APP}/actions/y.ts`]: y })
    expect(bad.join('\n')).toMatch(/\bb\b.*withRateLimit/)
  })

  it('withRateLimit 的名字与 action 不符（抄错键）→ 红', () => {
    const y = `export const b = withOpenId(withRateLimit('a', {}, async () => ok({})))\n`
    expect(run({ [`${APP}/index.ts`]: index(['a', 'getProducts', 'b']), [`${APP}/actions/x.ts`]: x, [`${APP}/actions/y.ts`]: y })).not.toEqual([])
  })

  it.each([
    ['键值形态', ['a', 'newWrite: evil', 'getProducts']],
    ['展开', ['a', '...extra', 'getProducts']],
    ['内联对象之后的条目', ['a', 'cfg: { x: 1 }', 'b']],
  ])('注册表出现非简写条目（%s）→ 红，不静默跳过', (_, names) => {
    const y = `export const b = withOpenId(withRateLimit('b', {}, async () => ok({})))\n`
    const bad = run({ [`${APP}/index.ts`]: index(names), [`${APP}/actions/x.ts`]: x, [`${APP}/actions/y.ts`]: y })
    expect(bad.join('\n')).toMatch(/非简写/)
  })

  it('注册表解析不到 action → 红（守卫失效不静默绿）', () => {
    expect(run({ [`${APP}/index.ts`]: 'export const main = 1\n' })).not.toEqual([])
  })
})

describe('rw-status-transitions-declared 建档状态须属 initial', () => {
  const SPEC = {
    'rewrite/shared/src/order.ts':
      "export const AFTERSALE_STATUS_SPEC = {\n  collection: 'afterSales',\n  initial: ['applied'],\n  terminal: ['refunded'],\n  transitions: [\n    { from: ['applied'], to: 'approved' },\n    { from: ['approved'], to: 'refunded' },\n  ],\n} as const\n",
    'rewrite/shared/src/cs.spec.ts': '',
    'rewrite/shared/src/scm.ts': '',
  }
  const run = (body) => guard('rw-status-transitions-declared').run(scratch({ ...SPEC, 'rewrite/cloud/src/functions/f.ts': body }))

  it('.add 建档写 initial 状态 → 绿', () => {
    expect(run("await db.collection('afterSales').add({ data: { _id: x, status: 'applied', at: 1 } })\n")).toEqual([])
  })

  it('.add 建档直接写非 initial 的声明状态 → 红', () => {
    const bad = run("await db.collection('afterSales').add({\n  data: {\n    _id: x,\n    status: 'approved',\n  },\n})\n")
    expect(bad.join('\n')).toMatch(/approved.*initial/)
  })

  it('update 写非 initial 状态不受建档规则约束', () => {
    expect(run("await db.collection('afterSales').doc(x).update({ data: { status: 'approved' } })\n")).toEqual([])
  })
})
