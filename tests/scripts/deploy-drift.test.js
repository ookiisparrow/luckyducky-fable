import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { MONEY_CHAIN, deployBlockers, detectDrift, hashFnDist, readDeployLedger } from '../../scripts/lib/deploy-drift.mjs'

// 守卫 preflight「钱链改了未部署→红」的核心逻辑（根因#8 已提交≠已部署）。
// 2026-06-16 实测漂移：钱链 [LD_ALERT] 等改了 4 天没部署、preflight 只验结构没验部署时效漏过。
describe('deploy-drift detectDrift：钱链改了未部署的检测', () => {
  it('hash 全等 → 无漂移（部署态≡代码态）', () => {
    const cur = { pay: 'aaa', createOrder: 'bbb' }
    expect(detectDrift(cur, { pay: 'aaa', createOrder: 'bbb' }, ['pay', 'createOrder'])).toEqual([])
  })
  it('hash 不符 → 漂移（代码领先部署·核心场景）', () => {
    const d = detectDrift({ pay: 'newhash' }, { pay: 'oldhash' }, ['pay'])
    expect(d).toHaveLength(1)
    expect(d[0]).toContain('pay')
    expect(d[0]).toContain('oldhash')
  })
  it('manifest 缺该函数 → 漂移（从未部署）', () => {
    expect(detectDrift({ pay: 'x' }, {}, ['pay'])).toHaveLength(1)
    expect(detectDrift({ pay: 'x' }, {}, ['pay'])[0]).toContain('未部署')
  })
  it('产物缺 → 漂移（构建漏产）', () => {
    expect(detectDrift({}, { pay: 'x' }, ['pay'])).toEqual(['pay(产物缺)'])
  })
  it('只查传入的 fns 子集（不误判其它函数）', () => {
    expect(detectDrift({ pay: 'a', other: 'X' }, { pay: 'a', other: 'Y' }, ['pay'])).toEqual([])
  })
})

describe('deploy-drift MONEY_CHAIN：生产线（rewrite/cloud）钱链 4 函数', () => {
  it('含网关+回调+定时关单全链（app 收编 createOrder/pay/applyRefund 等 action）', () => {
    for (const fn of ['app', 'payCallback', 'refundCallback', 'closeExpiredOrders']) expect(MONEY_CHAIN).toContain(fn)
    expect(MONEY_CHAIN).toHaveLength(4)
  })
})

describe('deploy-drift hashFnDist：产物内容 hash（即 deploy-fns.mjs 部署时算法本体）', () => {
  const mkTmp = () => mkdtempSync(join(tmpdir(), 'deploy-drift-test-'))

  it('index.js 缺失 → 返回 null', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      expect(hashFnDist(dist, 'foo')).toBeNull()
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('只有 index.js 能算出 12 位 hex hash', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      writeFileSync(join(dist, 'foo', 'index.js'), 'exports.main = () => 1')
      const h = hashFnDist(dist, 'foo')
      expect(h).toMatch(/^[0-9a-f]{12}$/)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('index.js 不变、只改 config.json 内容 → hash 必须变（证伪 index.js-only 算法的假阴性）', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      writeFileSync(join(dist, 'foo', 'index.js'), 'exports.main = () => 1')
      writeFileSync(join(dist, 'foo', 'config.json'), '{"permissions":{"openapi":["a"]}}')
      const h1 = hashFnDist(dist, 'foo')
      writeFileSync(join(dist, 'foo', 'config.json'), '{"permissions":{"openapi":["a","b"]}}')
      const h2 = hashFnDist(dist, 'foo')
      expect(h2).not.toBe(h1)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('index.js 不变、只改 package.json 内容 → hash 必须变', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      writeFileSync(join(dist, 'foo', 'index.js'), 'exports.main = () => 1')
      writeFileSync(join(dist, 'foo', 'package.json'), '{"dependencies":{}}')
      const h1 = hashFnDist(dist, 'foo')
      writeFileSync(join(dist, 'foo', 'package.json'), '{"dependencies":{"a":"1.0.0"}}')
      const h2 = hashFnDist(dist, 'foo')
      expect(h2).not.toBe(h1)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  // 构建戳回归（2026-08-03·omp 评估 R03 由 opus-5 逮到·主力核实）：build.mjs 把提交号写进每函数
  // package.json.version（`0.0.0-<sha>`），而本 hash 原先吃 package.json 全文 → **每次提交号一变，
  // 13 个函数 hash 全变**，「变更待部署 N 个」恒等于全量、再分不出谁真改了。而这条 hash 机制当初正是
  // 为治「假报 0 个」而建（deploy-fns.mjs 头注：app 函数落后 git 半月无人察觉）——从漏报变成全是噪音，
  // 两种失效方式都等于没有信号。故 version 字段排除在 hash 外；deps/其余字段照旧参与（下一条锁）。
  it('index.js 不变、只改 package.json 的 version（构建戳）→ hash 不得变（否则部署 diff 恒等全量）', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      writeFileSync(join(dist, 'foo', 'index.js'), 'exports.main = () => 1')
      writeFileSync(join(dist, 'foo', 'package.json'), '{"name":"foo","version":"0.0.0-aaaaaaa","dependencies":{}}')
      const h1 = hashFnDist(dist, 'foo')
      writeFileSync(join(dist, 'foo', 'package.json'), '{"name":"foo","version":"0.0.0-bbbbbbb","dependencies":{}}')
      const h2 = hashFnDist(dist, 'foo')
      expect(h2).toBe(h1)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('version 排除不得殃及 deps：只改 dependencies → hash 仍须变（防修过头把依赖漂移也放行）', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      writeFileSync(join(dist, 'foo', 'index.js'), 'exports.main = () => 1')
      writeFileSync(join(dist, 'foo', 'package.json'), '{"name":"foo","version":"0.0.0-aaaaaaa","dependencies":{}}')
      const h1 = hashFnDist(dist, 'foo')
      writeFileSync(
        join(dist, 'foo', 'package.json'),
        '{"name":"foo","version":"0.0.0-aaaaaaa","dependencies":{"@cloudbase/manager-node":"4.x"}}',
      )
      const h2 = hashFnDist(dist, 'foo')
      expect(h2).not.toBe(h1)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('package.json 不是合法 JSON 时不吞不崩：退回全文 hash（fail-safe·内容变了照样能咬）', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      writeFileSync(join(dist, 'foo', 'index.js'), 'exports.main = () => 1')
      writeFileSync(join(dist, 'foo', 'package.json'), '{ 坏掉的 json')
      const h1 = hashFnDist(dist, 'foo')
      expect(h1).toMatch(/^[0-9a-f]{12}$/)
      writeFileSync(join(dist, 'foo', 'package.json'), '{ 坏掉的 json 又改了')
      expect(hashFnDist(dist, 'foo')).not.toBe(h1)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  it('无 config.json/package.json 时不因文件不存在而抛错', () => {
    const dist = mkTmp()
    try {
      mkdirSync(join(dist, 'foo'), { recursive: true })
      writeFileSync(join(dist, 'foo', 'index.js'), 'exports.main = () => 1')
      expect(() => hashFnDist(dist, 'foo')).not.toThrow()
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })
})

// 部署账本＝最新 deploy-* 注释 tag（2026-10-02：清单文件 9-29 后没再提交、已不可信；改成只推 tag 不推 main）。
describe('deploy-drift readDeployLedger：账本读最新 deploy-* tag', () => {
  // pre-commit 里跑时 git 注入 GIT_DIR/GIT_INDEX_FILE 等，子进程 git 会无视 cwd 直接写本仓
  // （2026-10-02 实测：临时仓的 commit/tag 落进了本仓）。本组期间剥掉，readDeployLedger 也继承这份 env。
  const saved = {}
  beforeAll(() => {
    for (const k of Object.keys(process.env).filter((k) => k.startsWith('GIT_'))) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterAll(() => Object.assign(process.env, saved))

  const git = (cwd, args, input) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, input, encoding: 'utf8' })
  const withRepo = (fn) => {
    const d = mkdtempSync(join(tmpdir(), 'deploy-ledger-test-'))
    try {
      git(d, ['init', '-q'])
      git(d, ['commit', '-q', '--allow-empty', '-m', 'x'])
      fn(d)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  }
  const tag = (d, name, functions) => git(d, ['tag', '-a', name, '-F', '-'], JSON.stringify({ functions }))
  const seed = (d, functions) => writeFileSync(join(d, '.deploy-manifest.json'), JSON.stringify({ functions }))

  it('无 tag 无种子 → 空账本（诚实的未知态＝全部待部署）', () =>
    withRepo((d) => expect(readDeployLedger(d).functions).toEqual({})))
  it('无 tag → 退回种子 .deploy-manifest.json', () =>
    withRepo((d) => {
      seed(d, { app: 'seed' })
      expect(readDeployLedger(d).functions).toEqual({ app: 'seed' })
    }))
  it('有 tag → 取最新那个，压过种子', () =>
    withRepo((d) => {
      seed(d, { app: 'seed' })
      tag(d, 'deploy-20261001T000000Z', { app: 'old' })
      tag(d, 'deploy-20261002T000000Z', { app: 'new' })
      const l = readDeployLedger(d)
      expect(l.functions).toEqual({ app: 'new' })
      expect(l.source).toBe('deploy-20261002T000000Z')
    }))
})

describe('deploy-drift deployBlockers：只从「干净的、与 origin 同步的 main」部署', () => {
  const ok = { branch: 'main', head: 'a'.repeat(40), originMain: 'a'.repeat(40), dirty: '' }
  it('三条全满足 → 放行', () => expect(deployBlockers(ok)).toEqual([]))
  it('不在 main → 拦', () => expect(deployBlockers({ ...ok, branch: 'feat/x' })[0]).toContain('feat/x'))
  it('游离 HEAD → 拦', () => expect(deployBlockers({ ...ok, branch: '' })).toHaveLength(1))
  it('落后或领先 origin/main → 拦', () =>
    expect(deployBlockers({ ...ok, originMain: 'b'.repeat(40) })[0]).toContain('origin/main'))
  it('工作区有改动 → 拦', () =>
    expect(deployBlockers({ ...ok, dirty: ' M rewrite/cloud/src/x.ts' })[0]).toContain('x.ts'))
})
