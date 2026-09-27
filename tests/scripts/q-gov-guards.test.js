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
      "export const AFTERSALE_STATUS_SPEC = {\n  collection: 'afterSales',\n  initial: ['applied'],\n  terminal: ['refunded'],\n  transitions: [\n    { from: ['applied'], to: 'approved' },\n    { from: ['approved'], to: 'refunded' },\n  ],\n} as const\n" +
      "export const ODD_STATUSES: readonly AfterSaleStatus[] = ['applied', 'refunded']\n",
    'rewrite/shared/src/cs.spec.ts': '',
    'rewrite/shared/src/scm.ts': '',
    'rewrite/shared/src/learning.ts':
      "export const QRCODE_STATUS_SPEC = {\n  collection: 'qrcodes',\n  initial: ['unused'],\n  terminal: ['activated'],\n  transitions: [\n    { from: ['unused'], to: 'activated' },\n  ],\n} as const\n",
  }
  const run = (body) => guard('rw-status-transitions-declared').run(scratch({ ...SPEC, 'rewrite/cloud/src/functions/f.ts': body }))

  it('.add 建档写 initial 状态 → 绿', () => {
    expect(run("await db.collection('afterSales').add({ data: { _id: x, status: 'applied', at: 1 } })\n")).toEqual([])
  })

  it('.add 建档直接写非 initial 的声明状态 → 红', () => {
    const bad = run("await db.collection('afterSales').add({\n  data: {\n    _id: x,\n    status: 'approved',\n  },\n})\n")
    expect(bad.join('\n')).toMatch(/approved.*initial/)
  })

  // 生产源码的 .collection()/transition() 集合名实参已全部是 COLLECTIONS.x，守卫对真实代码只靠认这种写法的分支——钉住它，别让它坏了还恒绿
  it('.add 建档用 COLLECTIONS.x 写非 initial 状态 → 红', () => {
    const bad = run("await db.collection(COLLECTIONS.afterSales).add({ data: { _id: x, status: 'approved' } })\n")
    expect(bad.join('\n')).toMatch(/approved.*initial/)
  })

  it('transition(COLLECTIONS.x, …) 走未声明边 → 红', () => {
    const bad = run("await transition(COLLECTIONS.afterSales, id, ['refunded'], 'approved')\n")
    expect(bad.join('\n')).toMatch(/未声明边 refunded→approved/)
  })

  it('update 写非 initial 状态不受建档规则约束', () => {
    expect(run("await db.collection('afterSales').doc(x).update({ data: { status: 'approved' } })\n")).toEqual([])
  })

  // payCallback 的 pending→paid 就是这种写法：泛型 + 三元目标，两个目标都得核
  it('transition<T>(…) 三元目标里有未声明边 → 红', () => {
    const bad = run("await transition<AfterSaleDoc>(COLLECTIONS.afterSales, id, ['applied'], ok ? 'approved' : 'refunded', patch)\n")
    expect(bad.join('\n')).toMatch(/未声明边 applied→refunded/)
  })

  // activateCourse 的写法：边取自声明表的某一条，还得对上 transition 的集合
  const QR = "const QR = QRCODE_STATUS_SPEC.transitions[0]\n"
  it('[...T.from], T.to 取自声明表且集合对得上 → 绿', () => {
    expect(run(QR + 'await transition(COLLECTIONS.qrcodes, code, [...QR.from], QR.to, {})\n')).toEqual([])
  })

  it('[...T.from], T.to 拿别的集合的边 → 红', () => {
    const bad = run(QR + 'await transition(COLLECTIONS.afterSales, code, [...QR.from], QR.to, {})\n')
    expect(bad.join('\n')).toMatch(/未声明边 unused→activated/)
  })

  it('from/to 认不出 → 红（守卫失明不静默绿）', () => {
    expect(run('await transition(COLLECTIONS.afterSales, id, from, to)\n').join('\n')).toMatch(/认不出/)
  })

  it('解析不了的调用形态 → 红（不是跳过）', () => {
    expect(run("await transition(COLLECTIONS.afterSales, id, ['applied'], pick('approved'))\n").join('\n')).toMatch(/认不出/)
  })

  it('条件 CAS 用 shared 状态集常量 → 按常量展开核边', () => {
    const bad = run("await db.collection(COLLECTIONS.afterSales).where({ _id: x, status: _.in([...ODD_STATUSES]) }).update({ data: { status: 'approved' } })\n")
    expect(bad.join('\n')).toMatch(/未声明边 refunded→approved/)
  })

  it('条件 CAS 的状态集认不出 → 红（不当空集放绿）', () => {
    const bad = run("await db.collection(COLLECTIONS.afterSales).where({ _id: x, status: _.in(LOCAL_SET) }).update({ data: { status: 'approved' } })\n")
    expect(bad.join('\n')).toMatch(/认不出/)
  })

  // 声明文件没进 SPECS 时 learning.ts:84 曾整条不查：集合没声明表就红，新状态机文件漏收也一样
  it('transition() 的集合没有声明表 → 红（含解析不了的调用形态）', () => {
    expect(run("await transition(COLLECTIONS.batches, id, ['a'], 'b', {})\n").join('\n')).toMatch(/batches 没有状态声明表/)
    expect(run("await transition('batches', id, ['a'], pick('b'))\n").join('\n')).toMatch(/batches 没有状态声明表/)
  })
})
