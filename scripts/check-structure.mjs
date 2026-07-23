#!/usr/bin/env node
/**
 * 结构不变量检查——重构主张的「机器守卫」。
 *
 * 与 check-conventions 分工：
 *   - conventions 管「单文件的样式 / 多端写法」（rpx / 写死色 / 内联 svg…）。
 *   - structure  管「跨文件 / 仓级的架构不变量」——**每条重构主张落地为这里一条规则**：
 *     主张做完 = 守卫存在且全绿；主张回退 = 红灯。让架构决策从「靠人记」变「机器守」。
 *
 * 两类规则：
 *   repoChecks —— 仓级断言（跑一次）：扫 package.json / 配置 / 目录形状。
 *   fileRules  —— 逐文件（B2 起按主张追加：禁多端回退、禁运行时引 data/、禁 kit 外裸 init…）。
 *                 B1 为空数组——引擎就位，规则随批次长出。
 *
 * 用法：
 *   node scripts/check-structure.mjs            # 全量（repoChecks + fileRules）
 *   node scripts/check-structure.mjs --hook      # PostToolUse：读 stdin，违例 exit 2 反馈给 Claude
 *
 * 自证（B1 验收项 + 每批反向自检纪律）：篡改任一已通过不变量 → 本检查必红。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RULES as conventionRules } from './check-conventions.mjs'
import { allDeployNames } from './lib/deploy-aliases.mjs' // 部署别名单源（产物→云函数名·adminApi 亦部署为 adminApiV2·病根#16）
import { oldlineDigest } from './oldline-freeze-lib.mjs'
import { deriveTierCharsets } from './lib/brand-font-charset.mjs'

const ROOT = resolve(import.meta.dirname, '..')

// 扫描面统一排除（病根#16·盲区体检批1）：dot 目录（.claude/worktrees 残留 worktree、.git 等）与
// vendor/产物目录一律不是活代码。任何递归 walker 漏排除都会把残留 worktree 当活代码扫——2026-07-18
// 事故：rewrite/mp/.claude/worktrees/ 下的过期 worktree 让 main 的 npm run check 假红 10 处（而 CI
// fresh checkout 恒绿→漂移不可见）。递归遍历一律经 lsScan() 取目录项；金丝雀夹具
// rewrite/mp/.claude/worktrees/fixture-scan-surface/（故意含违例 token）常驻证明本排除在生效——
// 闸恒绿=排除活着；谁改坏扫描面，金丝雀当场咬红并指到这里。
const SKIP_DIR = (n) => n === 'node_modules' || n === 'dist' || n === 'miniprogram_npm' || n.startsWith('.')
const lsScan = (d) => readdirSync(d).filter((n) => !SKIP_DIR(n))

function listPackageJsons() {
  const out = ['package.json']
  // 旧线 packages/ + 新线 rewrite/（rw-line-in-gates：包级守卫不许漏扫新线）
  for (const base of ['packages', 'rewrite']) {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) continue
    for (const n of lsScan(dir)) {
      const p = `${base}/${n}/package.json`
      if (existsSync(join(ROOT, p))) out.push(p)
    }
  }
  return out
}

// ============== 仓级不变量（repoChecks）==============
// 每条 run() 返回违例说明数组（空 = 通过）。
// roots：本守卫治哪条病根/主张（病根 #N / 主张 TN / 红线·基建·正册·格式 等标签）——
// 机读 provenance，guard-coverage 据此断言每条病根都有守卫（见 docs/元模式.md A2/A4）。
// 新线黄金用例注册表（收敛阀）：rewrite 各模块 golden 行为基准测试集中登记，被 rw-golden-registered 一条守卫统一核存在。
// 新增模块只加一行、不加守卫（守卫总数收敛·呼应 known-collections-only / known-error-codes）。
export const RW_GOLDEN_REGISTRY = [
  { id: 'rw-contracts-golden', roots: ['#4', '#2', '#5'], test: 'rewrite/shared/tests/money.test.ts' },
  { id: 'rw-kit-golden', roots: ['#1', '#2', '#3', '#7', '#13'], test: 'rewrite/cloud/tests/transition.test.ts' },
  { id: 'rw-user-catalog-golden', roots: ['#1', '#3'], test: 'rewrite/cloud/tests/app-user.test.ts' },
  { id: 'rw-learning-golden', roots: ['#1', '#2', '#3'], test: 'rewrite/cloud/tests/app-learning.test.ts' },
  { id: 'rw-reviews-golden', roots: ['#1', '#3', '#7'], test: 'rewrite/cloud/tests/app-reviews.test.ts' },
  { id: 'rw-money1-golden', roots: ['#1', '#2', '#3', '#4'], test: 'rewrite/cloud/tests/app-orders.test.ts' },
  { id: 'rw-money2-golden', roots: ['#1', '#2', '#3', '#4', '#12'], test: 'rewrite/cloud/tests/app-pay.test.ts' },
  { id: 'rw-money3-golden', roots: ['#1', '#2', '#3', '#4', '#7', '#12'], test: 'rewrite/cloud/tests/app-refund.test.ts' },
  { id: 'rw-cs1-golden', roots: ['#1', '#3', '#12'], test: 'rewrite/cloud/tests/app-cs1.test.ts' },
  { id: 'rw-cs2-golden', roots: ['#1', '#3', '#5', '#8'], test: 'rewrite/cloud/tests/app-cs2.test.ts' },
  { id: 'rw-admin1-golden', roots: ['#3', '#13'], test: 'rewrite/cloud/tests/app-admin1.test.ts' },
  { id: 'rw-admin2-golden', roots: ['#3', '#7', '#8'], test: 'rewrite/cloud/tests/app-admin2.test.ts' },
  { id: 'rw-admin3-golden', roots: ['#1', '#2', '#3', '#4', '#12'], test: 'rewrite/cloud/tests/app-admin3.test.ts' },
  { id: 'rw-admin4-golden', roots: ['#4', '#7', '#8'], test: 'rewrite/cloud/tests/app-admin4.test.ts' },
  { id: 'rw-admin5-golden', roots: ['#3', '#7', '#8'], test: 'rewrite/cloud/tests/app-admin5.test.ts' },
  { id: 'rw-admin6-golden', roots: ['#1', '#3', '#4'], test: 'rewrite/cloud/tests/app-admin6.test.ts' },
  { id: 'rw-scm-golden', roots: ['#1', '#2', '#4', '#7'], test: 'rewrite/cloud/tests/app-scm.test.ts' },
  { id: 'rw-misc-golden', roots: ['#1', '#3', '#7', '#13'], test: 'rewrite/cloud/tests/app-misc.test.ts' },
  { id: 'rw-anomaly-record-golden', roots: ['#3', '#14'], test: 'rewrite/cloud/tests/anomaly.test.ts' },
  { id: 'rw-inspect-golden', roots: ['#1', '#3', '#8', '#14'], test: 'rewrite/cloud/tests/inspect.test.ts' },
  { id: 'rw-ops-console-golden', roots: ['#3', '#14'], test: 'rewrite/cloud/tests/ops-console.test.ts' },
  { id: 'rw-bill-reconcile-golden', roots: ['#1', '#4', '#12', '#14'], test: 'rewrite/cloud/tests/bill-reconcile.test.ts' },
  { id: 'rw-mp-home-golden', roots: ['#8'], test: 'rewrite/mp/tests/home-map.test.ts' },
  { id: 'rw-mp-detail-golden', roots: ['#8'], test: 'rewrite/mp/tests/detail-map.test.ts' },
  { id: 'rw-mp-cart-golden', roots: ['#4', '#8'], test: 'rewrite/mp/tests/cart.test.ts' },
  { id: 'rw-mp-checkout-golden', roots: ['#4', '#6', '#8'], test: 'rewrite/mp/tests/checkout.test.ts' },
  { id: 'rw-mp-pay-golden', roots: ['#4', '#8'], test: 'rewrite/mp/tests/pay-flow.test.ts' },
  { id: 'rw-mp-orders-golden', roots: ['#2', '#8'], test: 'rewrite/mp/tests/orders-map.test.ts' },
  { id: 'rw-mp-aftersales-golden', roots: ['#4', '#8'], test: 'rewrite/mp/tests/aftersales-map.test.ts' },
  { id: 'rw-mp-learning-golden', roots: ['#2', '#8'], test: 'rewrite/mp/tests/learning-map.test.ts' },
  { id: 'rw-mp-player-golden', roots: ['#7', '#8'], test: 'rewrite/mp/tests/player.test.ts' },
  { id: 'rw-mp-reviews-golden', roots: ['#8'], test: 'rewrite/mp/tests/reviews-map.test.ts' },
  { id: 'rw-mp-me-golden', roots: ['#6', '#8'], test: 'rewrite/mp/tests/continue-resolve.test.ts' },
  { id: 'rw-mp-list-incremental-golden', roots: ['#7', '#8'], test: 'rewrite/mp/tests/list-incremental.test.ts' },
  { id: 'rw-mp-privacy-golden', roots: ['R27', '#8'], test: 'rewrite/mp/tests/privacy-gate.test.ts' },
  { id: 'rw-mp-seek-wxs-golden', roots: ['#5', '#8'], test: 'rewrite/mp/tests/player-seek-wxs.test.ts' },
  { id: 'rw-admin-money-ui-golden', roots: ['#4', '#8', '#14'], test: 'rewrite/admin/tests/money-ui.test.ts' },
  { id: 'rw-admin-client-golden', roots: ['#3', '#5', '#14'], test: 'rewrite/admin/tests/client.test.ts' },
  { id: 'rw-admin-load-status-golden', roots: ['#14'], test: 'rewrite/admin/tests/status.test.ts' },
  { id: 'rw-admin-latest-golden', roots: ['#8'], test: 'rewrite/admin/tests/latest.test.ts' },
  { id: 'rw-admin-serialsave-golden', roots: ['#8'], test: 'rewrite/admin/tests/serialSave.test.ts' },
  { id: 'rw-admin-fulfill-golden', roots: ['#8'], test: 'rewrite/admin/tests/fulfill.test.ts' },
  { id: 'rw-admin-videobatch-golden', roots: ['#8'], test: 'rewrite/admin/tests/videobatch.test.ts' },
  { id: 'rw-admin-products-ui-golden', roots: ['#8'], test: 'rewrite/admin/tests/products-ui.test.ts' },
  { id: 'rw-admin-content-ui-golden', roots: ['#8', '#12'], test: 'rewrite/admin/tests/content-ui.test.ts' },
  { id: 'rw-admin-cs-ui-golden', roots: ['#8'], test: 'rewrite/admin/tests/cs-ui.test.ts' },
  { id: 'rw-admin-system-ui-golden', roots: ['#4', '#8'], test: 'rewrite/admin/tests/system-ui.test.ts' },
  { id: 'rw-admin-scm-ui-golden', roots: ['#4', '#8'], test: 'rewrite/admin/tests/scm-ui.test.ts' },
  { id: 'rw-admin-cards-golden', roots: ['#8'], test: 'rewrite/admin/tests/cards.test.ts' },
  { id: 'rw-admin-nav-contextual', roots: ['#8'], test: 'rewrite/admin/tests/nav.test.ts' },
  { id: 'rw-agent-ui-golden', roots: ['#8'], test: 'rewrite/agent/tests/desk.test.ts' },
  { id: 'rw-site-schema-golden', roots: ['#8'], test: 'rewrite/site/tests/schema.test.ts' },
]

export const repoChecks = [
  {
    id: 'rw-golden-registered',
    roots: [...new Set(RW_GOLDEN_REGISTRY.flatMap((r) => r.roots))],
    desc: '新线黄金用例注册表守卫（收敛阀·元模式 A2「守卫粒度会收敛」）：rewrite 各模块的 rw-*-golden 逐条 typeAndTestGuards 指针折为 RW_GOLDEN_REGISTRY 一张表 + 本一条守卫，核每条登记的 golden 测试文件真实存在（防注册表指向已删测试空转）；roots 取全表并集、病根覆盖不丢。新增 rewrite 模块只加表行、不加守卫',
    run() {
      const bad = []
      for (const g of RW_GOLDEN_REGISTRY) {
        if (!existsSync(join(ROOT, g.test)))
          bad.push(`${g.id} 的 golden 测试缺失：${g.test}——注册表指向不存在的测试（守卫空转）`)
      }
      return bad
    },
  },
  {
    id: 'stub-only-sdk',
    roots: ['基建'],
    desc: '测试地基：任何包对 wx-server-sdk 的依赖必须是 file: 内存桩，绝不引真实 sdk',
    run() {
      const bad = []
      for (const p of listPackageJsons()) {
        const json = JSON.parse(readFileSync(join(ROOT, p), 'utf8'))
        for (const field of ['dependencies', 'devDependencies']) {
          const v = json[field]?.['wx-server-sdk']
          if (v && !String(v).startsWith('file:')) {
            bad.push(`${p} 的 ${field}.wx-server-sdk="${v}"——必须 file: 内存桩（引真 sdk 测试会触网/触真云，回归网失效）`)
          }
        }
      }
      return bad
    },
  },
  {
    id: 'gate-single-source',
    roots: ['铁律'],
    desc: '三道闸单一定义：pre-commit 与 CI 都只调 `npm run check`（防三闸语义悄悄漂移）',
    run() {
      const bad = []
      for (const f of ['scripts/git-hooks/pre-commit', '.github/workflows/ci.yml']) {
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 不存在（三道闸缺一）`)
        } else if (!/npm run check\b/.test(readFileSync(abs, 'utf8'))) {
          bad.push(`${f} 未统一调用 \`npm run check\`——三道闸须以 check 脚本为单一定义，防漂移`)
        }
      }
      return bad
    },
  },
  {
    id: 'seed-single-source',
    roots: ['#5', 'T3'],
    desc: '种子单一来源（根因#5）：canonical 在 shared/src/seed/*；miniapp data 视图须派生自它，不得回潮内联',
    run() {
      const bad = []
      const pairs = [
        ['packages/shared/src/seed/products.ts', 'packages/miniapp/src/data/catalog.js'],
        ['packages/shared/src/seed/course.ts', 'packages/miniapp/src/data/course.js'],
      ]
      for (const [canonical, view] of pairs) {
        if (!existsSync(join(ROOT, canonical))) bad.push(`${canonical} 缺失（种子 canonical 源）`)
        const abs = join(ROOT, view)
        if (!existsSync(abs)) bad.push(`${view} 缺失`)
        else if (!/from\s+['"]@luckyducky\/shared['"]/.test(readFileSync(abs, 'utf8'))) {
          bad.push(`${view} 未派生自 @luckyducky/shared——种子须单一来源，不得在此内联`)
        }
      }
      return bad
    },
  },
  {
    id: 'checkout-single-source',
    roots: ['#5', '#6'],
    desc: '结算搭配/券/运费单一来源（根因#5 复制即漂移 / #6 镜像靠注释维系）：canonical 在 shared/src/seed/checkout.ts；云端 createOrder（权威定价）与 miniapp data/checkout（UI）均从 shared 派生，杜绝逐字镜像',
    run() {
      const bad = []
      const canonical = 'packages/shared/src/seed/checkout.ts'
      if (!existsSync(join(ROOT, canonical))) bad.push(`${canonical} 缺失（结算常量 canonical 源）`)
      const consumers = [
        ['packages/cloud/src/functions/orders/createOrder.ts', /CHECKOUT_ADDONS/],
        ['packages/miniapp/src/data/checkout.js', /from\s+['"]@luckyducky\/shared['"]/],
      ]
      for (const [f, derives] of consumers) {
        const abs = join(ROOT, f)
        if (!existsSync(abs)) bad.push(`${f} 缺失`)
        else if (!derives.test(readFileSync(abs, 'utf8'))) {
          bad.push(`${f} 未从 @luckyducky/shared 派生结算常量——禁逐字镜像（根因#5/#6）`)
        }
      }
      return bad
    },
  },
  {
    id: 'cloud-domain-grouped',
    roots: ['T2'],
    desc: 'T2 域分组：云函数源须在 functions/<域>/ 下，functions/ 顶层不得有裸 .ts（部署单元按域不散落）',
    run() {
      const dir = join(ROOT, 'packages/cloud/src/functions')
      if (!existsSync(dir)) return []
      const bad = []
      for (const entry of lsScan(dir)) {
        if (statSync(join(dir, entry)).isFile() && entry.endsWith('.ts')) {
          bad.push(`packages/cloud/src/functions/${entry} 在顶层——函数须放进域子目录（catalog/learning/orders/user/system/admin，T2）`)
        }
      }
      return bad
    },
  },
  {
    id: 'flow-seam-single',
    roots: ['#12'],
    desc: '平台接缝单点（根因#12 平台规则外部风险）：cloudbase_module 工作流调用全库仅 kit/flow.ts 一处（callFlow），平台规则变化改动面最小',
    run() {
      const root = join(ROOT, 'packages/cloud/src')
      if (!existsSync(root)) return []
      const allowed = 'packages/cloud/src/kit/flow.ts'
      const hits = []
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts') && readFileSync(p, 'utf8').includes("'cloudbase_module'")) hits.push(relative(ROOT, p))
        }
      }
      walk(root)
      const out = []
      for (const h of hits) if (h !== allowed) out.push(`${h} 直调 cloudbase_module——接缝须收口 kit callFlow 单点（根因#12）`)
      if (!hits.includes(allowed)) out.push(`${allowed} 应为 cloudbase_module 唯一调用点（callFlow），未见——接缝单点缺失`)
      return out
    },
  },
  {
    // 微信发货上传接缝单点（根因#12 平台规则外部风险 + 合规债#26）：实物 + 微信支付小程序支付后须上传
    // 发货信息（upload_shipping_info），否则订单资金冻结/无法结算 + 后台反复弹「待接入发货管理」。
    // ① 发货上传调用（uploadShippingInfo）只许在 kit/shipping.ts 接缝单点（别处直调即红·平台规则变化改一处）；
    // ② adminApi shipOrder 成功路径须经 uploadShippingToWx（防回退成只写本地·真顾客订单钱被锁）。
    // fail-soft 行为（上传失败不反噬本地发货 + 留痕 + [LD_ALERT] 告警）由 shipOrder.test 行为锁。
    id: 'shipping-info-uploaded-to-wx',
    roots: ['#12'],
    desc: '微信发货上传接缝单点（根因#12 + 合规债#26）：upload_shipping_info 调用收口 kit/shipping.ts（别处直调即红）+ adminApi shipOrder 成功路径须调 uploadShippingToWx（不上传→实物+微信支付资金冻结）',
    run() {
      const seam = 'packages/cloud/src/kit/shipping.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——微信发货上传接缝单点（合规债#26·根因#12）`]
      const bad = []
      if (!/uploadShippingInfo/.test(readFileSync(join(ROOT, seam), 'utf8')))
        bad.push(`${seam} 未见 uploadShippingInfo 上传调用——接缝空壳（债#26）`)
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (rel !== seam && /uploadShippingInfo/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 直调 uploadShippingInfo——发货上传须收口 kit/shipping.ts 接缝单点（根因#12·债#26）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      const ship = join(ROOT, 'packages/cloud/src/functions/admin/adminApi/actions/orders.ts')
      if (existsSync(ship) && !/uploadShippingToWx\s*\(/.test(readFileSync(ship, 'utf8')))
        bad.push('adminApi shipOrder 未调 uploadShippingToWx——发货后未向微信上传发货信息（实物+微信支付资金会被冻结·合规债#26·根因#12）')
      return bad
    },
  },
  {
    // 云调用权限随产物声明并真部署（根因#12 平台接缝 + 合规债#26 + 根因#8 部署≠生效）：用 cloud.openapi.<ns>.<method>
    // 的云函数（现仅发货上传 wxaSecOrder.uploadShippingInfo），其部署产物 dist/<fn>/config.json 必声明该 openapi
    // 权限——否则云调用被微信拒（权限不足 errcode）、发货信息永远传不上去（实物+微信支付资金冻结·债#26）。
    // 端到端三关：① build.mjs 按产物检测用到的云调用、产 config.json（同 usesManager 检测路子·权限串=JS 调用路径）；
    // ② 源里每个 cloud.openapi 调用路径都在 build.mjs OPENAPI_PERMS 登记（漏登记=产物缺权限）；③ deploy-fns.mjs 的
    // 部署 hash 必纳入 config.json——否则只改 config.json（如改 openapi 权限）时 index.js 不变 → hash 不变 → 漂移
    // 检测漏判「待部署」→ 权限永远没真上去（根因#8 部署≠生效·实测：本债加 config.json 后 deploy-fns 报「待部署 0」）。
    id: 'openapi-perm-declared',
    roots: ['#12', '#8'],
    desc: '云调用权限随产物声明并真部署（根因#12/#8·债#26）：cloud 源每个 cloud.openapi.<ns>.<method> 调用须在 build.mjs OPENAPI_PERMS 登记（据此产 config.json）+ deploy-fns hash 须纳入 config.json——否则产物缺权限或改权限不重部署·云调用被拒·发货上传不生效',
    run() {
      const bad = []
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const calls = new Set()
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts'))
            for (const m of readFileSync(p, 'utf8').matchAll(/\.openapi\.(\w+)\.(\w+)/g)) calls.add(`${m[1]}.${m[2]}`)
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      const buildMjs = join(ROOT, 'packages/cloud/build.mjs')
      if (!existsSync(buildMjs)) return ['packages/cloud/build.mjs 缺失——云调用权限声明机制（债#26·根因#12）']
      const build = readFileSync(buildMjs, 'utf8')
      if (!/OPENAPI_PERMS/.test(build) || !/config\.json/.test(build))
        bad.push('build.mjs 未见 OPENAPI_PERMS 登记或 config.json 产出——部署产物不带 openapi 权限声明（云调用失败·债#26·根因#12）')
      for (const c of calls)
        if (!build.includes(`'${c}'`) && !build.includes(`"${c}"`))
          bad.push(`云调用 cloud.openapi.${c} 未在 build.mjs OPENAPI_PERMS 登记——部署产物 config.json 缺权限「${c}」·云调用会被微信拒（根因#12·债#26）`)
      // ③ 部署侧：有云调用（=会产 config.json）时，deploy-fns 的部署 hash 必把 config.json 真喂进 hash，否则改权限
      // 不重部署。校验真实代码模式（'config.json') 路径构造后近距出现 .update(readFileSync——喂入 hash），不认注释里
      // 的 config.json 字样（防关键词存在=假绿·宽松匹配踩坑教训：注释提及不等于功能存在）。
      if (calls.size) {
        const deployFns = join(ROOT, 'scripts/deploy-fns.mjs')
        if (!existsSync(deployFns)) bad.push('scripts/deploy-fns.mjs 缺失——无法核「config.json 改动触发重部署」（根因#8·债#26）')
        // 两种等价形状都认：直连 `join(..., 'config.json')…update(readFileSync` 或批3 的数组循环
        // `['config.json', 'package.json'] … update(readFileSync(fp)`（意图同一：config.json 参与部署 hash）
        else if (!/'config\.json'[\s\S]{0,240}?\.update\(\s*readFileSync/.test(readFileSync(deployFns, 'utf8')))
          bad.push('scripts/deploy-fns.mjs 部署 hash 未把 config.json 喂进 hash——只改 openapi 权限（config.json）时漂移检测漏判·权限永不部署（根因#8 部署≠生效·债#26）')
      }
      return bad
    },
  },
  {
    // 云库 set 不得在 data 里带 _id（根因#8 桩≠真 SDK 藏过的坑）：真 wx-server-sdk `doc(id).set({data})` 的
    // data 含 _id 即 reject（_id 由 doc(id) 指定）。藏过 4 处：saveSettings（`{...cur}` 把 get 回来的 _id 带回·
    // 真机 500）、wecom getAccessToken token 缓存 / kfCallback cursor 缓存（fail-soft `.catch(()=>{})` 静默废·
    // 每次重取）、kfBind 映射（写不进）。测试桩已对齐「set data 含 _id 即抛」；本守卫静态再补一道扫**字面**
    // `.set({ data: { …_id… } })`（`.add` 合法带 _id 不在此列；隐式 `{...cur}` 由桩 + 往返测试兜）。
    id: 'no-id-in-set-data',
    roots: ['#8'],
    desc: '云库 set 不带 _id（根因#8 桩≠真 SDK）：wx-server-sdk doc(id).set({data}) 的 data 含 _id 即真机 reject（_id 由 doc(id) 定）——禁字面 .set({data:{…_id…}})（.add 合法带 _id 例外；隐式 {...cur} 由桩+往返测试兜）',
    run() {
      const bad = []
      const root = join(ROOT, 'packages/cloud/src')
      const walkSet = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walkSet(p)
          else if (e.endsWith('.ts') && /\.set\(\{\s*data:\s*\{[^}]*\b_id\b/.test(readFileSync(p, 'utf8')))
            bad.push(
              `${relative(ROOT, p).replace(/\\/g, '/')} 在 .set({data:{…}}) 里带 _id——真 sdk 会 reject（_id 由 doc(id) 指定·根因#8）·改用 doc(id) + data 去掉 _id；.add 才合法带 _id`
            )
        }
      }
      if (existsSync(root)) walkSet(root)
      return bad
    },
  },
  {
    // 商品下架生效（债#12）：原 publishProduct 写 products 后永久可售（getProducts 全量下发·featured 只管橱窗·
    // deleteDraft 是硬删非停售）——无「临时停售」路径。本守卫锁 getProducts 必按 listed 过滤（where listed!=false·
    // 兼容旧无字段=可售），防回退成全量下发把已停售商品又露给顾客；停售/恢复经 adminApi unpublishProduct/republishProduct。
    id: 'catalog-getproducts-listed-filter',
    roots: ['债#12'],
    desc: '商品下架生效（债#12）：catalog/getProducts.ts 须按 listed 过滤（listed!=false·兼容旧无字段=可售）——防已停售商品仍全量下发给顾客；停售/恢复经 adminApi unpublishProduct/republishProduct',
    run() {
      const f = 'packages/cloud/src/functions/catalog/getProducts.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（商品列表·债#12）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      // 须是真正的 where 过滤含 listed（不认注释里的 listed 字样·防只留注释假绿）
      if (!/\.where\(\{[^}]*listed/.test(src))
        bad.push(`${f} 未按 listed 过滤（.where({...listed...}) 未见）——已停售商品仍全量下发给顾客（债#12·下架不生效）`)
      return bad
    },
  },
  {
    // 生产初始态零内置真实收货地址（根因#6 演示回退泄漏·外审 R1-R4·P1.6）：data/address.js 的 SAMPLE_ADDRESS
    // 是演示/H5 回退样本，曾被 address store 初始 state 直接播一条（list:[{...SAMPLE_ADDRESS,id:1}]）——真支付一开，
    // 首购用户没改地址就下单会误发到样例人（陈圆圆/杭州）致错发货+售后。锁 store 初始 list 必须为空 + 不得引
    // SAMPLE_ADDRESS；空态由结算页「请先添加收货地址」既有路径兜（checkout/index.vue addr=null 已处理）。
    id: 'address-no-sample-seed',
    roots: ['#6'],
    desc: '生产初始态零内置收货地址（根因#6·外审 P1.6）：store/address.js 初始 list 须空 + 不引 SAMPLE_ADDRESS——防样例地址误进真实下单链路致错发货',
    run() {
      const f = 'packages/miniapp/src/store/address.js'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（地址簿 store）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (/SAMPLE_ADDRESS/.test(src))
        bad.push(`${f} 引用 SAMPLE_ADDRESS——样例地址混入生产初始态（误发货·根因#6·外审 P1.6）`)
      // 初始 state 须 list: []（空数组容空白）——非空即内置了地址
      if (!/list:\s*\[\s*\]/.test(src))
        bad.push(`${f} 初始 list 非空——生产不得内置收货地址（空态由结算页引导新增·外审 P1.6）`)
      return bad
    },
  },
  {
    // 客服小程序卡片 pagepath 须为已注册路由（根因#8 桩过≠真机能开·外审 R1-R4·P2.11）：cs/kfCallback/dispatch.ts
    // 的 miniprogram route 写死 page 字符串，曾写错 pages/aftersale（少 s·实际 aftersales）、pages/course（实际在
    // pkg-video 分包 = pkg-video/courses/index）——桩测把错路径锁成假绿，真机点卡片打不开目标页。锁每个 page 都在
    // pages.json 注册（主包 path + 分包 root/path），路由改名/迁分包后客服卡片当场红。
    id: 'kf-card-page-registered',
    roots: ['#8'],
    desc: '客服卡片 pagepath 须为小程序已注册路由（根因#8·外审 P2.11）：旧线 packages/cloud dispatch.ts×pages.json + 新线 rewrite/cloud dispatch.ts×rewrite/mp/app.json（主包 pages + subPackages root/path）双面扫——防卡片跳不存在页真机打不开。课程链路审计 2026-07-17 扩新线面：原只扫旧线冻结参照，新线死链（pkg-video 分包路径从未落地）在守卫真空里假绿',
    run() {
      const bad = []
      // 面1：旧线冻结参照（uni-app pages.json）
      const dispatch = 'packages/cloud/src/functions/cs/kfCallback/dispatch.ts'
      const pagesJson = 'packages/miniapp/src/pages.json'
      if (existsSync(join(ROOT, dispatch)) && existsSync(join(ROOT, pagesJson))) {
        const reg = new Set()
        try {
          const pj = JSON.parse(readFileSync(join(ROOT, pagesJson), 'utf8'))
          ;(pj.pages || []).forEach((p) => reg.add(p.path))
          ;(pj.subPackages || []).forEach((sp) => (sp.pages || []).forEach((p) => reg.add(`${sp.root}/${p.path}`)))
        } catch {
          bad.push(`${pagesJson} 解析失败——无法校验客服卡片路由`)
        }
        const src = readFileSync(join(ROOT, dispatch), 'utf8')
        for (const m of src.matchAll(/page:\s*'([^']+)'/g)) {
          if (reg.size && !reg.has(m[1]))
            bad.push(`${dispatch} 客服卡片 page '${m[1]}' 不是 pages.json 已注册路由——真机点卡片打不开（根因#8·外审 P2.11）`)
        }
      }
      // 面2：新线（原生小程序 app.json·真正部署面）
      const rwDispatch = 'rewrite/cloud/src/functions/cs/kfCallback/dispatch.ts'
      const rwAppJson = 'rewrite/mp/app.json'
      if (existsSync(join(ROOT, rwDispatch)) && existsSync(join(ROOT, rwAppJson))) {
        const reg = new Set()
        try {
          const aj = JSON.parse(readFileSync(join(ROOT, rwAppJson), 'utf8'))
          ;(aj.pages || []).forEach((p) => reg.add(p))
          ;(aj.subPackages || []).forEach((sp) => (sp.pages || []).forEach((p) => reg.add(`${sp.root}/${p}`)))
        } catch {
          bad.push(`${rwAppJson} 解析失败——无法校验客服卡片路由（新线）`)
        }
        const src = readFileSync(join(ROOT, rwDispatch), 'utf8')
        for (const m of src.matchAll(/page:\s*'([^']+)'/g)) {
          if (reg.size && !reg.has(m[1]))
            bad.push(`${rwDispatch} 客服卡片 page '${m[1]}' 不是 app.json 已注册路由——真机点卡片打不开（根因#8·课程链路审计 2026-07-17）`)
        }
      }
      return bad
    },
  },
  {
    // 同意退款前复核进课退货权（外审 R1-R4·P1.2·根因#1 副作用绑状态机）：用户先申请退款（applied）后又确认进课时，
    // confirmEnter 把该订单行 refundable 翻 false（退货权失效·链6）；approveRefund 若只查售后状态不复核订单行，会形成
    // 「已交付课程 + 已退款」。锁 approveRefund 触发退款前读订单行 refundable、已撤即拒 ENTERED_NOT_REFUNDABLE。
    id: 'approve-refund-rechecks-entered',
    roots: ['#1'],
    desc: '同意退款前复核进课退货权（根因#1·外审 P1.2）：admin/adminApi/actions/refunds.ts approveRefund 触发退款工作流前须读该订单行 refundable、已撤(进课)即拒 ENTERED_NOT_REFUNDABLE——防"已交付课程+已退款"',
    run() {
      const f = 'packages/cloud/src/functions/admin/adminApi/actions/refunds.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（售后退款动作）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/ENTERED_NOT_REFUNDABLE/.test(src))
        bad.push(`${f} approveRefund 未复核进课退货权（缺 ENTERED_NOT_REFUNDABLE）——可"已交付课程+已退款"（根因#1·外审 P1.2）`)
      if (!/refundable\s*===\s*false/.test(src))
        bad.push(`${f} approveRefund 未读订单行 refundable 复核——进课撤退货权后仍触发退款（外审 P1.2）`)
      return bad
    },
  },
  {
    // 管理端写库存须 CAS 防覆盖并发预留（外审 R1-R4·P1.8·根因#1 并发正确性）：绝对写若无条件 set，管理员开旧页面
    // 保存会把「下单并发预留扣减后的库存」覆盖回旧值 → 超卖窗口。锁 kit/inventory.ts setStock 接 expectedUpdatedAt
    // 走条件写（where{updatedAt}+冲突返 conflict）；adminApi saveStock 须透传并把冲突映射 STOCK_CONFLICT 提示刷新。
    id: 'stock-cas-conditional-save',
    roots: ['#1'],
    desc: '管理端写库存 CAS 防覆盖并发预留（根因#1·外审 P1.8）：kit/inventory.ts setStock 须接 expectedUpdatedAt 条件写(where{updatedAt}+conflict)；adminApi/actions/inventory.ts saveStock 须透传并映射 STOCK_CONFLICT——防旧页面覆盖预留致超卖',
    run() {
      const kit = 'packages/cloud/src/kit/inventory.ts'
      const action = 'packages/cloud/src/functions/admin/adminApi/actions/inventory.ts'
      if (!existsSync(join(ROOT, kit))) return [`${kit} 缺失（库存原语）`]
      const bad = []
      const ks = readFileSync(join(ROOT, kit), 'utf8')
      if (!/expectedUpdatedAt/.test(ks))
        bad.push(`${kit} setStock 未接 expectedUpdatedAt——绝对写无 CAS 会覆盖并发预留(超卖·根因#1·外审 P1.8)`)
      if (!/where\(\{[^}]*updatedAt[^}]*\}\)/.test(ks) || !/conflict:\s*true/.test(ks))
        bad.push(`${kit} setStock 未走条件写(where{updatedAt})+conflict:true——CAS 防覆盖缺失(外审 P1.8)`)
      if (existsSync(join(ROOT, action))) {
        const as = readFileSync(join(ROOT, action), 'utf8')
        if (!/expectedUpdatedAt/.test(as) || !/STOCK_CONFLICT/.test(as))
          bad.push(`${action} saveStock 未透传 expectedUpdatedAt / 未映射 STOCK_CONFLICT——CAS 未接通(外审 P1.8)`)
      }
      return bad
    },
  },
  {
    // 客服认领去重须区分撞号 vs 基建错（外审 R1-R4·P1.4·根因#8 桩过≠真机能用）：firstSeen 旧实现把 add 任何异常都当
    // 「已处理·跳过」，DB 权限/集合缺/瞬时错被当重复 → 真实客服消息无回复无告警不重试＝永久吞消息。锁 firstSeen 三态
    // (first/duplicate/error)、add 失败回查 seen 文档存在性区分；processKfBatch 对 error 必告警 CLAIM_FAILED + anyFailed。
    id: 'kf-claim-distinguishes-infra',
    roots: ['#8'],
    desc: '客服认领区分撞号 vs 基建错（根因#8·外审 P1.4）：cs/kfCallback/dispatch.ts firstSeen 须三态(first/duplicate/error)、add 失败回查 seen 文档存在性区分；基建错(error)经 CLAIM_FAILED 告警+anyFailed 保留游标重试——防基建错被当重复静默吞消息',
    run() {
      const f = 'packages/cloud/src/functions/cs/kfCallback/dispatch.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（客服分流）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/'error'/.test(src) || !/'duplicate'/.test(src))
        bad.push(`${f} firstSeen 未区分基建错(error)/撞号(duplicate)——基建错被当重复会永久吞消息(根因#8·外审 P1.4)`)
      if (!/CLAIM_FAILED/.test(src))
        bad.push(`${f} 认领基建错未告警 CLAIM_FAILED——静默吞消息无可观测(外审 P1.4)`)
      return bad
    },
  },
  {
    // 知识库单源（后台360工作站 B4.1·根因#5 样板复制即漂移）：客服 bot 的 FAQ 答案原写死在 dispatch.ts 的
    // TEXT_ANSWERS map，admin 改不了、与知识库两处漂移。锁 FAQ 答案只从 kb 集合单源取——dispatch 须读 kb
    // （COLLECTIONS.kb）发答案、不得残留写死 FAQ 答案 map（TEXT_ANSWERS）；admin 经 listKb/saveKb 维护 kb，
    // bot/坐席共用同一份答案。改答案只改 kb 一处，杜绝两份漂移。
    id: 'faq-via-kb-single-source',
    roots: ['#5'],
    desc: 'FAQ 答案只从 kb 单源（后台360工作站 B4.1·根因#5）：cs/kfCallback/dispatch.ts 须读 kb 集合（COLLECTIONS.kb / .collection("kb")）发 FAQ 答案、不得残留写死 FAQ 答案 map（TEXT_ANSWERS 字面量答案）——防 bot 答案与 admin 维护的知识库两处漂移',
    run() {
      const f = 'packages/cloud/src/functions/cs/kfCallback/dispatch.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（客服分流·B4.1）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/COLLECTIONS\.kb|\.collection\(\s*['"]kb['"]\s*\)/.test(src))
        bad.push(`${f} 未读 kb 集合——FAQ 答案须从 kb 单源取（B4.1·根因#5·防写死漂移）`)
      if (/TEXT_ANSWERS/.test(src))
        bad.push(`${f} 残留写死 FAQ 答案 map（TEXT_ANSWERS）——FAQ 答案须只在 kb 单源（B4.1·根因#5）`)
      // 扩面（批 B8·R37b）：新线公开读 getPublicFaq 同守此单源——须真读 kb 集合，且不得内联 FAQ 数据
      // （title/content 挂字符串字面量＝写死答案，admin 改不动、与 kb 两处漂移）。
      const rf = 'rewrite/cloud/src/functions/app/actions/faq.ts'
      if (!existsSync(join(ROOT, rf))) {
        bad.push(`${rf} 缺失（R37b 公开 FAQ 读·批 B8）`)
      } else {
        const rsrc = readFileSync(join(ROOT, rf), 'utf8')
        if (!/COLLECTIONS\.kb|\.collection\(\s*['"]kb['"]\s*\)/.test(rsrc))
          bad.push(`${rf} 未读 kb 集合——公开 FAQ 须从 kb 单源取（R37b·根因#5）`)
        if (/(title|content)\s*:\s*['"`][^'"`]{2,}/.test(rsrc))
          bad.push(`${rf} 疑似内联写死 FAQ 数据（title/content 字符串字面量）——FAQ 数据须只在 kb 单源、经真实查询映射（R37b·根因#5）`)
      }
      return bad
    },
  },
  {
    // CSAT 评分入库前必校验 1..5（后台360工作站 B4.3·根因#3 不信前端）：满意度均分是业务信号，伪造/越界分
    // （rate:9 / 负数 / 非数）混入会污染均分。锁 dispatch.ts recordCsat 须 fail-closed 校验 score∈1..5 才入库——
    // 去掉边界判断当场红。
    id: 'csat-score-bounded',
    roots: ['#3'],
    desc: 'CSAT 评分入库前校验 1..5（后台360工作站 B4.3·根因#3 不信前端）+ 关单评分闭环（深审 F2）：recordCsat 须校验 score∈1..5 才入库（越界/伪造分 fail-closed）；closeConversation 发「回复 1-5 分」提示须立 csatask 标记、dispatch 须消费该标记记分——两端缺一即「提示说了没人认」评分链断（曾发生·顾客照做分数丢失）',
    run() {
      const f = 'packages/cloud/src/functions/cs/kfCallback/dispatch.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（客服分流·B4.3）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/recordCsat/.test(src)) bad.push(`${f} 缺 recordCsat——CSAT 评分入口缺失（B4.3）`)
      else if (!/score\s*>=\s*1/.test(src) || !/score\s*<=\s*5/.test(src))
        bad.push(`${f} recordCsat 未校验 score∈1..5——越界/伪造分会污染满意度均分（根因#3·B4.3）`)
      // 关单评分闭环（深审 F2）：dispatch 须有 csatask 标记消费路径（自由文本 1-5 记分）——否则关单提示「回复 1-5 分」无人认
      if (!/csatask:/.test(src)) bad.push(`${f} 缺 csatask 标记消费——关单提示「回复 1-5 分」顾客照做分数丢失（深审 F2·评分链断）`)
      const g = 'packages/cloud/src/functions/admin/adminApi/actions/agentDesk.ts'
      if (existsSync(join(ROOT, g))) {
        const gsrc = readFileSync(join(ROOT, g), 'utf8')
        if (/CSAT_PROMPT/.test(gsrc) && !/csatask:/.test(gsrc))
          bad.push(`${g} 发 CSAT_PROMPT 却不立 csatask 标记——dispatch 收到数字无凭据不记分（深审 F2·评分链断）`)
      }
      return bad
    },
  },
  {
    // 主动召回经唯一推送接缝（后台360工作站 B4.4·根因#12 平台接缝单点）：召回是「该主动联系的客户」运营摘要，
    // 推送须复用既有 botpush 单一接缝（经 kit/observe 的 notifyRecall），**不另起一套客服推送通道**（防散调/绕开关/
    // 凭证多处·与 bot-push-single-seam 同脉）。且 recallScan 自身不直拼 https 推送；纯决策 rules.ts 不碰 I/O（无
    // .collection/getDb/await·根因#8 决策与 I/O 分离·便于单测）。
    id: 'recall-via-bot-seam',
    roots: ['#12'],
    desc: '主动召回经唯一推送接缝（后台360工作站 B4.4·根因#12）：cs/recallScan/index.ts 须经 kit/observe 的 notifyRecall 推送（复用 botpush 单一接缝·不另起客服推送通道）且不直拼 https；纯决策 cs/recallScan/rules.ts 不碰 I/O（无 .collection/getDb/await·根因#8 便于单测）',
    run() {
      const dir = 'packages/cloud/src/functions/cs/recallScan'
      const idx = join(ROOT, dir, 'index.ts')
      const rules = join(ROOT, dir, 'rules.ts')
      if (!existsSync(idx)) return [`${dir}/index.ts 缺失（主动召回触发·B4.4）`]
      const bad = []
      const isrc = readFileSync(idx, 'utf8')
      if (!/notifyRecall/.test(isrc))
        bad.push(`${dir}/index.ts 未经 notifyRecall 推送——召回须复用 botpush 单一接缝（根因#12·别另起推送通道）`)
      if (/from\s+['"]https['"]|require\(\s*['"]https['"]\s*\)/.test(isrc))
        bad.push(`${dir}/index.ts 直拼 https 推送——召回推送须经 kit/observe 单一接缝（根因#12）`)
      if (!existsSync(rules)) bad.push(`${dir}/rules.ts 缺失（纯决策函数·B4.4·便于单测·根因#8）`)
      else if (/\.collection\(|getDb|await\s/.test(readFileSync(rules, 'utf8')))
        bad.push(`${dir}/rules.ts 含 I/O（.collection/getDb/await）——召回决策须纯函数（根因#8 便于单测·I/O 留 index.ts）`)
      return bad
    },
  },
  {
    // 客服回调防超时吞消息（外审 R1-R4·P1.5·根因#8）：函数超时 20s，单批 limit 旧默认 1000 逐条串行可能做不完 →
    // 已认领但副作用未完成时被硬超时杀掉、下次因 seen 跳过＝吞消息。锁 index.ts 单批 limit 有界(<200)且传 syncMsg +
    // 设墙钟时间预算(Date.now()-startedAt 临近超时停、保留旧游标续拉)——去掉预算或放大批量当场红。
    id: 'kf-callback-bounded-and-budgeted',
    roots: ['#8'],
    desc: '客服回调有界批量 + 墙钟预算防超时吞消息（根因#8·外审 P1.5）：cs/kfCallback/index.ts 须给 syncMsg 传有界 limit(<200) 且设时间预算(Date.now()-startedAt 临近 20s 超时停、保留旧游标续拉)——防大批量串行做不完被硬超时杀致吞消息',
    run() {
      const f = 'packages/cloud/src/functions/cs/kfCallback/index.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（客服回调）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      const lim = src.match(/KF_BATCH_LIMIT\s*=\s*(\d+)/)
      if (!lim || Number(lim[1]) >= 200 || !/syncMsg\([^)]*limit:/.test(src.replace(/\n/g, ' ')))
        bad.push(`${f} syncMsg 未传有界 limit(<200)——单批过大逐条串行可能超时吞消息(根因#8·外审 P1.5)`)
      if (!/Date\.now\(\)\s*-\s*startedAt/.test(src))
        bad.push(`${f} 缺墙钟时间预算(Date.now()-startedAt)——backlog/慢API 下可能在副作用未完成时被硬超时杀(外审 P1.5)`)
      return bad
    },
  },
  {
    // 订单行稳定身份 lineId（外审 R1-R4·P1.1·根因#1 唯一标识粒度不足·同 P1.9 batchId 一根）：order.items 行原靠
    // productId 定位（applyRefund/submitReview 找行 + 售后/评价确定性 _id=orderId__productId），同商品多 SKU 同单 →
    // _id 撞、退错/评错行、第二个 SKU 直接 ALREADY_APPLIED/REVIEWED。锁 createOrder 每行带 lineId（=productId__spec）；
    // applyRefund/submitReview 按有效行键定位 + 售后/评价 _id 用 lineId（orderId__lineId）——退回纯 orderId__productId 当 _id 即红。
    id: 'order-line-identity',
    roots: ['#1'],
    desc: '订单行稳定身份 lineId（根因#1·外审 P1.1）：createOrder 每行带 lineId；applyRefund/submitReview 按有效行键定位 + 售后/评价 _id=orderId__lineId（不再纯 orderId__productId·防同商品多 SKU 退错/评错行）',
    run() {
      const create = 'packages/cloud/src/functions/orders/createOrder.ts'
      const refund = 'packages/cloud/src/functions/orders/applyRefund.ts'
      const review = 'packages/cloud/src/functions/catalog/submitReview.ts'
      const bad = []
      if (existsSync(join(ROOT, create)) && !/lineId/.test(readFileSync(join(ROOT, create), 'utf8')))
        bad.push(`${create} 订单行未带 lineId——同商品多 SKU 无稳定行身份（根因#1·外审 P1.1）`)
      for (const f of [refund, review]) {
        if (!existsSync(join(ROOT, f))) continue
        const src = readFileSync(join(ROOT, f), 'utf8')
        if (!/lineId/.test(src))
          bad.push(`${f} 未按 lineId 定位订单行——同商品多 SKU 退错/评错行（外审 P1.1）`)
        // 旧形态（纯 orderId__productId 作确定性 _id）残留即红：同 productId 多 SKU 撞 _id
        if (/orderId\s*\+\s*'__'\s*\+\s*productId/.test(src) || /`\$\{orderId\}__\$\{productId\}`/.test(src))
          bad.push(`${f} 售后/评价 _id 仍用纯 orderId__productId——同商品多 SKU _id 撞（外审 P1.1）`)
      }
      return bad
    },
  },
  {
    // 进课件级 + 退剩余件数（外审 R1-R4·P1.3·根因#1 数量级权益不足）：refundable 原行级布尔，买 N 件进课 1 件即整行
    // 作废（剩 N-1 件白丢退货权）。锁 createOrder 行带 enteredQty（件级进课账）；confirmEnter 进课按件递增 enteredQty
    //（refundable=enteredQty<qty·非整行翻 false）；applyRefund 退 refundableQty=qty-enteredQty 件、金额按剩余件数摊（不再整行 item.qty）。
    id: 'refund-remaining-qty-after-enter',
    roots: ['#1'],
    desc: '进课件级 + 退剩余件数（根因#1·外审 P1.3 + 深审①②⑤ 2026-07-02）：createOrder 行带 enteredQty；confirmEnter 进课按件递增 enteredQty（非整行翻 refundable=false）且 items 写入过 entVer 版本位 CAS（防并发互覆盖少记件）；applyRefund 退 refundableQty=qty-enteredQty 件·金额按剩余件数摊；approveRefund 同意时按当下重算封顶（用户拍板）+ rejectRefund 条件更新原子化',
    run() {
      const create = 'packages/cloud/src/functions/orders/createOrder.ts'
      const enter = 'packages/cloud/src/functions/learning/confirmEnter.ts'
      const refund = 'packages/cloud/src/functions/orders/applyRefund.ts'
      const approve = 'packages/cloud/src/functions/admin/adminApi/actions/refunds.ts'
      const bad = []
      if (existsSync(join(ROOT, create)) && !/enteredQty/.test(readFileSync(join(ROOT, create), 'utf8')))
        bad.push(`${create} 订单行未带 enteredQty——无件级进课账（根因#1·外审 P1.3）`)
      if (existsSync(join(ROOT, enter))) {
        const src = readFileSync(join(ROOT, enter), 'utf8')
        if (!/enteredQty/.test(src))
          bad.push(`${enter} 进课未按件递增 enteredQty——仍整行作废退货权（买 N 进 1 废全行·外审 P1.3）`)
        if (!/entVer/.test(src))
          bad.push(`${enter} 进课件数写入无 entVer 版本位 CAS——同单并发进课整数组读-改-写互覆盖少记件数＝剩余可退虚高·可多退钱（深审⑤·根因#1）`)
      }
      if (existsSync(join(ROOT, refund))) {
        const src = readFileSync(join(ROOT, refund), 'utf8')
        if (!/refundableQty/.test(src) || !/enteredQty/.test(src))
          bad.push(`${refund} 未按 refundableQty=qty-enteredQty 退剩余件数——整行退/进课废全行（外审 P1.3）`)
      }
      if (existsSync(join(ROOT, approve))) {
        const src = readFileSync(join(ROOT, approve), 'utf8')
        if (!/refundableQty/.test(src))
          bad.push(`${approve} 同意退款未按当下重算剩余可退件封顶——申请后又进课仍按申请时件数打款＝多退钱（深审①·用户拍板重算封顶）`)
        const grabs = src.match(/status:\s*'applied'\s*\}\)/g) || []
        if (grabs.length < 2)
          bad.push(`${approve} rejectRefund 未条件更新（where status:'applied'）——与同意竞态可把 approved 打回 rejected·钱退了状态错（深审②）`)
      }
      return bad
    },
  },
  {
    // 登出清用户态本地数据（外审 R1-R4·P1.7·根因#3 信任边界·PII）：logout 原只清 user store，address（持久化姓名/
    // 电话/收货地址＝PII）/cart 等仍在 → 同设备换账号新用户看见并误用上一位的收货信息。锁 logout() 须 $reset 全部用户态 store。
    id: 'logout-resets-user-scoped',
    roots: ['#3'],
    desc: '登出清用户态本地数据防换账号 PII 泄露（根因#3·外审 P1.7）：store/user.js logout() 须 $reset address/cart/orders/aftersales/progress/activation——防同设备换账号泄露上一位地址(PII)/购物车/订单',
    run() {
      const f = 'packages/miniapp/src/store/user.js'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（用户 store）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const need = ['useAddressStore', 'useCartStore', 'useOrdersStore', 'useAfterSalesStore', 'useProgressStore', 'useActivationStore']
      const bad = []
      for (const s of need) {
        if (!new RegExp(s + '\\(\\)\\.\\$reset').test(src))
          bad.push(`${f} logout 未 ${s}().$reset()——换账号残留用户态(PII 泄露·根因#3·外审 P1.7)`)
      }
      return bad
    },
  },
  {
    // 企微群机器人告警推送单一收口（债#23续·根因#13 可观测落地 + #12 平台接缝单点）：钱链/安全告警的
    // 群机器人推送只经 kit/botpush.ts(pushBotAlert)、业务码一律经 kit/observe 的 notifyAlert——杜绝散调
    // （重复推/绕开关/webhook 凭证多处）。除 botpush(定义) 与 observe(唯一调用) 外，cloud/src 不得引用 pushBotAlert/botpush。
    id: 'bot-push-single-seam',
    roots: ['#13', '债#23'],
    desc: '企微推送单一收口（债#23续·根因#13/#12）：pushBotAlert 仅定义于 kit/botpush.ts、仅 kit/observe.ts(notifyAlert) 调用；其余 packages/cloud/src 不得 import botpush 或调 pushBotAlert（防散调/绕开关/凭证多处）',
    run() {
      const seam = 'packages/cloud/src/kit/botpush.ts'
      const caller = 'packages/cloud/src/kit/observe.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——企微推送接缝单点（债#23续·根因#13）`]
      const bad = []
      if (!/export\s+async\s+function\s+pushBotAlert/.test(readFileSync(join(ROOT, seam), 'utf8')))
        bad.push(`${seam} 未导出 pushBotAlert——接缝空壳`)
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (rel === seam || rel === caller) continue
            if (/pushBotAlert|['"][^'"]*\/botpush['"]/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 直达 pushBotAlert/botpush——企微推送须经 kit/observe.notifyAlert 单一收口（债#23续·根因#12）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      if (existsSync(join(ROOT, caller)) && !/pushBotAlert/.test(readFileSync(join(ROOT, caller), 'utf8')))
        bad.push(`${caller}(notifyAlert) 未调 pushBotAlert——接缝未接通（死代码）`)
      return bad
    },
  },
  {
    // 企微推送单一收口·重写线（观测批5·治病根#14「告警不进人眼」+ 根因#13/#12 接缝单点·同旧线 bot-push-single-seam）：
    // pushBotAlert 仅定义于 rewrite/cloud/src/kit/botpush.ts、仅 kit/observe.ts(notifyAlert) 调；其余 rewrite/cloud/src
    // 不得直达（防散调/绕 alertEvents 开关/webhook 凭证多处）。归 #14（告警真达人眼）+ #12/#13（接缝单点/爆破）。
    id: 'rw-bot-push-single-seam',
    roots: ['#12', '#13', '#14'],
    desc: '企微推送单一收口·重写线：pushBotAlert 仅在 rewrite/cloud/src/kit/botpush.ts 定义、仅 kit/observe.ts 调用；其余不得直达（防散调/绕开关/凭证多处·根因#13/#12）',
    run() {
      const seam = 'rewrite/cloud/src/kit/botpush.ts'
      const caller = 'rewrite/cloud/src/kit/observe.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——企微推送接缝单点（重写线·根因#13）`]
      const bad = []
      if (!/export\s+async\s+function\s+pushBotAlert/.test(readFileSync(join(ROOT, seam), 'utf8')))
        bad.push(`${seam} 未导出 pushBotAlert——接缝空壳`)
      const srcRoot = join(ROOT, 'rewrite/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (rel === seam || rel === caller) continue
            if (/pushBotAlert|['"][^'"]*\/botpush['"]/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 直达 pushBotAlert/botpush——企微推送须经 kit/observe.notifyAlert 单一收口（重写线·根因#12）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      if (existsSync(join(ROOT, caller)) && !/pushBotAlert/.test(readFileSync(join(ROOT, caller), 'utf8')))
        bad.push(`${caller}(notifyAlert) 未调 pushBotAlert——接缝未接通（死代码）`)
      return bad
    },
  },
  {
    // 应用消息单一收口（M⑦ 承面C 增强·推送线·根因#12 平台接缝单点）：企业微信「应用消息」（message/send·带
    // agentid·主动推坐席手机）只经 kit/wecom.ts 出——sendAppMessage 是唯一调 message/send 的原始接缝、
    // sendAgentCard 是唯一 fail-soft 编排。其余 packages/cloud/src 不得出现 message/send 字面量（防散调/绕
    // agentid 配置/令牌多处）；调用方（kfCallback dispatch / agentDesk）经 kit sendAgentCard 推送、不直拼。
    id: 'app-message-single-seam',
    roots: ['#12'],
    desc: '应用消息单一收口（M⑦ 推送线·根因#12）：企业微信 message/send（应用消息·推坐席手机）只经 kit/wecom.ts（sendAppMessage 原始接缝 + sendAgentCard fail-soft 编排）；其余 cloud/src 不得出现 message/send 字面量（防散调/绕 agentid/令牌多处），推送经 kit sendAgentCard',
    run() {
      const seam = 'packages/cloud/src/kit/wecom.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——应用消息接缝单点（M⑦·根因#12）`]
      const bad = []
      const seamSrc = readFileSync(join(ROOT, seam), 'utf8')
      if (!/export\s+async\s+function\s+sendAppMessage/.test(seamSrc))
        bad.push(`${seam} 未导出 sendAppMessage——应用消息原始接缝空壳`)
      if (!/export\s+async\s+function\s+sendAgentCard/.test(seamSrc))
        bad.push(`${seam} 未导出 sendAgentCard——应用消息 fail-soft 编排缺失`)
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (rel === seam) continue
            if (/['"]message\/send['"]/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 直出 message/send——应用消息须经 kit/wecom.sendAgentCard 单一收口（M⑦·根因#12）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      return bad
    },
  },
  {
    // 微信支付 APIv3 商户接缝单一收口（S16 外部对账·根因#12 平台接缝单点）：商户 API 出站 + v3 签名只在
    // kit/wxpay.ts；主机 api.mch.weixin.qq.com 字面量只许此文件出现，其余 cloud/src 引用即红（防散签/绕单点/凭证多处）。
    id: 'wxpay-seam-single',
    roots: ['#12'],
    desc: '微信支付商户 API 接缝单点（S16·根因#12）：v3 签名/账单出站仅 kit/wxpay.ts；主机 api.mch.weixin.qq.com 只此文件可现，其余 cloud/src 直拼商户 API 即红（防散签/绕单点）',
    run() {
      const seam = 'packages/cloud/src/kit/wxpay.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——微信支付商户接缝（S16 外部对账·根因#12）`]
      const bad = []
      const src = readFileSync(join(ROOT, seam), 'utf8')
      if (!/export\s+function\s+wxpaySign/.test(src) || !/export\s+async\s+function\s+fetchTradeBill/.test(src))
        bad.push(`${seam} 未导出 wxpaySign/fetchTradeBill——接缝空壳`)
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const HOST = 'api.mch.weixin.qq.com'
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (rel === seam) continue
            if (readFileSync(p, 'utf8').includes(HOST))
              bad.push(`${rel} 直引 ${HOST}——微信支付商户 API 出站须经 kit/wxpay（根因#12 接缝单点）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      return bad
    },
  },
  {
    // 库存原子单一收口（库存#1·根因#1/#2 防超卖）：inventory 集合仅 kit/inventory.ts 读写（reserveStock/
    // restoreStock/setStock）；扣减走乐观 CAS（where 含 stock 精确匹配·非读后写盲改）；其余 cloud/src
    // 不得直碰 inventory 集合（一律经 kit/inventory·防绕 CAS 超卖）。
    id: 'stock-atomic-conditional',
    roots: ['#1', '#2'],
    desc: '库存原子单一收口（库存#1·根因#1/#2）：inventory 集合仅 kit/inventory.ts 读写、扣减走条件 where(stock) 乐观 CAS（非盲改）；其余 cloud/src 直碰 inventory 即红（防绕 CAS 超卖）',
    run() {
      const seam = 'packages/cloud/src/kit/inventory.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——库存原子原语（库存#1）`]
      const bad = []
      const src = readFileSync(join(ROOT, seam), 'utf8')
      if (!/export\s+async\s+function\s+reserveStock/.test(src)) bad.push(`${seam} 未导出 reserveStock——原语空壳`)
      if (!/\.where\(\{[^}]*stock/.test(src)) bad.push(`${seam} 扣减未用条件 where(stock) 乐观 CAS——有超卖风险（库存#1）`)
      const allow = new Set([seam, 'packages/cloud/src/kit/collections.ts'])
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (allow.has(rel)) continue
            if (/COLLECTIONS\.inventory|\.collection\(\s*['"]inventory['"]\s*\)/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 直碰 inventory 集合——库存读写须经 kit/inventory（库存#1·防绕 CAS 超卖）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      return bad
    },
  },
  {
    // 原料账单点收口（进销存 SCM-0 门1·根因#1/#2·镜像 stock-atomic-conditional）：materials.stock 与 stockLedger
    // 仅 kit/scmStock.ts 读写（applyStockMoves 唯一入口）；库存变更走乐观 CAS（where 含 stock 精确匹配·非读后写盲改）；
    // 其余 cloud/src 不得直碰 materials/stockLedger 集合（一律经门1·防绕 CAS/绕流水改账）。
    id: 'material-stock-single-seam',
    roots: ['#1', '#2'],
    desc: '原料账单点收口（SCM 门1·根因#1/#2·镜像 stock-atomic-conditional）：materials.stock/stockLedger 仅 kit/scmStock.ts 读写（applyStockMoves 唯一入口·乐观 CAS）；其余 cloud/src 直碰即红（防绕 CAS/绕流水改账）',
    run() {
      const seam = 'packages/cloud/src/kit/scmStock.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——原料账原语（SCM 门1）`]
      const bad = []
      const src = readFileSync(join(ROOT, seam), 'utf8')
      if (!/export\s+async\s+function\s+applyStockMoves/.test(src)) bad.push(`${seam} 未导出 applyStockMoves——门1 空壳`)
      if (!/\.where\(\{[^}]*stock/.test(src)) bad.push(`${seam} 库存变更未用条件 where(stock) 乐观 CAS——有并发互覆盖风险（根因#1）`)
      const allow = new Set([seam, 'packages/cloud/src/kit/collections.ts'])
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (allow.has(rel)) continue
            if (/COLLECTIONS\.(materials|stockLedger)\b|\.collection\(\s*['"](materials|stockLedger)['"]\s*\)/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 直碰 materials/stockLedger 集合——原料账读写须经 kit/scmStock（SCM 门1·防绕 CAS/绕流水）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      return bad
    },
  },
  {
    // 原料流水确定性幂等（进销存 SCM·根因#2）：stockLedger 每笔流水 _id 必是确定性 `<docType>:<docId>:<itemKey>`
    // （撞 id＝并发方已写＝天然幂等·同 deterministic-id 范式）——门1 内的流水写入必先构造确定性 _id 再 add，
    // 禁自动 id（自动 id＝重放双记账）。静态锁 kit/scmStock.ts 的写入形态。
    id: 'scm-ledger-idempotent',
    roots: ['#2'],
    desc: '原料流水确定性幂等（SCM·根因#2）：kit/scmStock.ts 写 stockLedger 必构造确定性 _id=`docType:docId:itemKey`（撞 id=并发方已写）·禁自动 id 双记账',
    run() {
      const seam = 'packages/cloud/src/kit/scmStock.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——流水写入点（SCM 门1）`]
      const bad = []
      const src = readFileSync(join(ROOT, seam), 'utf8')
      // 确定性 id 构造必在场（模板字面量 docType:docId:itemKey 三段拼接）
      if (!/\$\{[^}]*docType[^}]*\}:\$\{[^}]*docId[^}]*\}:\$\{/.test(src))
        bad.push(`${seam} 未见确定性流水 _id 构造（\`\${docType}:\${docId}:\${itemKey}\` 三段模板）——流水失幂等（根因#2）`)
      // 流水写入必带 _id（add 的 data 里出现 _id 键）——禁自动 id
      const ledgerAdds = [...src.matchAll(/stockLedger[\s\S]{0,200}?\.add\(\s*\{\s*data:\s*\{([\s\S]{0,120}?)\}/g)]
      for (const m of ledgerAdds) if (!/_id\s*:/.test(m[1])) bad.push(`${seam} stockLedger add 未带确定性 _id——自动 id=重放双记账（根因#2）`)
      return bad
    },
  },
  {
    // 操作审计单一收口（操作审计#4·根因#3 可追溯）：管理端动钱/状态操作经 recordAudit 留痕；recordAudit/auditLog
    // 仅 kit/audit.ts（定义）+ collections/index（登记导出）+ adminApi/index.ts（分发处调用），其余 cloud/src 不得引用；
    // adminApi 分发处须接 recordAudit + shouldAudit（防回退成无痕）。
    id: 'admin-actions-audited',
    roots: ['#3'],
    desc: '操作审计单一收口（操作审计#4·根因#3）：recordAudit 仅 kit/audit.ts 定义、仅 adminApi/index.ts 分发处调用并接 shouldAudit；其余 cloud/src 引用 recordAudit/auditLog 即红（防散记/漏记）',
    run() {
      const seam = 'packages/cloud/src/kit/audit.ts'
      const caller = 'packages/cloud/src/functions/admin/adminApi/index.ts'
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——操作审计原语（操作审计#4）`]
      const bad = []
      if (!/export\s+async\s+function\s+recordAudit/.test(readFileSync(join(ROOT, seam), 'utf8')))
        bad.push(`${seam} 未导出 recordAudit——审计空壳`)
      const idx = readFileSync(join(ROOT, caller), 'utf8')
      if (!/recordAudit/.test(idx) || !/shouldAudit/.test(idx))
        bad.push(`${caller} 分发处未接 recordAudit+shouldAudit——管理操作无痕（操作审计#4）`)
      const allow = new Set([seam, caller, 'packages/cloud/src/kit/collections.ts', 'packages/cloud/src/kit/index.ts'])
      const srcRoot = join(ROOT, 'packages/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (allow.has(rel)) continue
            if (/recordAudit|COLLECTIONS\.auditLog|\.collection\(\s*['"]auditLog['"]\s*\)/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 直碰 recordAudit/auditLog——审计须经 kit/audit + adminApi 分发单点（操作审计#4）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      return bad
    },
  },
  // ── 后台360工作站 B1.1：模块化框架（架构规范五铁律）+ §1.5 信任边界（360 读越权面）──
  // provider/registry/编排器在 functions/admin/adminApi/customer360/；4 模块守卫焊「板块不散落/解耦/经接口/可开关」，
  // 2 信任边界守卫焊「360 读他人全貌→破例留痕 + 能力闸」（补 admin-actions-audited 跳 ^get 的盲区）。原 B0 框架并入本批·守卫随首个真 provider 立、咬真板块（防过度工程裁决）。
  {
    id: 'cs-module-registered',
    roots: ['铁律'],
    desc: '360 板块必注册（架构规范铁律一/五）：customer360/providers/ 下每个 provider 都须在 registry.ts import 注册（防散落/绕过）；且至少 1 个真 provider（空框架=守空气·防过度工程裁决）',
    run() {
      const base = 'packages/cloud/src/functions/admin/adminApi/customer360'
      const provDir = join(ROOT, base, 'providers')
      const registry = join(ROOT, base, 'registry.ts')
      if (!existsSync(provDir)) return [`${base}/providers/ 缺失——360 provider 目录`]
      if (!existsSync(registry)) return [`${base}/registry.ts 缺失——provider 注册表`]
      const reg = readFileSync(registry, 'utf8')
      const bad = []
      let count = 0
      for (const e of readdirSync(provDir)) {
        if (!e.endsWith('.ts')) continue
        count++
        const name = e.slice(0, -3)
        if (!new RegExp(`from\\s+['"]\\./providers/${name}['"]`).test(reg))
          bad.push(`provider ${e} 未在 registry.ts 注册（import ./providers/${name}）——板块须注册（铁律一/五）`)
      }
      if (count === 0) bad.push(`${base}/providers/ 无 provider——360 框架空转（守空气·防过度工程裁决）`)
      return bad
    },
  },
  {
    id: 'cs-no-cross-module-import',
    roots: ['铁律', 'T4'],
    desc: '360 板块解耦（架构规范铁律二/三）：provider 之间禁直接互 import；编排器 orchestrator.ts 禁直接 import providers/（须只经 registry 取板块·不认识具体板块）',
    run() {
      const base = 'packages/cloud/src/functions/admin/adminApi/customer360'
      const provDir = join(ROOT, base, 'providers')
      const orch = join(ROOT, base, 'orchestrator.ts')
      const bad = []
      if (existsSync(provDir)) {
        const provs = readdirSync(provDir).filter((e) => e.endsWith('.ts'))
        for (const e of provs) {
          const src = readFileSync(join(provDir, e), 'utf8')
          for (const other of provs) {
            const oname = other.slice(0, -3)
            if (other !== e && new RegExp(`from\\s+['"]\\./${oname}['"]`).test(src))
              bad.push(`provider ${e} 直接 import 另一 provider ${other}——板块间禁互 import（铁律二）`)
          }
        }
      }
      if (existsSync(orch) && /from\s+['"]\.\/providers\//.test(readFileSync(orch, 'utf8')))
        bad.push(`orchestrator.ts 直接 import providers/——编排器须只经 registry 取板块（铁律三）`)
      return bad
    },
  },
  {
    id: 'cs-panel-via-provider',
    roots: ['铁律'],
    desc: '360 经 provider 接口聚合 + admin 同构（架构规范铁律三·§2）：后端编排器 orchestrator.ts 须经 registry 遍历 + 统一调 provider.fetch、禁 switch 按 key 硬分发；前端 admin Customer360.vue 须 v-for 遍历后端 panels 通用渲染、禁 .key===字面量 硬编码面板类型（后端加/删板块 admin 零改·开放-封闭·B1.4 扩前端面）',
    run() {
      const orch = 'packages/cloud/src/functions/admin/adminApi/customer360/orchestrator.ts'
      if (!existsSync(join(ROOT, orch))) return [`${orch} 缺失——360 编排器`]
      const src = readFileSync(join(ROOT, orch), 'utf8')
      const bad = []
      if (!/from\s+['"]\.\/registry['"]/.test(src)) bad.push(`${orch} 未引 registry——编排器须遍历注册表（铁律三）`)
      if (!/\.fetch\s*\(/.test(src)) bad.push(`${orch} 未统一调 provider.fetch——须经接口聚合（铁律三）`)
      if (/switch\s*\(/.test(src)) bad.push(`${orch} 出现 switch 硬分发——编排器不得按 key 认板块（铁律三）`)
      // admin 同构（铁律三·§2「页面壳只渲染注册表里的板块·不硬编码板块列表」）：客户360 页须通用渲染后端 panels
      const vuePath = 'packages/admin/src/pages/Customer360.vue'
      const absVue = join(ROOT, vuePath)
      if (!existsSync(absVue)) bad.push(`${vuePath} 缺失——360 工作台页（铁律三 admin 同构·M①）`)
      else {
        const vue = readFileSync(absVue, 'utf8')
        if (!/v-for=["'][^"']*panels\b/.test(vue))
          bad.push(`${vuePath} 未 v-for 遍历 panels——admin 须通用渲染后端面板（铁律三·后端加板块零改）`)
        if (/\.key\s*===\s*['"]/.test(vue))
          bad.push(`${vuePath} 出现 .key==='字面量' 硬编码面板类型——须通用渲染（铁律三·开放-封闭）`)
      }
      return bad
    },
  },
  {
    id: 'cs-module-toggleable',
    roots: ['铁律'],
    desc: '360 板块可开关（架构规范铁律四·feature-flag）：每个 provider 声明 enabled；registry.ts 按 enabled + config 集合覆盖过滤（真可灰度/停某板块·非硬编码恒开=守空气）',
    run() {
      const base = 'packages/cloud/src/functions/admin/adminApi/customer360'
      const provDir = join(ROOT, base, 'providers')
      const registry = join(ROOT, base, 'registry.ts')
      const bad = []
      if (existsSync(provDir)) {
        for (const e of readdirSync(provDir)) {
          if (!e.endsWith('.ts')) continue
          if (!/\benabled\b/.test(readFileSync(join(provDir, e), 'utf8')))
            bad.push(`provider ${e} 未声明 enabled——板块须可开关（铁律四）`)
        }
      }
      if (existsSync(registry)) {
        const reg = readFileSync(registry, 'utf8')
        if (!/enabled/.test(reg) || !/config/.test(reg))
          bad.push(`registry.ts 未按 enabled+config 过滤——feature-flag 须真驱动开关（铁律四·防恒开守空气）`)
      }
      return bad
    },
  },
  {
    id: 'cs-360-read-audited',
    roots: ['#3'],
    desc: '360 读他人全貌破例留痕（§1.5·根因#3）：getCustomer360/getUser/searchCustomer/getSessionCustomer360 是「坐席批量读他人订单/PII/学习轨迹/检索客户」越权面，shouldAudit 跳 ^get 不覆盖 get* 类——kit/audit.ts 须有 FORCE_AUDIT 名单含四者强制留痕（防 PII 访问 0 痕·B1.2 扩 getUser/searchCustomer·接真接口批扩外包 scoped 读）',
    run() {
      const audit = 'packages/cloud/src/kit/audit.ts'
      if (!existsSync(join(ROOT, audit))) return [`${audit} 缺失——审计原语`]
      const src = readFileSync(join(ROOT, audit), 'utf8')
      const bad = []
      // 只扫 FORCE_AUDIT Set 字面量内部（防注释里出现 action 名造假绿·反向自检逮出的摆设守卫盲区）
      const set = src.match(/FORCE_AUDIT\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
      if (!set) bad.push(`${audit} 无 FORCE_AUDIT 名单——360 读越权面无法破例留痕（§1.5·根因#3）`)
      else
        for (const a of ['getCustomer360', 'getUser', 'searchCustomer', 'getSessionCustomer360'])
          if (!new RegExp(`['"]${a}['"]`).test(set[1]))
            bad.push(`${audit} FORCE_AUDIT 未含 ${a}——读他人全貌/检索 0 留痕（§1.5·根因#3）`)
      return bad
    },
  },
  {
    id: 'cs-360-rbac-gated',
    roots: ['#3'],
    desc: '360 读须能力闸（§1.5·根因#3·别让单超管裸奔）：adminApi/index.ts 须有 ACTION_CAPS 含 getCustomer360/getUser/searchCustomer→customer:view，且按 caps 校验拒绝（非任何登录都自动能批量读他人数据/检索客户·B1.2 扩两读·B5.2 扩多角色）',
    run() {
      const idx = 'packages/cloud/src/functions/admin/adminApi/index.ts'
      if (!existsSync(join(ROOT, idx))) return [`${idx} 缺失`]
      const src = readFileSync(join(ROOT, idx), 'utf8')
      const bad = []
      // 只扫 ACTION_CAPS 对象字面量内部（防 ACTIONS 注册行/import 里的 action 名造假绿·反向自检逮出）
      const caps = src.match(/const ACTION_CAPS[^{]*\{([\s\S]*?)\}/)
      if (!caps) bad.push(`${idx} 无 ACTION_CAPS 能力闸——360 读无 RBAC（§1.5·根因#3）`)
      else
        for (const a of ['getCustomer360', 'getUser', 'searchCustomer'])
          if (!new RegExp(`\\b${a}\\s*:`).test(caps[1]))
            bad.push(`ACTION_CAPS 未含 ${a}——任何登录即可读他人全貌/检索客户（§1.5·根因#3）`)
      if (!/\bcaps\b/.test(src)) bad.push(`${idx} 未按 caps 校验——能力闸空转（§1.5）`)
      return bad
    },
  },
  {
    id: 'agent-rbac-gated',
    roots: ['#3'],
    desc: '坐席 RBAC 默认拒（§1.5·根因#3·别让单超管裸奔·B5.2）：① index.ts 能力闸默认拒（needCap 须 `ACTION_CAPS[action] || <默认高权 cap>`·未登记 action 不放行→非超管角色默认进不去钱/状态 action）；② lib.ts 有 ROLES 角色表·outsourced 外包角色非全权（不含 `*`·最小权）；③ checkKey 支持 disabled（账号开停）',
    run() {
      const idx = 'packages/cloud/src/functions/admin/adminApi/index.ts'
      const lib = 'packages/cloud/src/functions/admin/adminApi/lib.ts'
      if (!existsSync(join(ROOT, idx)) || !existsSync(join(ROOT, lib))) return [`${idx} 或 ${lib} 缺失`]
      const bad = []
      const isrc = readFileSync(join(ROOT, idx), 'utf8')
      // ① 默认拒：needCap 须 fallback（ACTION_CAPS[action] || …）——否则未登记 action 放行＝非超管账号越权
      if (!/ACTION_CAPS\[\s*action\s*\]\s*\|\|/.test(isrc))
        bad.push(`${idx} 能力闸非默认拒——须 ACTION_CAPS[action] || <默认高权 cap>（否则未登记 action 放行→外包/坐席越权·B5.2）`)
      const lsrc = readFileSync(join(ROOT, lib), 'utf8')
      // ② ROLES 角色表 + outsourced 最小权（不含 '*'）
      const m = lsrc.match(/ROLES[^{]*\{([\s\S]*?)\n\s*\}/)
      if (!m) bad.push(`${lib} 无 ROLES 角色表（B5.2 多角色）`)
      else {
        const om = m[1].match(/outsourced\s*:\s*\[([^\]]*)\]/)
        if (!om) bad.push(`${lib} ROLES 无 outsourced 外包角色（最小权骨架·别让外包裸奔超管）`)
        else if (/['"]\*['"]/.test(om[1])) bad.push(`${lib} outsourced 外包角色含 '*' 全权——违最小权（B5.2 外包防越权·§1.5）`)
      }
      // ③ checkKey 支持 disabled（账号开停）
      if (!/disabled/.test(lsrc)) bad.push(`${lib} 未支持 disabled（账号开停·外包可停）`)
      return bad
    },
  },
  {
    // 操作审计记真实操作者身份（§1.5·根因#3 可追溯·B5.4·承 M⑤ 多账号 RBAC 上线）：多账号既已上线，审计不能再把
    // 所有人记成单口令 'admin'——否则外包/坐席「查了谁·改了谁」全糊成 admin、追溯即失效。焊三链：① kit/audit.ts
    // recordAudit 须接 operator 入参并以 entry.operator 落库（非硬编码 operator:'admin'）；② adminApi/index.ts 分发处
    // 须读 checkKey 返回 auth 的 operator + 贯到 recordAudit 调用；③ lib.ts checkKey 须返回 operator 账号身份
    // （否则 operator 恒 undefined、回退 admin＝没真解析）。防退回「全记 admin」审计假身份。
    id: 'audit-operator-threaded',
    roots: ['#3'],
    desc: '操作审计记真实操作者身份（§1.5·根因#3 可追溯·B5.4·承 M⑤ 多账号）：① kit/audit.ts recordAudit 以 entry.operator 落库（非硬编码 admin）；② adminApi/index.ts 读 auth.operator 并贯到 recordAudit 调用；③ lib.ts checkKey 返回 operator 账号身份——防多账号上线后审计仍把所有人记成 admin、追溯失效',
    run() {
      const bad = []
      const audit = 'packages/cloud/src/kit/audit.ts'
      const idx = 'packages/cloud/src/functions/admin/adminApi/index.ts'
      const lib = 'packages/cloud/src/functions/admin/adminApi/lib.ts'
      for (const f of [audit, idx, lib]) if (!existsSync(join(ROOT, f))) return [`${f} 缺失`]
      // ① audit.ts：operator 由 entry.operator 落库（非硬编码 'admin'）
      const asrc = readFileSync(join(ROOT, audit), 'utf8')
      if (!/operator:\s*String\(\s*entry\.operator/.test(asrc))
        bad.push(`${audit} recordAudit operator 未取自 entry.operator——审计记死 admin（§1.5·根因#3·B5.4）`)
      // ② index.ts：读 auth.operator + 贯到 recordAudit 调用
      const isrc = readFileSync(join(ROOT, idx), 'utf8')
      if (!/\.operator\b/.test(isrc))
        bad.push(`${idx} 未读取 auth.operator——真实操作者身份没从 checkKey 取出（§1.5·根因#3·B5.4）`)
      if (!/recordAudit\(\s*\{[^}]*\boperator\b/.test(isrc))
        bad.push(`${idx} recordAudit 调用未传 operator——操作者身份没贯到审计（§1.5·根因#3·B5.4）`)
      // ③ lib.ts checkKey：返回 operator 账号身份（否则 operator 恒 undefined 回退 admin）
      const lsrc = readFileSync(join(ROOT, lib), 'utf8')
      if (!/checkKey[\s\S]*?operator:/.test(lsrc))
        bad.push(`${lib} checkKey 未返回 operator 账号身份——operator 恒 undefined 回退 admin（§1.5·根因#3·B5.4）`)
      return bad
    },
  },
  {
    // 客服主动发消息服务端专用闸（§P0 ④·根因#3 信任边界 fail-closed）：cs/kfSend 是「向顾客主动发 send_msg」
    // 的越权发送面——若对客户端开放，任意登录用户可借此向任意顾客发任意消息。守此不变量：kfSend 须经
    // isServerCall 闸（仅后端/CLI 无 openid 放行·带 openid 的客户端调用拒）+ 真调 send_msg 发送接缝。
    // 承面C 落地时本闸升级为坐席 RBAC（agent:handle）+ 会话归属校验——本守卫防在那之前退回无闸。
    id: 'kf-send-server-gated',
    roots: ['#3'],
    desc: '向顾客主动发消息必过闸（§P0 ④·承面C B6·根因#3 信任边界 fail-closed）：① cs/kfSend（向顾客主动发 send_msg 的越权发送面）须经 isServerCall 闸——仅后端/CLI 放行、带 openid 的客户端调用拒 + 真调 send_msg；② 承面C 坐席台 agentDesk.sendAgentMessage 须先过分配 scope（scopedLoad→assertOwnedByAgent·外包只发自己 claim 的会话）+ 接待窗口（仅 active 态·防越窗）再经 kfSend/sendMsg 发。防退回无闸致任意登录用户/坐席向顾客发任意消息',
    run() {
      const f = 'packages/cloud/src/functions/cs/kfSend/index.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失——客服主动发消息接缝（§P0 ④·承面C sendAgentMessage 雏形）`]
      const s = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      // ① 服务端专用闸：无 isServerCall 拒即对客户端开放（越权发送面）
      if (!/if\s*\(\s*!\s*isServerCall\s*\(\s*\)\s*\)/.test(s))
        bad.push(`${f} 未经 isServerCall fail-closed 拒客户端——越权发送面对登录用户开放（根因#3·§P0 ④）`)
      // ② 真调发送接缝（非空壳）
      if (!/sendMsg\s*\(/.test(s))
        bad.push(`${f} 未调 sendMsg 发送接缝——非真发送（§P0 ④）`)
      // ③ 承面C 坐席台 sendAgentMessage 同族越权发送面（B6·§1.5·根因#3）：坐席回复须先过分配 scope + 接待窗口再发
      const desk = 'packages/cloud/src/functions/admin/adminApi/actions/agentDesk.ts'
      if (existsSync(join(ROOT, desk))) {
        const ds = readFileSync(join(ROOT, desk), 'utf8')
        const st = ds.indexOf('export async function sendAgentMessage')
        const body = st < 0 ? '' : (() => { const nx = ds.indexOf('export async function ', st + 1); return nx < 0 ? ds.slice(st) : ds.slice(st, nx) })()
        if (!body) bad.push(`${desk} 缺 sendAgentMessage（承面C 坐席回复·B6）`)
        else {
          if (!/scopedLoad\s*\(/.test(body))
            bad.push(`${desk} sendAgentMessage 未过分配 scope（scopedLoad→assertOwnedByAgent·外包越权发他人会话·§1.5·根因#3）`)
          if (!/['"]active['"]/.test(body))
            bad.push(`${desk} sendAgentMessage 未校验接待窗口（仅 active 态·防越窗发已结束/未接会话·B6）`)
          if (!/kfSend|sendMsg\s*\(/.test(body))
            bad.push(`${desk} sendAgentMessage 未经 kfSend/sendMsg 发送接缝（非真发送·接缝单点#12）`)
        }
      }
      return bad
    },
  },
  {
    // 自建坐席通道恒智能助手态（承面C·根因#12 平台规则）：坐席工作台回复走微信客服 send_msg API，
    // 而 send_msg 在平台会话态≠1(智能助手) 时被拒（95018·真机逼出·调试日志 AC）——「转人工」若把平台
    // service_state 转 3（原生接待台模式），自建坐席发送即全断。承面C 上线后人工排队/认领由自建 csSession
    // 状态机管，平台侧会话必须留智能助手态：① functions/cs/ 不得出现 transferToServicer/service_state 转 3；
    // ② dispatch 转人工分支仍须 enqueueSession（人工=入自建队列·不是丢给平台）。
    id: 'agent-channel-stays-assistant',
    roots: ['#12'],
    desc: '自建坐席通道恒智能助手态（承面C·根因#12）：send_msg 仅 state=1 可发（95018 真机逼出）——① functions/cs/ 禁调 transferToServicer（转人工不得把平台会话转 3=原生接待台模式·自建坐席发送全断）；② dispatch 转人工分支须 enqueueSession（人工=自建 csSession 队列承接）；③ index.ts 进会话欢迎（enter_session）须过 heldStatus（排队/接待中 bot 不抢话·深审 F3——曾直发欢迎菜单且点了又被 held 闸静默=自相矛盾）',
    run() {
      const bad = []
      const dir = join(ROOT, 'packages/cloud/src/functions/cs')
      const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (SKIP_DIR(e.name)) continue
          const p = join(d, e.name)
          if (e.isDirectory()) walk(p)
          else if (e.name.endsWith('.ts')) {
            const s = readFileSync(p, 'utf8')
            // 查真实标识符（import/调用都算——有 import 就有被调风险；注释里带括号的调用样式不匹配裸词）
            if (/\btransferToServicer\b/.test(stripComments(s)))
              bad.push(`${relative(ROOT, p)} 引用 transferToServicer——转人工把平台会话转 3=自建坐席 send_msg 全被 95018 拒（承面C·根因#12·调试日志 AC）`)
          }
        }
      }
      if (existsSync(dir)) walk(dir)
      const disp = 'packages/cloud/src/functions/cs/kfCallback/dispatch.ts'
      if (existsSync(join(ROOT, disp))) {
        const s = readFileSync(join(ROOT, disp), 'utf8')
        const st = s.indexOf("case 'transfer'")
        const body = st < 0 ? '' : s.slice(st, s.indexOf('case ', st + 1))
        if (!/enqueueSession\s*\(/.test(body))
          bad.push(`${disp} 转人工分支未 enqueueSession()——人工须由自建 csSession 队列承接（承面C·B6）`)
      }
      // ③ 进会话欢迎须过 held 判定（深审 F3）：enter_session 分支须引用 heldStatus——排队/接待中顾客重开聊天窗
      // 不被 bot 抢话（发菜单点了又被 held 闸静默＝自相矛盾体验）。
      const idx = 'packages/cloud/src/functions/cs/kfCallback/index.ts'
      if (existsSync(join(ROOT, idx))) {
        const s = readFileSync(join(ROOT, idx), 'utf8')
        const st = s.indexOf('enter_session')
        const seg = st < 0 ? '' : s.slice(st, st + 600)
        if (st >= 0 && !/heldStatus\s*\(/.test(seg))
          bad.push(`${idx} enter_session 欢迎未过 heldStatus——排队/接待中顾客重开聊天窗会被 bot 抢话（深审 F3·调试日志 AC/AD 语义）`)
      }
      return bad
    },
  },
  {
    // 数据共享告知同意（后台360工作站 §1.5·B3.3·承面C 车道 C·根因#3 信任边界）：外包/第三方坐席（≠商户
    // 本人）看客户 360 数据前须有「告知同意」——不同于 C 端微信隐私授权（privacy-authorize-wired 管小程序
    // 系统级隐私接口）。这是「第三方访问客户数据」的义务，焊三件：① 协议/隐私页如实声明外包/第三方客服可
    // 访问客户数据（**文案已声明**·法律定稿归律师·CC 只机械化不判措辞对错·守 cc-scope-mechanical-not-legal）；
    // ② kit/csAccess 有 fail-closed assertDataShareConsent 同意闸（未同意即 ok:false 拒·非默认放行）；
    // ③ cs/dataConsent 经 withOpenId 写 users.csDataShare·agreed 双向可切（用户同意 + 可撤回）。防第三方
    // 访问客户数据「零告知/零同意闸」。C3 outsourced-reads-scoped 焊 scope、本条焊 consent，两层各守其面。
    id: 'cs-data-share-consented',
    roots: ['#3'],
    desc: '数据共享告知同意（§1.5·B3.3·承面C 车道 C·根因#3）：外包/第三方坐席看客户数据前须有告知同意——① 协议/隐私页如实声明外包/第三方客服可访问客户数据（文案已声明·法律定稿归律师）；② kit/csAccess 有 fail-closed assertDataShareConsent 同意闸（未同意即 ok:false 拒·非默认放行）；③ cs/dataConsent 经 withOpenId 写 users.csDataShare（用户同意 + 可撤回）。独立于 C 端 privacy-authorize-wired',
    run() {
      const bad = []
      // ① 声明文案：协议/隐私页如实披露外包/第三方客服访问客户数据（CC 只核「已声明」·法律对错归律师）
      const agr = 'packages/miniapp/src/pages/agreement/index.vue'
      if (!existsSync(join(ROOT, agr))) bad.push(`${agr} 缺失（协议/隐私页·声明落点）`)
      else {
        const s = readFileSync(join(ROOT, agr), 'utf8')
        // 锚定 §3 声明专属措辞「受托客服」（导航标签/注释里不出现·防「关键词散落别处→删声明仍假绿」·反向自检逼出）+ 外包概念
        if (!/受托客服/.test(s) || !/外包/.test(s))
          bad.push(`${agr} 隐私政策未声明外包/受托（第三方）客服可访问客户数据——数据共享告知缺声明（§1.5·B3.3·文案已声明·法律定稿归律师）`)
      }
      // ② fail-closed 同意闸：kit/csAccess assertDataShareConsent 存在且默认拒（未同意即 ok:false·非默认放行）
      const acc = 'packages/cloud/src/kit/csAccess.ts'
      if (!existsSync(join(ROOT, acc))) bad.push(`${acc} 缺失——无数据共享同意闸（§1.5·B3.3）`)
      else {
        const s = readFileSync(join(ROOT, acc), 'utf8')
        if (!/export\s+(async\s+)?function\s+assertDataShareConsent|export\s+const\s+assertDataShareConsent/.test(s))
          bad.push(`${acc} 无 assertDataShareConsent 同意闸（§1.5·B3.3）`)
        // fail-closed：精确焊未同意的拒绝返回形状 { ok:false, error:'NO_CONSENT' }——防 ok:false→ok:true 篡改假绿（反向自检逼出·邻近匹配会串到别的函数）
        else if (!/\{\s*ok:\s*false,\s*error:\s*'NO_CONSENT'\s*\}/.test(s))
          bad.push(`${acc} assertDataShareConsent 无 { ok:false, error:'NO_CONSENT' } 拒绝返回——同意闸空转默认放行（§1.5·根因#3）`)
      }
      // ③ 用户同意 + 可撤回：cs/dataConsent 经 withOpenId 写 users.csDataShare（agreed 双向可切＝撤回）
      const dc = 'packages/cloud/src/functions/cs/dataConsent/index.ts'
      if (!existsSync(join(ROOT, dc))) bad.push(`${dc} 缺失——无用户同意/撤回机制（§1.5·B3.3）`)
      else {
        const s = readFileSync(join(ROOT, dc), 'utf8')
        if (!/csDataShare/.test(s)) bad.push(`${dc} 未写 users.csDataShare 同意态（§1.5·B3.3）`)
        if (!/withOpenId/.test(s)) bad.push(`${dc} 未经 withOpenId 闸——同意写入未验本人（根因#3）`)
      }
      // ④ 读侧真实消费者（scoped-360-for-outsourced·接真接口批落地）：外包看 claim 会话对应 360 的唯一路径
      //    getSessionCustomer360 须真调 assertDataShareConsent(（外包读须过同意闸·非只有 write 侧空转）——
      //    防「同意闸建了没人消费＝摆设」（元模式·别摆设守卫）。查真实调用非注释（根因#8）。
      const desk = 'packages/cloud/src/functions/admin/adminApi/actions/agentDesk.ts'
      if (existsSync(join(ROOT, desk))) {
        const s = readFileSync(join(ROOT, desk), 'utf8')
        const st = s.indexOf('export async function getSessionCustomer360')
        if (st < 0) bad.push(`${desk} 缺 getSessionCustomer360——外包无 scoped 360 读路径（收窄后直调 getCustomer360 已 403·B 侧栏接真断头·§1.5）`)
        else {
          const nx = s.indexOf('export async function ', st + 1)
          const body = nx < 0 ? s.slice(st) : s.slice(st, nx)
          if (!/assertDataShareConsent\s*\(/.test(body))
            bad.push(`${desk} getSessionCustomer360 未真调 assertDataShareConsent()——外包读客户 360 绕过数据共享同意闸（§1.5·B3.3·根因#3）`)
        }
      }
      return bad
    },
  },
  {
    // 外包读路径分配 scope 防批量导出（后台360工作站 §1 定稿/B6·承面C 车道 C·根因#3 信任边界）：外包坐席
    // （outsourced）「查」权只应及**自己 claim 的会话 + 对应 360**（分配制）——否则一个外包账号即可遍历
    // 全量客户 360＝批量导出。守此不变量：① kit/csAccess 有 fail-closed assertOwnedByAgent（会话 agentId≠本
    // 坐席即 ok:false 拒·会话不存在亦拒·非默认放行）且经 kit 导出（车道 A 引用）；② 车道 A 坐席台 per-session
    // 读/操作 action（getThread/sendAgentMessage/release/escalate/close·落 functions/cs/agentDesk/）落地时须引
    // assertOwnedByAgent 校验会话归属（本守卫在其文件出现时才真发挥·接缝见承面C工单 §3 车道 A + 车道 C ready
    // 报告）。**外包 customer:view 无 scope 批量读（searchCustomer/getCustomer360）是另一层 RBAC 决策·adminRbac
    // 测试锁死现含 customer:view·报 master/车道 A 协调收窄·本守卫不越界改共享 ROLES / 破锁测**。守卫定义在车道 C。
    id: 'outsourced-reads-scoped',
    roots: ['#3'],
    desc: '外包读路径分配 scope 防批量导出（§1 定稿·B6·承面C 车道 C·根因#3）：① kit/csAccess 有 fail-closed assertOwnedByAgent（会话 agentId≠本坐席/会话不存在即 ok:false 拒·非默认放行）并经 kit 导出；② 车道 A 坐席台 per-session 读/操作 action（adminApi/actions/agentDesk.ts 里 getThread/sendAgentMessage/release/escalate/close）须引 assertOwnedByAgent 校验会话归属（防一外包账号遍历全量客户 360＝批量导出）。master 整合已收敛：外包端态 caps 收窄为仅 agent:handle（去掉裸 customer:view·闭合批量读洞）+ 坐席台 scope 走 assertOwnedByAgent 单源',
    run() {
      const bad = []
      const acc = 'packages/cloud/src/kit/csAccess.ts'
      if (!existsSync(join(ROOT, acc))) return [`${acc} 缺失——无外包读 scope 闸（§1 定稿·B6·根因#3）`]
      const s = readFileSync(join(ROOT, acc), 'utf8')
      // ① assertOwnedByAgent 存在 + fail-closed（会话归属不符/不存在即 ok:false 拒·查真实代码非注释）
      if (!/export\s+(async\s+)?function\s+assertOwnedByAgent|export\s+const\s+assertOwnedByAgent/.test(s))
        bad.push(`${acc} 无 assertOwnedByAgent scope 闸（§1 定稿·B6·防批量导出）`)
      // fail-closed：精确焊会话归属不符的拒绝返回形状 { ok:false, error:'NOT_OWNER' }——防 ok:false→ok:true 篡改假绿（反向自检逼出·邻近匹配会串到别的函数）
      else if (!/\{\s*ok:\s*false,\s*error:\s*'NOT_OWNER'\s*\}/.test(s))
        bad.push(`${acc} assertOwnedByAgent 无 { ok:false, error:'NOT_OWNER' } 拒绝返回——scope 闸空转默认放行（§1 定稿·根因#3）`)
      // ② 经 kit 导出（车道 A 引用·防私有不可用）
      const idx = 'packages/cloud/src/kit/index.ts'
      if (existsSync(join(ROOT, idx)) && !/assertOwnedByAgent/.test(readFileSync(join(ROOT, idx), 'utf8')))
        bad.push(`${idx} 未导出 assertOwnedByAgent——车道 A 坐席台无法引用 scope 闸（接缝·§3 车道 A）`)
      // ③ 车道 A per-session 读/操作 action 须引 scope 闸（master 整合校正：车道 A 落点＝adminApi/actions/agentDesk.ts
      //    ·非 functions/cs/agentDesk/·作为 adminApi action 复用口令闸/ACTION_CAPS）。该文件出现 per-session action 即须引 assertOwnedByAgent。
      const deskFile = join(ROOT, 'packages/cloud/src/functions/admin/adminApi/actions/agentDesk.ts')
      if (existsSync(deskFile)) {
        const src = readFileSync(deskFile, 'utf8')
        const perSession = /\b(getThread|sendAgentMessage|releaseConversation|escalateToMerchant|closeConversation|getSessionCustomer360)\b/.test(src)
        // 查真实调用 assertOwnedByAgent( 而非裸 token（防注释里提一句就假绿·反向自检逼出·根因#8·剥注释再测·批E加固）
        if (perSession && !/assertOwnedByAgent\s*\(/.test(stripComments(src)))
          bad.push(`${relative(ROOT, deskFile)} per-session 读/操作 action 未真调 assertOwnedByAgent() 校验会话归属——外包可越 scope 读他人会话/批量导出（§1 定稿·B6·根因#3）`)
      }
      return bad
    },
  },
  {
    // 查订单·平台原生身份桥接（§查订单·根因#3 不信前端）：小程序绑开放平台后 login 拿得到 unionid → 存进 users；
    // kfCallback 收到客服消息时经微信客服 kf/customer/batchget 反查 external_userid→unionid→openid 建 kfIdentity 映射，
    // 供 resolveOpenid「查你的订单」。**绕开客户联系 idconvert 的 48002 墙**（用微信客服自己的顾客接口·平台原生·2026-07-01
    // 真机逼出 48002 后改此路）。焊两端：① login 经 currentUnionId 存 unionid；② kfCallback 经 kfCustomerBatchget 写 kfIdentity。
    id: 'login-kf-identity-bridge',
    roots: ['#3'],
    desc: '查订单平台原生身份桥接（§查订单·根因#3 不信前端）：login 经 currentUnionId 存 unionid 到 users；kfCallback 经微信客服 kfCustomerBatchget 反查建 external_userid→openid 映射写 kfIdentity（resolveOpenid 读它查订单·绕客户联系 idconvert 48002）——防桥接被摘致查订单静默失效',
    run() {
      const bad = []
      const lf = 'packages/cloud/src/functions/user/login.ts'
      const kf = 'packages/cloud/src/functions/cs/kfCallback/index.ts'
      for (const f of [lf, kf]) if (!existsSync(join(ROOT, f))) return [`${f} 缺失`]
      const ls = readFileSync(join(ROOT, lf), 'utf8')
      const ks = readFileSync(join(ROOT, kf), 'utf8')
      // ① login 取 unionid 并存 users（供 kfCallback 反查）
      if (!/currentUnionId\s*\(/.test(ls)) bad.push(`${lf} 未经 currentUnionId 取 unionid（§查订单）`)
      if (!/data:\s*\{\s*unionid\s*\}/.test(ls)) bad.push(`${lf} 未存 unionid 到 users——kfCallback 反查无从落地（§查订单）`)
      // ② kfCallback 经微信客服 batchget 反查 + 写 kfIdentity（平台原生·绕客户联系 idconvert 48002）
      if (!/kfCustomerBatchget\s*\(/.test(ks)) bad.push(`${kf} 未经 kfCustomerBatchget 反查 unionid——查订单身份无从解析（§查订单·平台原生）`)
      if (!/COLLECTIONS\.kfIdentity|['"]kfIdentity['"]/.test(ks)) bad.push(`${kf} 未写 kfIdentity 映射——resolveOpenid 查不到 openid（§查订单·根因#3）`)
      return bad
    },
  },
  {
    // 微信客服活体探针经唯一 botpush 接缝告警（根因#12 接缝单点·补根因#8「上线后静默故障」隐患·调试日志 AA）：
    // kfHealthProbe 定时探令牌/API 健康，静默故障（Secret 漂/可信IP 丢/权限丢·这次逼出 60020/40001 那类）经
    // notifyAlert 唯一接缝推企微——防探针被悄悄摘掉 → 又回到「断了没人知道」的静默故障。焊：① 探针在 + isServerCall
    // 防刷 ② 真调 getAccessToken + listKfAccounts 探（gettoken 抓不到可信IP·须真调读接口）③ 经 notifyAlert 推（不直拼 https）。
    id: 'kf-health-probe-wired',
    roots: ['#12'],
    desc: '微信客服活体探针经唯一接缝告警（根因#12·补根因#8 上线后静默故障隐患·调试日志 AA）：cs/kfHealthProbe 须 isServerCall 闸 + 真调 getAccessToken/listKfAccounts 探健康 + 经 notifyAlert 唯一 botpush 接缝推企微告警——防探针被摘致「断了没人知道」',
    run() {
      const f = 'packages/cloud/src/functions/cs/kfHealthProbe/index.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失——微信客服活体探针（调试日志 AA 隐患补法）`]
      const s = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/isServerCall\s*\(/.test(s)) bad.push(`${f} 未经 isServerCall——探针对客户端开放可被刷告警（根因#3）`)
      if (!/getAccessToken\s*\(/.test(s) || !/listKfAccounts\s*\(/.test(s))
        bad.push(`${f} 未真调 getAccessToken+listKfAccounts——探不到令牌/可信IP 静默故障（gettoken 抓不到 60020）`)
      if (!/notifyAlert\s*\(/.test(s)) bad.push(`${f} 未经 notifyAlert 推告警——静默故障无人知（根因#12 唯一接缝）`)
      return bad
    },
  },
  {
    // kfCallback 回复前必先把会话置为「由智能助手接待」态（service_state=1）才能 send_msg（防 95018·根因#12 平台规则外部风险·
    // 调试日志 AB）。微信客服 send_msg 仅在 service_state ∈ {1 智能助手, 3 人工} 可发；新会话默认 0 未处理，直接 send 报
    // 95018「session status invalid」＝消息被消费却静默无回复。迁移到企业微信内后新会话默认态漂移（旧独立端自动进 1）——
    // 正解是与平台会话状态机的接缝收口 kit/wecom.ts.ensureSmartAssistant（get→trans 主动置态·抗后台「接待方式」默认漂移·
    // 同 AA「配过一次≠一直通」#8 静默故障宗）。焊两端：① index.ts handleOne 回复前经 ensureSmartAssistant 置态；② 人工态(3)
    // 返 'skip' 短路——bot 不抢话。
    id: 'kf-reply-after-smart-assistant',
    roots: ['#12'],
    desc: 'kfCallback 回复前必经 ensureSmartAssistant 置会话为智能助手态 service_state=1（接缝收口 kit/wecom.ts）——微信客服 send_msg 仅 state 1/3 可发，新会话默认 0未处理直接发报 95018 静默无回复（调试日志 AB·迁移到企业微信内后平台默认态漂移·根因#12 接缝主动置态不靠后台默认·同 AA #8 配过一次≠一直通）；且人工接待态(3) 返 skip·bot 不抢话',
    run() {
      const f = 'packages/cloud/src/functions/cs/kfCallback/index.ts'
      const w = 'packages/cloud/src/kit/wecom.ts'
      const bad = []
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失`]
      if (!existsSync(join(ROOT, w))) return [`${w} 缺失——会话状态接缝`]
      const s = readFileSync(join(ROOT, f), 'utf8')
      const ws = readFileSync(join(ROOT, w), 'utf8')
      // ① 接缝在 kit/wecom.ts：真调 service_state get + trans（非空壳·平台接缝单点·根因#12）
      if (!/service_state\/get/.test(ws)) bad.push(`${w} ensureSmartAssistant 未真调 kf/service_state/get 读会话态（根因#12 接缝）`)
      if (!/service_state:\s*1\b/.test(ws)) bad.push(`${w} 未 trans 到 service_state=1（智能助手接待）——send_msg 报 95018（根因#12）`)
      // ② index.ts 回复前经 ensureSmartAssistant 置态 + 人工态短路（防退回「不置态直接 send」＝95018 静默无回复）
      if (!/ensureSmartAssistant\s*\(/.test(s))
        bad.push(`${f} 回复前未经 ensureSmartAssistant 置智能助手态——新会话 state 0 直接 send_msg 报 95018 无回复（调试日志 AB·根因#12）`)
      if (!/['"]skip['"]/.test(s))
        bad.push(`${f} 未据 ensureSmartAssistant 的 'skip' 短路——人工接待态(3) bot 会抢话（调试日志 AB）`)
      return bad
    },
  },
  {
    // 后台360工作站 B2.2 节点诊断·UGC 图片入库前必过内容安全（根因#3 信任边界 fail-closed）：学员拍照上传是
    // 本项目第一个「用户图片入库」越权写面——黄暴恐违规图直接入库＝合规风险。守此不变量：① kit/contentsec.ts
    // 内容安全接缝须真调 cloud.openapi.security.imgSecCheck（非注释摆设·扫真实调用模式·防假绿）；② 写 checkpoints
    // 的 UGC 上传函数 submitCheckpointPhoto 须调 imgSecCheck 接缝（入库前·校不过不存）。真机验图真能拦属根因#8 靠人。
    id: 'ugc-imgsecchecked',
    roots: ['#3'],
    desc: 'UGC 内容安全入库前必校（根因#3 fail-closed）：kit/contentsec.ts 接缝（老线+重写线）须真调 cloud.openapi.security.imgSecCheck（图）+ 重写线须真调 .msgSecCheck（文本）；写 UGC 图的函数——老线 submitCheckpointPhoto 写 checkpoints、重写线 checkpoint.ts 写 checkpoints / reviews.ts 存买家秀 photos / user.ts 头像——须调 imgSecCheck；写 UGC 文本的函数——reviews.ts 评价 text/tags、user.ts 昵称/签名——须调 msgSecCheck，防违规图/文直接入库（节点诊断拍照 B2.2 + 买家秀晒图 + 昵称/签名/头像公开展示面）',
    run() {
      const bad = []
      const sec = 'packages/cloud/src/kit/contentsec.ts'
      const absSec = join(ROOT, sec)
      if (!existsSync(absSec)) bad.push(`${sec} 缺失——内容安全接缝（根因#3·UGC 入库前校验）`)
      else if (!/\.openapi\.security\.imgSecCheck/.test(stripComments(readFileSync(absSec, 'utf8'))))
        bad.push(`${sec} 未真调 cloud.openapi.security.imgSecCheck——内容安全接缝是摆设（根因#3·扫真实调用非注释）`)
      const fn = 'packages/cloud/src/functions/learning/submitCheckpointPhoto.ts'
      const absFn = join(ROOT, fn)
      if (!existsSync(absFn)) bad.push(`${fn} 缺失——节点拍照上传 UGC 写入口（B2.2）`)
      else {
        const fsrc = readFileSync(absFn, 'utf8')
        const writesCheckpoints = /COLLECTIONS\.checkpoints|['"]checkpoints['"]/.test(fsrc)
        if (writesCheckpoints && !/imgSecCheck\s*\(/.test(stripComments(fsrc)))
          bad.push(`${fn} 写 checkpoints 但未调 imgSecCheck——UGC 图片未过内容安全即入库（根因#3·fail-closed）`)
      }
      // —— 活跃重写线（rewrite/·与冻结 packages 老线并列守；UGC 写面在 app/actions 下）——
      // 接缝须真调 imgSecCheck；每个「写 UGC 图字段」的函数（写 checkpoints / 存 photos）漏调即红。
      const rwSec = 'rewrite/cloud/src/kit/contentsec.ts'
      const absRwSec = join(ROOT, rwSec)
      if (!existsSync(absRwSec)) bad.push(`${rwSec} 缺失——重写线内容安全接缝（根因#3·UGC 入库前校验）`)
      else {
        const secSrc = stripComments(readFileSync(absRwSec, 'utf8'))
        if (!/\.openapi\.security\.imgSecCheck/.test(secSrc))
          bad.push(`${rwSec} 未真调 cloud.openapi.security.imgSecCheck——图片内容安全接缝是摆设（根因#3·扫真实调用非注释）`)
        if (!/\.openapi\.security\.msgSecCheck/.test(secSrc))
          bad.push(`${rwSec} 未真调 cloud.openapi.security.msgSecCheck——文本内容安全接缝是摆设（根因#3·扫真实调用非注释）`)
      }
      // UGC 图写面：写 UGC 图字段的函数须调 imgSecCheck（校后才入库）
      const rwImgWriters = [
        { fn: 'rewrite/cloud/src/functions/app/actions/checkpoint.ts', ugc: /COLLECTIONS\.checkpoints|['"]checkpoints['"]/, what: '节点拍照 checkpoints' },
        { fn: 'rewrite/cloud/src/functions/app/actions/reviews.ts', ugc: /\bphotos\b/, what: '买家秀晒图 photos' },
        { fn: 'rewrite/cloud/src/functions/app/actions/user.ts', ugc: /\bavatar\b/, what: '用户头像 avatar' },
      ]
      for (const { fn: rf, ugc, what } of rwImgWriters) {
        const abs = join(ROOT, rf)
        if (!existsSync(abs)) {
          bad.push(`${rf} 缺失——重写线 UGC 图片写入口（${what}）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        if (ugc.test(src) && !/imgSecCheck\s*\(/.test(stripComments(src)))
          bad.push(`${rf} 写 UGC 图（${what}）但未调 imgSecCheck——图片未过内容安全即入库（根因#3·fail-closed）`)
      }
      // UGC 文本写面：写公开展示文本字段的函数须调 msgSecCheck（校后才入库）
      const rwMsgWriters = [
        { fn: 'rewrite/cloud/src/functions/app/actions/reviews.ts', what: '评价文本 text/tags' },
        { fn: 'rewrite/cloud/src/functions/app/actions/user.ts', what: '昵称/签名 nickname/bio' },
      ]
      for (const { fn: rf, what } of rwMsgWriters) {
        const abs = join(ROOT, rf)
        if (!existsSync(abs)) {
          bad.push(`${rf} 缺失——重写线 UGC 文本写入口（${what}）`)
          continue
        }
        if (!/msgSecCheck\s*\(/.test(stripComments(readFileSync(abs, 'utf8'))))
          bad.push(`${rf} 写 UGC 文本（${what}）但未调 msgSecCheck——文本未过内容安全即入库（根因#3·fail-closed·合规/下架风险）`)
      }
      return bad
    },
  },
  // ── 后台360工作站 B5.1：会话归档 + 检索（板块#9·外包管控底座·车道 E）──
  // 微信客服会话（未来承面C）归档进 conversations 集合，供坐席检索 + 质检取证（B5.3 依赖）。会话含 PII，三守卫焊：
  // ① 归档挂载不可悄悄摘（入站客户消息/出站回复都落档）+ 隐私须声明；② 检索须 bounded 分页（规模·根因#7）；
  // ③ 检索＝读他人会话全文越权面、须能力闸（§1.5 信任边界·根因#3·同 360 读 customer:view·独立焊本 action·不动 master 的 cs-360-* 两条）。
  {
    id: 'conversations-archived',
    roots: ['#3'],
    desc: '客服会话归档挂载 + 隐私声明（后台360工作站 B5.1·根因#3 信任边界资产）：cs/kfCallback/archive.ts 须真写 conversations 集合（归档接缝非摆设）；index.ts 须真调 archiveInbound + archiveOutbound（入站客户消息/出站回复都落档·防悄悄摘掉归档=质检取证资产丢失）；会话含 PII，协议页须声明「客服会话记录」被收集留存（隐私声明不可漏）',
    run() {
      const bad = []
      const arch = 'packages/cloud/src/functions/cs/kfCallback/archive.ts'
      const absArch = join(ROOT, arch)
      if (!existsSync(absArch)) bad.push(`${arch} 缺失——会话归档接缝（B5.1）`)
      else if (!/COLLECTIONS\.conversations|['"]conversations['"]/.test(readFileSync(absArch, 'utf8')))
        bad.push(`${arch} 未写 conversations 集合——归档接缝是摆设（B5.1·扫真实写入·非注释）`)
      const idx = 'packages/cloud/src/functions/cs/kfCallback/index.ts'
      const absIdx = join(ROOT, idx)
      if (!existsSync(absIdx)) bad.push(`${idx} 缺失——微信客服回调（归档挂点）`)
      else {
        const s = readFileSync(absIdx, 'utf8')
        if (!/archiveInbound\s*\(/.test(s)) bad.push(`${idx} 未调 archiveInbound——入站客户消息未落档（B5.1·防摘归档）`)
        if (!/archiveOutbound\s*\(/.test(s)) bad.push(`${idx} 未调 archiveOutbound——出站回复未落档（B5.1·防摘归档）`)
      }
      const agr = 'packages/miniapp/src/pages/agreement/index.vue'
      const absAgr = join(ROOT, agr)
      if (existsSync(absAgr) && !/客服.{0,8}会话|会话记录/.test(readFileSync(absAgr, 'utf8')))
        bad.push(`${agr} 未声明「客服会话记录」被收集留存——会话含 PII·隐私声明漏（B5.1·根因#3）`)
      return bad
    },
  },
  {
    id: 'conversations-search-bounded',
    roots: ['#7'],
    desc: '会话检索 cursor 分页有界（后台360工作站 B5.1·根因#7 规模）：adminApi/actions/conversations.ts 的检索须经 kit pageQuery 游标分页——杜绝裸 .get() 一次拉爆某客户/全量会话（大客户/长会话拖垮工作台·同评价/订单分页·paging-contract）',
    run() {
      const f = 'packages/cloud/src/functions/admin/adminApi/actions/conversations.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（会话检索·B5.1）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/pageQuery\s*\(/.test(src))
        bad.push(`${f} 检索未经 pageQuery 游标分页——裸读规模即拖垮工作台（根因#7·paging-contract）`)
      return bad
    },
  },
  {
    id: 'conversations-pii-gated',
    roots: ['#3'],
    desc: '会话检索＝读他人会话全文越权面（后台360工作站 B5.1·§1.5 信任边界·根因#3）：searchConversations 须经能力闸——adminApi/index.ts ACTION_CAPS 含 searchConversations（非任何登录可检索他人会话全文·同 360 读 customer:view）。审计由 shouldAudit 默认覆盖（search* 非 ^get·自动留痕·测试锁）。与 master 的 cs-360-rbac-gated 同范式·独立焊本 action·不动那条',
    run() {
      const idx = 'packages/cloud/src/functions/admin/adminApi/index.ts'
      const absIdx = join(ROOT, idx)
      if (!existsSync(absIdx)) return [`${idx} 缺失`]
      const caps = readFileSync(absIdx, 'utf8').match(/const ACTION_CAPS[^{]*\{([\s\S]*?)\}/)
      if (!caps || !/\bsearchConversations\s*:/.test(caps[1]))
        return [`ACTION_CAPS 未含 searchConversations——任何登录即可检索他人会话全文（§1.5·根因#3·别让坐席越权读会话 PII）`]
      return []
    },
  },
  {
    // 后台360工作站 B5.3：质检 + 报表 + SLA（板块#11·依赖归档·车道 E）。报表聚合会话算响应时长/SLA/答复率·须 bounded。
    id: 'conversations-report-bounded',
    roots: ['#7'],
    desc: '会话质检报表聚合有界（后台360工作站 B5.3·根因#7/#18 规模）：adminApi/actions/conversations.ts 的 conversationsReport 须 bounded 样本读（带 .limit() 上界·同 dashboard SAMPLE）——杜绝全量扫会话算 SLA/响应时长拖垮（量上来即慢·超量标 approx）',
    run() {
      const f = 'packages/cloud/src/functions/admin/adminApi/actions/conversations.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（会话质检报表·B5.3）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/conversationsReport/.test(src)) bad.push(`${f} 无 conversationsReport——质检报表缺失（B5.3）`)
      else if (!/\.limit\s*\(/.test(src))
        bad.push(`${f} conversationsReport 聚合未带 .limit() 上界——全量扫会话拖垮（根因#7/#18·须 bounded 样本·同 dashboard）`)
      return bad
    },
  },
  {
    id: 'interface-catalog-sync',
    roots: ['正册'],
    desc: '系统事实同步（docs/系统事实.md 是接口权威登记册，正册自评 P1）：每个云函数 + 每个 adminApi action 都须登记，杜绝「加接口忘登记」',
    run() {
      const catPath = join(ROOT, 'docs/系统事实.md')
      if (!existsSync(catPath)) return ['docs/系统事实.md 缺失（接口权威登记册）']
      const cat = readFileSync(catPath, 'utf8')
      const has = (name) => cat.includes('`' + name + '`')
      const fnRoot = join(ROOT, 'packages/cloud/src/functions')
      if (!existsSync(fnRoot)) return []
      const bad = []
      // 云函数（functions/<域>/<name>.ts 或 <name>/ 目录型）
      for (const domain of readdirSync(fnRoot)) {
        const dp = join(fnRoot, domain)
        if (!statSync(dp).isDirectory()) continue
        for (const e of readdirSync(dp)) {
          const name = statSync(join(dp, e)).isDirectory() ? e : e.endsWith('.ts') ? e.slice(0, -3) : null
          if (name && !has(name)) bad.push(`云函数 ${name} 未登记 docs/系统事实.md（正册 P1）`)
        }
      }
      // adminApi action（index.ts ACTIONS 查表键 + 特例 ping/login）
      const idxPath = join(fnRoot, 'admin/adminApi/index.ts')
      if (existsSync(idxPath)) {
        const m = readFileSync(idxPath, 'utf8').match(/const ACTIONS[^{]*\{([\s\S]*?)\n\}/)
        const actions = m ? [...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]) : []
        for (const a of [...actions, 'ping', 'login']) {
          if (!has(a)) bad.push(`adminApi action ${a} 未登记 docs/系统事实.md（正册 P1）`)
        }
      }
      return bad
    },
  },
  {
    id: 'writes-need-gate',
    roots: ['#3'],
    desc: '写库必过闸（根因#3「不过闸写不出来」成结构事实）：functions/ 下写 DB（.add/.set/.update/.remove）的函数须引 kit 闸（withOpenId/withAdminGate/defineNotifyCallback/defineKfCallback/isServerCall）或 checkKey；纯读（公开目录）豁免',
    run() {
      const root = join(ROOT, 'packages/cloud/src/functions')
      if (!existsSync(root)) return []
      const GATE = /\b(withOpenId|withAdminGate|defineNotifyCallback|defineKfCallback|isServerCall|checkKey)\b/
      const WRITE = /\.(add|set|update|remove)\s*\(/
      const readAll = (d) => {
        let src = ''
        for (const f of lsScan(d)) {
          const fp = join(d, f)
          if (statSync(fp).isDirectory()) src += readAll(fp)
          else if (f.endsWith('.ts')) src += readFileSync(fp, 'utf8')
        }
        return src
      }
      const bad = []
      for (const domain of readdirSync(root)) {
        const dp = join(root, domain)
        if (!statSync(dp).isDirectory()) continue
        for (const entry of readdirSync(dp)) {
          const ep = join(dp, entry)
          const st = statSync(ep)
          // 函数单元：单文件 <域>/<name>.ts，或目录型 <域>/<name>/（闸在 index、写在 actions，合并看）
          const src = st.isDirectory() ? readAll(ep) : entry.endsWith('.ts') ? readFileSync(ep, 'utf8') : ''
          if (src && WRITE.test(src) && !GATE.test(src)) {
            bad.push(`${domain}/${entry} 写库但未过任何 kit 闸（根因#3：写库必过闸）`)
          }
        }
      }
      return bad
    },
  },
  {
    id: 'console-assets-present',
    roots: ['#9'],
    desc: '控制台资产正册不可误删（根因#9）：console-assets 关键正册文件须存在（git 外资产的唯一版本化记录）',
    run() {
      const bad = []
      for (const f of [
        'console-assets/README.md',
        'console-assets/01-支付退款工作流.md',
        'console-assets/02-库权限期望表.md',
        'console-assets/03-复合索引期望表.md',
        'console-assets/forward-node.js',
      ]) {
        if (!existsSync(join(ROOT, f))) bad.push(`${f} 缺失（控制台资产正册不可删，根因#9）`)
      }
      return bad
    },
  },
  {
    id: 'deploy-config-complete',
    roots: ['#8'],
    desc: '部署配置完整（根因#8 dry-run 过≠真部署能用·病根#16 指针漂移）：cloudbaserc.json functions 须与**活线** rewrite/cloud/src/functions 的部署单元（build.mjs collect() 同规则：顶层带 main 的 index.ts / 子目录 index.ts / 子 .ts）一一对应——漏配置真部署会卡交互确认（login 漏配即此坑 2026-06-14；2026-07-19 复现：新线 16 函数全缺配置，tcb 改问「用默认配置？」，答 y 会把 adminApi/cleanupEvents/recallScan 等 9 个函数超时按默认 15s 覆盖线上真值 20-30s）',
    run() {
      const rc = join(ROOT, 'cloudbaserc.json')
      const fnRoot = join(ROOT, 'rewrite/cloud/src/functions') // 活线（M5 后唯一部署源）·旧线 packages 已清退
      if (!existsSync(rc) || !existsSync(fnRoot)) return []
      const configured = new Set((JSON.parse(readFileSync(rc, 'utf8')).functions || []).map((f) => f.name))
      // 部署单元枚举＝镜像 rewrite/cloud/build.mjs collect()：顶层目录含带 main 的 index.ts 即一个函数
      // （app/adminApi），否则下探一层——子目录的 index.ts 或子 .ts 文件，均须含 `export const main`。
      const hasMain = (fp) => readFileSync(fp, 'utf8').includes('export const main')
      const actual = []
      for (const top of readdirSync(fnRoot)) {
        const tp = join(fnRoot, top)
        if (!statSync(tp).isDirectory()) continue
        const idx = join(tp, 'index.ts')
        if (existsSync(idx) && hasMain(idx)) {
          actual.push(top)
          continue
        }
        for (const e of readdirSync(tp)) {
          const ep = join(tp, e)
          if (statSync(ep).isDirectory()) {
            const ci = join(ep, 'index.ts')
            if (existsSync(ci) && hasMain(ci)) actual.push(e)
          } else if (e.endsWith('.ts') && !e.endsWith('.d.ts') && hasMain(ep)) {
            actual.push(e.slice(0, -3))
          }
        }
      }
      const bad = []
      // 别名展开（病根#16）：adminApi 产物亦部署为 adminApiV2（/adminv2·admin 前端调用方）——单源 lib/deploy-aliases.mjs
      const expanded = allDeployNames(actual)
      for (const name of expanded) if (!configured.has(name)) bad.push(`活线云函数 ${name} 缺 cloudbaserc.json 配置——真部署会卡交互确认、答 y 即按默认参数覆盖线上真值（根因#8/#16）`)
      for (const name of configured) if (!expanded.includes(name)) bad.push(`cloudbaserc.json 配了不存在的函数 ${name}——孤儿配置（部署别名请登记 scripts/lib/deploy-aliases.mjs）`)
      return bad
    },
  },
  {
    id: 'deploy-gated',
    roots: ['铁律'],
    desc: '生产部署闸（接管 tcb，用户拍板 A）：**实跑** guard-deploy 断言行为——敏感函数/批量部署→ask 二次确认、读类/单个非敏感→放行、提交信息字样不误拦。行为偏离即红（grep 易被注释蒙混，故跑真行为）',
    run() {
      const abs = join(ROOT, 'scripts/guard-deploy.mjs')
      if (!existsSync(abs)) return ['scripts/guard-deploy.mjs 不存在（部署闸缺失）']
      const decide = (command) => {
        try {
          const out = execSync(`node ${abs}`, { input: JSON.stringify({ tool_input: { command } }), encoding: 'utf8' })
          return /"ask"/.test(out) ? 'ask' : 'allow'
        } catch {
          return 'error'
        }
      }
      const cases = [
        ['tcb fn deploy createOrder', 'ask'], // 敏感函数 → 确认
        ['tcb fn deploy getProducts', 'ask'], // 批I 起 READONLY_FNS=[]：旧线纯读函数已清退·部署同名=新建孤儿 → 一律 ask（唯一放行洞已堵）
        ['tcb fn invoke getProducts', 'allow'], // 读类（invoke 非写）→ 放行
        ['git commit -m chore-tcb-deploy-fns', 'allow'], // 提交信息提字样 → 不拦
        ['DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs', 'ask'], // 批量部署 → 确认
        // 深审 P1 绕过实录（防回归）：三种自然命令形态过去全放行，现须一律 ask
        ['npx tcb fn deploy adminApi', 'ask'], // runner 前缀（tcb not found 时最自然的改写）
        ['npx @cloudbase/cli fn deploy payCallback', 'ask'], // runner + 包名（bin=tcb）
        ['env DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs', 'ask'], // env 前缀不进 envPrefix
        ['export DEPLOY_ALLOWED=1; node scripts/deploy-fns.mjs', 'ask'], // export 被 ';' 拆段
      ]
      const bad = []
      for (const [cmd, want] of cases) {
        const got = decide(cmd)
        if (got !== want) bad.push(`guard-deploy「${cmd}」期望 ${want}、实际 ${got}——生产部署闸行为偏离（接管 tcb 安全线）`)
      }
      return bad
    },
  },
  {
    id: 'format-hook-wired',
    roots: ['格式'],
    desc: '格式交给工具：.claude/settings.json 的 PostToolUse(Edit|Write) 须挂 format-hook.mjs——编辑即由 prettier 格式化，不退回手动 npm run format（主张回退=红灯）',
    run() {
      const abs = join(ROOT, '.claude/settings.json')
      if (!existsSync(abs)) return ['.claude/settings.json 缺失——PostToolUse 格式化 hook 无处可挂']
      const post = JSON.parse(readFileSync(abs, 'utf8'))?.hooks?.PostToolUse ?? []
      const wired = post.some(
        (e) =>
          /Edit|Write/.test(e.matcher || '') &&
          (e.hooks || []).some((h) => (h.command || '').includes('format-hook.mjs'))
      )
      return wired
        ? []
        : ['.claude/settings.json PostToolUse 未挂 format-hook.mjs——格式化退回手动，「格式交给工具」主张回退']
    },
  },
  {
    // 元守卫——守的是「框架完整性」本身（元模式 A4「闸自己守着闸」）。
    // 把账本 §四「完整性自查」从人工对照升级为机器可证：每条病根都得有守卫或靠人豁免。
    id: 'guard-coverage',
    roots: ['元'],
    desc: '覆盖率闭环：根因账本每条病根都须有 ≥1 守卫（某守卫 roots 含 #N）或 CLAUDE 靠人锚（[靠人:#N]）；且 CLAUDE [机器守:id] 与 test 型守卫文件须真实存在，防注册表空转',
    run() {
      const bad = []
      const ledgerPath = join(ROOT, 'docs/根因账本.md')
      if (!existsSync(ledgerPath)) return ['docs/根因账本.md 缺失（病根清单源）']
      // §一病根清单：取「## 二、」之前，抓 `### N.` 标题为病根 id（数随立新病根增·别在注释手抄）
      const sec1 = readFileSync(ledgerPath, 'utf8').split('## 二、')[0]
      const rootIds = [...sec1.matchAll(/^###\s*(\d+)\.\s/gm)].map((m) => `#${m[1]}`)
      if (!rootIds.length) bad.push('根因账本 §一 解析不到病根（### N. 标题）——覆盖率无从核')
      // 守卫 roots：本模块三数组 + conventions 规则
      const allGuards = [...repoChecks, ...fileRules, ...typeAndTestGuards, ...conventionRules]
      const guardRoots = new Set()
      for (const g of allGuards) for (const r of g.roots || []) guardRoots.add(r)
      // CLAUDE：靠人锚 + 机器守 tag
      const claudePath = join(ROOT, 'CLAUDE.md')
      const claude = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : ''
      const humanHeld = new Set([...claude.matchAll(/\[靠人:#(\d+)/g)].map((m) => `#${m[1]}`))
      // ① 每条病根有守卫或靠人豁免
      for (const id of rootIds) {
        if (!guardRoots.has(id) && !humanHeld.has(id)) {
          bad.push(`病根${id} 无机器守卫（无守卫 roots 含 ${id}）也无 CLAUDE 靠人豁免（[靠人:${id}]）——覆盖率缺口`)
        }
      }
      // ②a CLAUDE [机器守:id] 必须指向真实守卫（防文档标了不存在的守卫）
      const allIds = new Set(allGuards.map((g) => g.id))
      for (const m of claude.matchAll(/\[机器守:\s*([\w-]+)\]/g)) {
        if (!allIds.has(m[1])) bad.push(`CLAUDE.md 标 [机器守: ${m[1]}] 但无此守卫——文档/注册表漂移`)
      }
      // ②b test 型守卫 reverseTest 文件须存在（防注册表指向已删测试）
      for (const g of typeAndTestGuards) {
        if (g.mechanism === 'test' && !existsSync(join(ROOT, g.reverseTest))) {
          bad.push(`${g.id} 的 reverseTest 不存在：${g.reverseTest}——守卫空转`)
        }
      }
      return bad
    },
  },
  {
    // 病根#16（守卫绑定漂移·盲区体检 2026-07-18）：同 id 双注册=计数虚高+其中一份可能是已被
    // 验尸的坏版本仍在运行——当日实况：rw-scm-ledger-idempotent 批S 修复版的注释写着旧版
    // 「两条独立正则各自宽松匹配…都仍然各自绿」的死因，而那个旧版本体同时仍在册跑了 6 天；
    // guard-count-synced 数 repoChecks.length 把含重复的 199/200 盖章进文档。id 唯一是
    // 「注册表=真相」的最低门槛；违反 /refactor-batch「顺手退役（删与加对等）」纪律的机器兜底。
    id: 'guard-id-unique',
    roots: ['#16'],
    desc: '守卫注册表 id 唯一（病根#16）：repoChecks/fileRules/typeAndTestGuards/conventionRules 四表之内与跨表 id 不得重复——重复=移植/折叠后旧副本未退役（批K/批S 前科），删旧前先核对断言面差异再合并',
    run() {
      const seen = new Map()
      const dup = []
      for (const [arr, label] of [
        [repoChecks, 'repoChecks'],
        [fileRules, 'fileRules'],
        [typeAndTestGuards, 'typeAndTestGuards'],
        [conventionRules, 'conventionRules'],
      ]) {
        for (const g of arr) {
          if (!g || !g.id) continue
          if (seen.has(g.id))
            dup.push(`守卫 id '${g.id}' 重复注册：${seen.get(g.id)} 与 ${label} 各一份——旧副本未随移植退役（删旧留新·先核对两副本断言面差异，缺的分支移植过去）`)
          else seen.set(g.id, label)
        }
      }
      return dup
    },
  },
  {
    // 病根#16（守卫绑定漂移·盲区体检批2）：guard-coverage 只核「有守卫声明 roots 含此病根」——
    // 声明层；一条守卫可以挂着 roots:['T4'] 却只扫再不会改动的冻结目录，覆盖率照绿（dep-direction
    // 在活线空转即前科）。本守卫把「声称守活线」与「真够得着活线」机器对齐：逐条 fileRule 对
    // rewrite/ 实走 inScope，零命中且不在 OLDLINE_SCOPE_OK 白名单即红；金丝雀夹具在位一并核
    // （金丝雀是扫描面回潮的行为哨兵——被删=哨位空了，与「哨兵失效」同级对待）。
    id: 'guard-scan-liveness',
    roots: ['#16'],
    desc: '守卫扫描面活性下限（病根#16）：每条 fileRule 的 inScope 须命中 ≥1 个 rewrite/ 活线文件，守冻结参照的须显式列入 OLDLINE_SCOPE_OK 白名单（随 packages/ 处置拍板一并退役）；金丝雀夹具（rewrite/mp/.claude/worktrees/fixture-scan-surface/）在位一并核——防 dep-direction 式「声称覆盖、实际空转」复发',
    run() {
      const bad = []
      for (const c of [
        'rewrite/mp/.claude/worktrees/fixture-scan-surface/canary.ts',
        'rewrite/mp/.claude/worktrees/fixture-scan-surface/canary.md',
      ])
        if (!existsSync(join(ROOT, c))) bad.push(`${c} 缺失——扫描面金丝雀被拆（病根#16 哨兵·删除须先拍板退役）`)
      // 守冻结 packages/ 参照的旧线 fileRule 白名单（待办与债 债7：随 packages/ 处置拍板一并退役）
      const OLDLINE_SCOPE_OK = new Set(['kit-only-cloud-primitives', 'flow-seam-via-kit', 'money-via-fen', 'api-cloud-only', 'dep-direction'])
      const hits = new Map(fileRules.map((r) => [r.id, 0]))
      for (const f of walk(join(ROOT, 'rewrite'))) for (const r of fileRules) if (r.inScope(f)) hits.set(r.id, hits.get(r.id) + 1)
      for (const r of fileRules) {
        if (OLDLINE_SCOPE_OK.has(r.id)) continue
        if (!hits.get(r.id))
          bad.push(`fileRule '${r.id}' 在 rewrite/ 活线零命中且不在 OLDLINE_SCOPE_OK 白名单——扫描面空转（病根#16·dep-direction 前科：声称守 T4 实扫冻结线）`)
      }
      return bad
    },
  },
  {
    // 病根#16 ⑤（盲区体检批3·指针大迁移）：M5 切换（2026-07-09）搬走了生产，没有任何机制清点
    // 「指向生产的引用」——oldline-frozen 守住旧线字节、没守指向旧线的指针。当日实况：deploy-fns.mjs
    // 仍 build:cloud + packages/cloud/dist + 38 函数旧 manifest——hash 匹配则报「变更待部署 0 个」
    // 假全清（app 函数落后半月无人察觉的根因），不匹配则会把冻结旧线覆盖上生产、复活已删的 26 函数；
    // deploy-test.mjs 同病。本守卫：会动环境/验产物的工具脚本禁引用旧线，声明为旧线专属的进白名单
    // （各带一句为什么），新脚本引用 packages/ 当场红。
    id: 'rw-toolchain-no-oldline',
    roots: ['#16'],
    desc: '工具链禁旧线引用（病根#16 ⑤·M5 残留指针清点）：scripts/ 下 .mjs/.cjs（守卫注册表两文件除外——其内旧线路径是「守冻结参照」的守卫本体）与 .github/workflows/ 禁出现 packages/cloud、packages/miniapp、build:cloud 任一 token；旧线专属工具白名单豁免（freeze 工具/旧线产物验证/旧线视觉回归/旧线格式化域/体检面板标注）——随 packages/ 处置拍板一并清退',
    run() {
      // 白名单：声明就是旧线专属/守冻结参照的工具（值=为什么在册）。deploy-fns/deploy-test 刻意不在册。
      const OLDLINE_TOOLS = new Map([
        ['scripts/freeze-oldline.mjs', '冻结基线工具本体'],
        ['scripts/oldline-freeze-lib.mjs', '冻结基线 lib'],
        ['scripts/verify-cloud-bundles.cjs', '旧线产物行为验证（自声明 B 类·活线版另有 verify-rw-cloud-bundles）'],
        ['scripts/visual-check.cjs', '旧线视觉回归（扫描面=packages/miniapp dist·新线走 mp-smoke）'],
        ['scripts/format-hook.mjs', '格式化域刻意锁旧线（其头注成文·扩域是另一笔决策）'],
        ['scripts/check-report.mjs', '体检面板把 packages/miniapp 标注为「旧线」——标注非引用'],
        ['scripts/lib/brand-font-charset.mjs', '字体字集扫描含旧线参照面（sweep 自带 dot 排除）'],
        ['scripts/build-brand-font.mjs', '品牌字体构建·扫描面含旧线参照'],
      ])
      const REGISTRY = new Set(['scripts/check-structure.mjs', 'scripts/check-conventions.mjs'])
      const TOKEN = /packages\/(cloud|miniapp)|build:cloud\b/
      const bad = []
      const scanDirs = ['scripts', '.github/workflows']
      for (const dir of scanDirs) {
        const abs = join(ROOT, dir)
        if (!existsSync(abs)) continue
        const files = []
        const collect = (d) => {
          for (const e of lsScan(d)) {
            const p = join(d, e)
            if (statSync(p).isDirectory()) collect(p)
            else if (/\.(mjs|cjs|yml|yaml)$/.test(e)) files.push(p)
          }
        }
        collect(abs)
        for (const f of files) {
          const rel = relative(ROOT, f).replace(/\\/g, '/')
          if (REGISTRY.has(rel) || OLDLINE_TOOLS.has(rel)) continue
          // 剥注释再扫（E1 纪律·stripComments 单源）：迁移史/为什么的说明就该写在注释里，不算引用
          const src = stripComments(readFileSync(f, 'utf8'))
          if (TOKEN.test(src))
            bad.push(`${rel} 引用旧线（packages/cloud|packages/miniapp|build:cloud）——生产线在 rewrite/，该迁未迁的指针会假全清或把冻结旧线部署上生产（病根#16 ⑤·M5 残留）；确属旧线专属工具则进 OLDLINE_TOOLS 白名单并写明为什么`)
        }
      }
      return bad
    },
  },
  {
    // 根因#8「构建过≠真能用」在部署产物层的镜像（盲区体检批4·病根#16 配套）：三道闸此前从不
    // 构建任何真实生产产物——build:rw-cloud/rw-admin/agent/site 四个真实构建在编辑 hook/pre-commit
    // /CI 里一次都没跑过；「把产物 require 进来真跑」的行为级验证只有旧线有（verify-cloud-bundles
    // 只验冻结 packages/cloud/dist）。本守卫钉住产物闸接线不许静默掉：check:artifacts 脚本存在且
    // 含四个面 + CI 真跑它 + 活线产物验证脚本在位。（产物闸 CI-only：vite/astro 构建分钟级，进
    // pre-commit 会把每次提交拖到分钟级——三道闸单一定义指 npm run check，产物闸是 CI 追加硬化层。）
    id: 'rw-artifact-gate-in-ci',
    roots: ['#8', '#16'],
    desc: '产物闸接线（根因#8 部署产物层镜像·病根#16 配套）：package.json 须有 check:artifacts（含 verify:rw-cloud + build:rw-admin + build:agent + @ldrw/site 构建四面）、.github/workflows/ci.yml 须真跑 check:artifacts、scripts/verify-rw-cloud-bundles.cjs 在位——防「CI 全绿但生产产物从未被构建/加载过」复发',
    run() {
      const bad = []
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      const ca = (pkg.scripts || {})['check:artifacts'] || ''
      if (!ca) bad.push('package.json 无 check:artifacts 脚本——产物闸未定义（根因#8·四个真实构建零闸覆盖）')
      else
        for (const piece of ['verify:rw-cloud', 'build:rw-admin', 'build:agent', '@ldrw/site'])
          if (!ca.includes(piece)) bad.push(`check:artifacts 缺 ${piece} 面——产物闸不全（根因#8）`)
      const vs = (pkg.scripts || {})['verify:rw-cloud'] || ''
      if (!/build:rw-cloud/.test(vs) || !/verify-rw-cloud-bundles/.test(vs))
        bad.push('verify:rw-cloud 须 = build:rw-cloud + verify-rw-cloud-bundles.cjs（先构建再产物验证）')
      if (!existsSync(join(ROOT, 'scripts/verify-rw-cloud-bundles.cjs')))
        bad.push('scripts/verify-rw-cloud-bundles.cjs 缺失——活线产物行为验证真空（旧线 verify 只验冻结线）')
      const ci = join(ROOT, '.github/workflows/ci.yml')
      if (!existsSync(ci) || !/check:artifacts/.test(readFileSync(ci, 'utf8')))
        bad.push('.github/workflows/ci.yml 未跑 check:artifacts——产物闸没进 CI（构建过≠真能用在产物层无人守）')
      return bad
    },
  },
  {
    // 依赖安全审计接线（B8·2026-07-19 快照）：本地 `npm audit --omit=dev` 实测 40 条
    // 既有告警（13 high / 14 moderate / 13 low，0 critical）；非 --force 的
    // `npm audit fix` 只能修 1 个 moderate（postcss），13 条 high 全部需要
    // --force（breaking：@dcloudio/uni-mp-weixin 等），故本批只接「可见性」
    // （CI 报告模式 + continue-on-error），不升级为 blocking——升级前置条件
    // （清存量或显式接受风险记账）见 docs/待办与债.md。仿 rw-artifact-gate-in-ci
    // 同款「闸不能被悄悄拆」模式：只钉「这一步真的在 CI 里跑」，不评判闸门
    // 严格度（严格度是产品/风险决策，机器管不着也不该管）。
    id: 'ci-audit-step-present',
    roots: ['铁律'],
    desc: 'CI 依赖安全审计步骤在位（铁律·仿 rw-artifact-gate-in-ci 模式）：.github/workflows/ci.yml 须含 `npm audit` 调用——防依赖安全审计（当前报告模式·B8 起步）被静默摘除',
    run() {
      const f = '.github/workflows/ci.yml'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 不存在（依赖安全审计闸缺失）`]
      if (!/npm audit\b/.test(readFileSync(abs, 'utf8')))
        return [`${f} 未见 npm audit 步骤——依赖安全审计（B8 报告模式）被摘除或从未接线`]
      return []
    },
  },
  {
    id: 'requirement-trace',
    roots: ['元'],
    desc: '需求→守卫闭环（仿 guard-coverage 泛化「病根→守卫」为「需求→功能→守卫」）：需求清单「需求→实现映射」每条 ✅ 实现需求(L1)须有映射行，且行内 函数(见系统事实)/测试(tests/cloud)/守卫(注册表) 真实存在——改需求或改码断链当场红；`npm run trace R#` 查爆炸半径。⚠️ 深审 P3：映射表函数/测试(tests/cloud)全锚**冻结旧线**，旧线冻结⇒对唯一在迭代的 rewrite 实现该守卫的「改码断链当场红」永不触发——是旧线参照链；新线需求追溯（R34/R38 等 rewrite 已实现）走各 rw- golden 守卫、未纳入本表（未闭合债·docs/待办与债）',
    run() {
      const reqPath = join(ROOT, 'docs/需求清单.md')
      if (!existsSync(reqPath)) return ['docs/需求清单.md 缺失（需求源）']
      const bad = []
      const req = readFileSync(reqPath, 'utf8')
      const factPath = join(ROOT, 'docs/系统事实.md')
      const fact = existsSync(factPath) ? readFileSync(factPath, 'utf8') : ''
      const guardIds = new Set(
        [...repoChecks, ...fileRules, ...typeAndTestGuards, ...conventionRules].map((g) => g.id)
      )
      const mapSec = req.split('## 需求→实现映射')[1] || ''
      const rows = [...mapSec.matchAll(/^\|\s*(R\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)]
      const mapped = new Set(rows.map((r) => r[1]))
      // ① 每条 ✅ 实现需求（L1）有映射行
      const l1 = (req.split('## L1')[1] || '').split('## L2')[0]
      for (const m of l1.matchAll(/^\|\s*(R\d+)\b[^\n]*\|\s*✅\s*\|/gm)) {
        if (!mapped.has(m[1])) bad.push(`${m[1]}（✅ 已实现需求）无「需求→实现映射」行——需求→守卫闭环缺口`)
      }
      // ②③ 每行 函数/测试/守卫 resolve（断链红）+ 须守卫覆盖（钱/状态/安全类须有对应类守卫）
      const cells = (s) => s.split(/[,，、]/).map((x) => x.trim().replace(/`/g, '')).filter(Boolean)
      const KIND_GUARDS = {
        钱: ['fen-branded-type', 'fen-money-chain', 'money-via-fen'],
        状态: ['transition-atomic-idempotent', 'order-status-union'],
        安全: ['writes-need-gate', 'kit-only-cloud-primitives', 'deterministic-id-concurrency', 'notify-forge-proof', 'gate-fail-closed'],
      }
      for (const [, R, kind, fns, tests, guards] of rows) {
        for (const fn of cells(fns)) if (!fact.includes(fn)) bad.push(`${R} 函数「${fn}」未见于 系统事实——链接断（改名/删了忘更新映射）`)
        for (const t of cells(tests)) if (!existsSync(join(ROOT, 'tests/cloud', t))) bad.push(`${R} 测试「${t}」不存在 tests/cloud/`)
        for (const g of cells(guards)) if (g !== '—' && !guardIds.has(g)) bad.push(`${R} 守卫「${g}」非已知守卫 id`)
        const need = KIND_GUARDS[(kind || '').trim()]
        if (need && !cells(guards).some((g) => need.includes(g)))
          bad.push(`${R}（${kind.trim()}类）须守卫缺口——守卫里无${kind.trim()}类（${need.join('/')}）`)
      }
      return bad
    },
  },
  {
    id: 'requirement-tally-synced',
    roots: ['#11'],
    desc: '需求复核计数自洽（规则⑥·客观计数机器维护·熵地图 E2）：需求清单「复核进度/复核小结」的 ✅/⚠️/💬/🗑️/⬜ 计数须等于 L0/L1/L2 判定列实际 tally——防 R 逐条定论后摘要忘回写漂移（doc-audit round-2 命中 26 ✅/4 💬 vs 真值 29/1）。tally 源＝判定列本身（映射表行末格是守卫名无 emoji·自然排除）',
    run() {
      const p = join(ROOT, 'docs/需求清单.md')
      if (!existsSync(p)) return []
      const text = readFileSync(p, 'utf8')
      const MARKS = ['✅', '⚠️', '🗑️', '💬', '⬜']
      const tally = { '✅': 0, '⚠️': 0, '🗑️': 0, '💬': 0, '⬜': 0 }
      // 判定列＝以「| R<数字>」起的表行的最后一个非空单元格里首个判定 emoji
      for (const line of text.split('\n')) {
        if (!/^\|\s*\*{0,2}R\d/.test(line)) continue
        const cells = line.split('|').map((c) => c.trim()).filter(Boolean)
        const last = cells[cells.length - 1] || ''
        const mark = MARKS.find((m) => last.includes(m))
        if (mark) tally[mark]++
      }
      const bad = []
      // 摘要行＝形如「N ✅ / N ⚠️ …」；各 emoji 计数须等于 tally（图例行无前导数字·不匹配）
      for (const line of text.split('\n')) {
        if (!/\d+\s*✅\s*\/\s*\d+\s*⚠️/.test(line)) continue
        for (const m of MARKS) {
          const mm = line.match(new RegExp('(\\d+)\\s*' + m))
          if (mm && Number(mm[1]) !== tally[m])
            bad.push(`需求清单摘要「${mm[1]} ${m}」≠ 判定列实际 tally ${tally[m]}（R 逐条定论后摘要忘回写·熵地图 E2·别手抄）`)
        }
      }
      return bad
    },
  },
  {
    id: 'admin-login-throttled',
    roots: ['#13'],
    desc: '认证端点防爆破（根因#13·**旧线冻结参照**·生产线由 rw-admin-login-throttled 守）：adminApi 口令校验路径必经频控闸（throttleLocked + 失败 throttleFail），杜绝公网口令无限重试爆破',
    run() {
      const bad = []
      // 老线（packages/cloud·字节冻结参照）+ 活线（rewrite/cloud·唯一部署版本）并守
      const files = [
        'packages/cloud/src/functions/admin/adminApi/index.ts',
        'rewrite/cloud/src/functions/adminApi/index.ts',
      ]
      for (const f of files) {
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        if (!/throttleLocked\s*\(/.test(src)) bad.push(`${f} 未经 throttleLocked 闸——认证端点无锁定、公网口令可被爆破（根因#13）`)
        if (!/throttleFail\s*\(/.test(src)) bad.push(`${f} 失败未 throttleFail 计数——频控空转（根因#13）`)
      }
      return bad
    },
  },
  {
    id: 'user-writes-throttled',
    roots: ['#13'],
    desc: '用户端可滥用写函数防刷（根因#13·**旧线冻结参照**·生产线由 rw-user-writes-throttled 守）：高频/造数写函数（trackEvent/createOrder/login/updateProfile）必经 withRateLimit（按 openid 限频），防无限刷库/堆垃圾/成本',
    run() {
      const bad = []
      // 老线（packages/cloud·字节冻结·一函数一文件）：文件存在即须见 withRateLimit
      const oldTargets = ['learning/trackEvent', 'orders/createOrder', 'user/login', 'user/updateProfile']
      for (const t of oldTargets) {
        const f = `packages/cloud/src/functions/${t}.ts`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失`)
          continue
        }
        if (!/withRateLimit\s*\(/.test(readFileSync(abs, 'utf8'))) {
          bad.push(`${f} 未经 withRateLimit——可滥用写函数无频控、可被刷（根因#13）`)
        }
      }
      // 活线（rewrite/cloud·多 action 合于一文件）：按「文件 + withRateLimit 标签」核每个用户写 action 被包裹
      const rwTargets = [
        { file: 'learning.ts', label: 'trackEvent' },
        { file: 'checkpoint.ts', label: 'submitCheckpointPhoto' },
        { file: 'cs.ts', label: 'kfBind' },
        { file: 'cs.ts', label: 'dataConsent' },
        { file: 'feedback.ts', label: 'submitFeedback' },
        { file: 'orders.ts', label: 'createOrder' },
        { file: 'user.ts', label: 'login' },
        { file: 'user.ts', label: 'updateProfile' },
        { file: 'reviews.ts', label: 'submitReview' },
      ]
      for (const { file, label } of rwTargets) {
        const f = `rewrite/cloud/src/functions/app/actions/${file}`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失——活线用户写函数（${label}）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        if (!new RegExp(`withRateLimit\\s*\\(\\s*['"]${label}['"]`).test(src))
          bad.push(`${f} 的 ${label} 未经 withRateLimit(${label}) 包裹——可滥用写函数无频控、可被刷（根因#13·活线唯一部署版本）`)
      }
      return bad
    },
  },
  {
    id: 'rw-admin-login-throttled',
    roots: ['#13'],
    desc: '认证端点防爆破·生产线（根因#13·深审 P2 补：admin-login-throttled 只扫冻结旧线 packages/ 是假绿）：生产线 adminApi（rewrite/cloud）口令校验路径必经频控闸（throttleLocked + 失败 throttleFail），删掉即公网口令可无限爆破',
    run() {
      const f = 'rewrite/cloud/src/functions/adminApi/index.ts'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失（生产线 adminApi 应在此）`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (!/throttleLocked\s*\(/.test(src)) bad.push(`${f} 未经 throttleLocked 闸——认证端点无锁定、公网口令可被爆破（根因#13）`)
      if (!/throttleFail\s*\(/.test(src)) bad.push(`${f} 失败未 throttleFail 计数——频控空转（根因#13）`)
      return bad
    },
  },
  {
    id: 'rw-user-writes-throttled',
    roots: ['#13'],
    desc: '用户端可滥用写函数防刷·生产线（根因#13·深审 P2 补：user-writes-throttled 只扫冻结旧线是假绿·深审「activateCourse/confirmEnter 无频控」同批修）：生产线 app 域用户可调写 action 必经 withRateLimit——尤其激活码兑换类（activateCourse/confirmEnter）是猜码爆破面',
    run() {
      // export 名 → 所在 action 文件（rewrite 按域聚合·一文件多 action，故按 withRateLimit('<name>' 精确核到具体导出）
      const targets = [
        ['createOrder', 'orders'],
        ['trackEvent', 'learning'],
        ['activateCourse', 'learning'],
        ['confirmEnter', 'learning'],
        ['login', 'user'],
        ['updateProfile', 'user'],
        ['submitFeedback', 'feedback'],
        ['submitCheckpointPhoto', 'checkpoint'],
        ['kfBind', 'cs'],
        ['dataConsent', 'cs'],
      ]
      const bad = []
      for (const [name, file] of targets) {
        const f = `rewrite/cloud/src/functions/app/actions/${file}.ts`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        if (!new RegExp(`withRateLimit\\(\\s*['"]${name}['"]`).test(src)) {
          bad.push(`${f} 的 ${name} 未经 withRateLimit——用户可调写函数无频控可被刷/爆破（根因#13）`)
        }
      }
      return bad
    },
  },
  {
    id: 'rw-cs-360-read-audited',
    roots: ['#3'],
    desc: '360 读他人全貌破例留痕·生产线（§1.5·根因#3·深审 P2 补：cs-360-read-audited 只焊冻结旧线是假绿）：生产线 rewrite/cloud/src/kit/audit.ts 须有 FORCE_AUDIT 名单含 getCustomer360/getUser/searchCustomer/getSessionCustomer360 强制留痕（防 PII 访问 0 痕）',
    run() {
      const audit = 'rewrite/cloud/src/kit/audit.ts'
      if (!existsSync(join(ROOT, audit))) return [`${audit} 缺失——生产线审计原语`]
      const src = readFileSync(join(ROOT, audit), 'utf8')
      const bad = []
      const set = src.match(/FORCE_AUDIT\s*=\s*new Set\(\[([\s\S]*?)\]\)/)
      if (!set) bad.push(`${audit} 无 FORCE_AUDIT 名单——360 读越权面无法破例留痕（§1.5·根因#3）`)
      else
        for (const a of ['getCustomer360', 'getUser', 'searchCustomer', 'getSessionCustomer360'])
          if (!new RegExp(`['"]${a}['"]`).test(set[1]))
            bad.push(`${audit} FORCE_AUDIT 未含 ${a}——读他人全貌/检索 0 留痕（§1.5·根因#3）`)
      return bad
    },
  },
  {
    id: 'rw-cs-360-rbac-gated',
    roots: ['#3'],
    desc: '360 读须能力闸·生产线（§1.5·根因#3·深审 P2 补：cs-360-rbac-gated 只焊冻结旧线是假绿）：生产线 rewrite/cloud/src/functions/adminApi/index.ts 须有 ACTION_CAPS 含 getCustomer360/getUser/searchCustomer→customer:view，且按 caps 校验拒绝',
    run() {
      const idx = 'rewrite/cloud/src/functions/adminApi/index.ts'
      if (!existsSync(join(ROOT, idx))) return [`${idx} 缺失`]
      const src = readFileSync(join(ROOT, idx), 'utf8')
      const bad = []
      const caps = src.match(/const ACTION_CAPS[^{]*\{([\s\S]*?)\}/)
      if (!caps) bad.push(`${idx} 无 ACTION_CAPS 能力闸——360 读无 RBAC（§1.5·根因#3）`)
      else
        for (const a of ['getCustomer360', 'getUser', 'searchCustomer'])
          if (!new RegExp(`\\b${a}\\s*:`).test(caps[1]))
            bad.push(`ACTION_CAPS 未含 ${a}——任何登录即可读他人全貌/检索客户（§1.5·根因#3）`)
      if (!/\bcaps\b/.test(src)) bad.push(`${idx} 未按 caps 校验——能力闸空转（§1.5）`)
      return bad
    },
  },
  {
    id: 'rw-conversations-archived',
    roots: ['#3'],
    desc: '客服会话归档挂载 + 隐私声明·生产线（B5.1·根因#3·深审 P2 补：conversations-archived 只焊冻结旧线是假绿）：生产线 archive.ts 须真写 conversations 集合；kfCallback/index.ts 须真调 archiveInbound + archiveOutbound；会话含 PII·协议页须声明「客服会话记录」被收集',
    run() {
      const bad = []
      const arch = 'rewrite/cloud/src/functions/cs/kfCallback/archive.ts'
      const absArch = join(ROOT, arch)
      if (!existsSync(absArch)) bad.push(`${arch} 缺失——生产线会话归档接缝（B5.1）`)
      else if (!/COLLECTIONS\.conversations|['"]conversations['"]/.test(readFileSync(absArch, 'utf8')))
        bad.push(`${arch} 未写 conversations 集合——归档接缝是摆设（B5.1·扫真实写入·非注释）`)
      const idx = 'rewrite/cloud/src/functions/cs/kfCallback/index.ts'
      const absIdx = join(ROOT, idx)
      if (!existsSync(absIdx)) bad.push(`${idx} 缺失——微信客服回调（归档挂点）`)
      else {
        const s = readFileSync(absIdx, 'utf8')
        if (!/archiveInbound\s*\(/.test(s)) bad.push(`${idx} 未调 archiveInbound——入站客户消息未落档（B5.1·防摘归档）`)
        if (!/archiveOutbound\s*\(/.test(s)) bad.push(`${idx} 未调 archiveOutbound——出站回复未落档（B5.1·防摘归档）`)
      }
      // 隐私文案单源已随页面内容 CMS 战役迁 lib/mapPages.ts（agreement.ts 只渲染·文案默认值在 mapPages）——守卫锚随迁
      const agr = 'rewrite/mp/lib/mapPages.ts'
      const absAgr = join(ROOT, agr)
      if (existsSync(absAgr) && !/客服.{0,8}会话|会话记录/.test(readFileSync(absAgr, 'utf8')))
        bad.push(`${agr} 未声明「客服会话记录」被收集留存——会话含 PII·隐私声明漏（B5.1·根因#3）`)
      return bad
    },
  },
  {
    id: 'events-cleanup-wired',
    roots: ['债#9'],
    desc: 'events/rateLimit/kfSeen 定时清理（待办债#9 无界增长·外审 P2.14）：system/cleanupEvents 存在且删 events + 清过期 rateLimit 窗口 + kfState seen:* 去重痕 + cloudbaserc 配 timer，防回归成只增不删',
    run() {
      const bad = []
      const f = 'packages/cloud/src/functions/system/cleanupEvents.ts'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) {
        bad.push(`${f} 缺失——events 无定时清理（债#9 回归）`)
      } else {
        const src = readFileSync(abs, 'utf8')
        if (!/collection\(['"]events['"]\)/.test(src) || !/\.remove\s*\(/.test(src)) {
          bad.push(`${f} 未删 events——清理空转（债#9）`)
        }
        // P2.14 扩（无界增长·债#9 同治）：频控窗口 + 客服去重痕也须 TTL 清理。断言实清代码（collection(...).remove），
        // 非仅 token——防注释含 rateLimit/kfState 字样却没真清（守卫够不到「码 vs 注释」·见 stock-cas 同坑）。
        if (!/collection\(['"]rateLimit['"]\)[\s\S]{0,120}\.remove/.test(stripComments(src)))
          bad.push(`${f} 未清 rateLimit 过期窗口——频控集合无界增长（外审 P2.14·债#9）`)
        if (!/collection\(['"]kfState['"]\)[\s\S]{0,120}\.remove/.test(stripComments(src)))
          bad.push(`${f} 未清 kfState seen:* 去重痕——客服去重集合无界增长（外审 P2.14·债#9）`)
      }
      const rc = join(ROOT, 'cloudbaserc.json')
      if (existsSync(rc) && !/cleanupEvents/.test(readFileSync(rc, 'utf8'))) {
        bad.push(`cloudbaserc.json 未配 cleanupEvents——清理不被调度（债#9）`)
      }
      return bad
    },
  },
  {
    id: 'agreement-text-real',
    roots: ['R27'],
    desc: '协议正文非占位 + 第三方披露与代码一致（R27 上线必做㉑）：pages/agreement/index.vue 不得含「占位」语 + 须含精确隐私承诺「不通过微信授权获取」手机号（债#21：原「不采集手机号」与 address-edit 手填收货电话自相矛盾·须精确到微信授权口径）+ 条款条目齐（≥8 条「第N条」）+ 隐私政策第三方须如实列「快递100」（物流轨迹经其插件共享快递单号·事实对齐·与 express-plugin-wired 绑定·非法律判断），防占位文本/第三方漏披露上线',
    run() {
      const f = 'packages/miniapp/src/pages/agreement/index.vue'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失（协议页）`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (src.includes('占位')) bad.push(`${f} 仍含「占位」字样——协议正文未补全（R27㉑ 上线必做）`)
      if (!src.includes('不通过微信授权获取'))
        bad.push(`${f} 缺精确隐私承诺「不通过微信授权获取」手机号——隐私政策不完整 / 措辞不精确（R27㉑·债#21：blanket「不采集手机号」与手填收货电话矛盾）`)
      const articles = (src.match(/第[一二三四五六七八九十]+条/g) || []).length
      if (articles < 8) bad.push(`${f} 条款条目过少（${articles}<8 条「第N条」）——疑似仍是占位（R27㉑）`)
      // 第三方披露事实一致性（非法律判断·CC 可做的机械对齐）：物流轨迹经快递100 插件把快递单号给到第三方
      // （express-plugin-wired 锁此链路），隐私政策第三方条须如实列出，否则政策漏披露真实第三方（mp 隐私指引登记亦列此）。
      if (!/快递\s*100|kuaidi100/i.test(src))
        bad.push(`${f} 隐私政策第三方未列「快递100」——物流轨迹经快递100 插件共享快递单号·政策漏披露该第三方（事实对齐·与 express-plugin-wired 绑定·R27㉑）`)
      return bad
    },
  },
  {
    id: 'privacy-authorize-wired',
    roots: ['R27'],
    desc: '微信隐私授权已接（R27 上线必做㉒）：manifest mp-weixin 开 __usePrivacyCheck__ + usePrivacyGate 挂 onNeedPrivacyAuthorization + PrivacySheet 弹窗（agreePrivacyAuthorization 按钮）+ App.vue 启动注册，防隐私授权链回退；且任一页 mp 可达调涉隐私接口（chooseImage/getLocation…）→ 该页 index.vue 须挂 <PrivacySheet/>（挂载可达性·债#25：闸全局触发、弹窗须挂得到才渲得出）',
    run() {
      const bad = []
      const mani = join(ROOT, 'packages/miniapp/src/manifest.json')
      if (!existsSync(mani)) bad.push('packages/miniapp/src/manifest.json 缺失')
      else if (!/"__usePrivacyCheck__"\s*:\s*true/.test(readFileSync(mani, 'utf8')))
        bad.push('manifest.json 未开 __usePrivacyCheck__:true——微信隐私授权未启用（R27㉒）')
      const gate = join(ROOT, 'packages/miniapp/src/composables/usePrivacyGate.js')
      if (!existsSync(gate)) bad.push('composables/usePrivacyGate.js 缺失（隐私授权闸，R27㉒）')
      else if (!/onNeedPrivacyAuthorization/.test(readFileSync(gate, 'utf8')))
        bad.push('usePrivacyGate.js 未挂 wx.onNeedPrivacyAuthorization——授权回调未注册（R27㉒）')
      const sheet = join(ROOT, 'packages/miniapp/src/components/PrivacySheet.vue')
      if (!existsSync(sheet)) bad.push('components/PrivacySheet.vue 缺失（隐私授权弹窗，R27㉒）')
      else if (!/agreePrivacyAuthorization/.test(readFileSync(sheet, 'utf8')))
        bad.push('PrivacySheet.vue 无 agreePrivacyAuthorization 同意按钮——授权无法落地（R27㉒）')
      const app = join(ROOT, 'packages/miniapp/src/App.vue')
      if (existsSync(app) && !/registerPrivacyGate/.test(readFileSync(app, 'utf8')))
        bad.push('App.vue 未注册 registerPrivacyGate——onNeedPrivacyAuthorization 未挂（R27㉒）')
      // 挂载可达性（债#25/根因#8）：闸是全局注册（App.vue onNeedPrivacyAuthorization），任意页调涉隐私接口都会
      // 翻 privacySheetVisible；但 <PrivacySheet/> 须挂在该页才渲得出，否则用户点不了同意、resolve 永挂。
      // 故：任一页在 mp-weixin 可达地调隐私接口 → 该页根 index.vue 必挂 <PrivacySheet/>。宁过勿漏（见 mpReachableText）。
      const pagesRoot = join(ROOT, 'packages/miniapp/src/pages')
      const offenders = new Set()
      for (const f of walk(pagesRoot)) {
        if (!f.endsWith('.vue')) continue
        if (!PRIVACY_RE.test(mpReachableText(readFileSync(f, 'utf8')))) continue
        const rel = relative(ROOT, f).replace(/\\/g, '/')
        const mm = rel.match(/packages\/miniapp\/src\/pages\/([^/]+)\//)
        if (mm) offenders.add(mm[1])
      }
      for (const page of offenders) {
        const rootVue = join(pagesRoot, page, 'index.vue')
        if (!existsSync(rootVue) || !readFileSync(rootVue, 'utf8').includes('<PrivacySheet'))
          bad.push(`pages/${page} 调涉隐私接口却未在 index.vue 挂 <PrivacySheet/>——授权弹窗渲不出、resolve 永挂（债#25/R27㉒）`)
      }
      return bad
    },
  },
  {
    id: 'detail-share-wired',
    roots: ['R29'],
    desc: '详情页分享已接（R29 / 占位⑩）：detail 页挂 onShareAppMessage + 分享按钮 open-type="share" + utils/share 构造分享卡，防回退「敬请期待」Toast',
    run() {
      const bad = []
      const f = 'packages/miniapp/src/pages/detail/index.vue'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失（详情页）`]
      const src = readFileSync(abs, 'utf8')
      if (!/onShareAppMessage/.test(src)) bad.push(`${f} 未挂 onShareAppMessage——转发未接（R29⑩）`)
      if (/分享（敬请期待）/.test(src)) bad.push(`${f} 仍有「分享（敬请期待）」Toast——分享未补全（R29⑩）`)
      if (!/open-type="share"/.test(src)) bad.push(`${f} 分享按钮未用 open-type="share"——点不出转发（R29⑩）`)
      const util = 'packages/miniapp/src/utils/share.js'
      if (!existsSync(join(ROOT, util))) bad.push(`${util} 缺失（分享卡构造，R29⑩）`)
      return bad
    },
  },
  {
    // 数据页冷启/弱网空白态用骨架占位（优化批0618·T-F2）。根因#8「构建过+快网单人能用≠真机弱网能用」：
    // 空白/纯文字「加载中」是真机冷启才暴露的体验坑，机器先把「有真实空载态的数据页必挂骨架」钉死。
    // 册内只收真有空载态的页（catalog 冷启 EMPTY_COURSE 空章节 / order-list 冷启空列表）；
    // 首页走 LoadingSplash 全屏开屏、detail 样例数据即时渲染——各有其载态，强塞骨架=#8 theater，故不入册。
    id: 'list-pages-skeleton',
    roots: ['#8'],
    desc: '数据页空载态用 Skeleton 非空白（优化批0618·T-F2）：components/Skeleton.vue 存在 + 有真实冷启空白态的数据页（catalog/order-list/me）须挂 <Skeleton> 占位，防冷启/弱网白屏或纯文字「加载中」（「我」页继续学习卡冷启须骨架·不抢先显演示样例·根因#8；首页 LoadingSplash / detail 样例即时渲染另有载态，不入册）',
    run() {
      const bad = []
      const comp = 'packages/miniapp/src/components/Skeleton.vue'
      if (!existsSync(join(ROOT, comp))) bad.push(`${comp} 缺失（骨架屏组件，T-F2）`)
      const SKELETON_PAGES = ['catalog', 'order-list', 'me']
      for (const page of SKELETON_PAGES) {
        const f = `packages/miniapp/src/pages/${page}/index.vue`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失`)
          continue
        }
        if (!readFileSync(abs, 'utf8').includes('<Skeleton'))
          bad.push(`${f} 未挂 <Skeleton> 加载占位——冷启/弱网空白态（T-F2/根因#8）`)
      }
      return bad
    },
  },
  {
    // 数据页下拉刷新闭环（优化批0618·T-F3）。根因#8「构建过+快网单人能用≠真机能用」：
    // onPullDownRefresh 只由「页面级滚动」触发——内容装在整页 <scroll-view> 里滚动的页（index/me/cart）
    // 页面本身不滚，页面级 enablePullDownRefresh 在 mp-weixin 根本不触发（H5 也假绿）。故分两机制：
    //   ① 页面级滚动数据页 → pages.json enablePullDownRefresh + onPullDownRefresh + uni.stopPullDownRefresh；
    //   ② 整页 scroll-view 数据页 → scroll-view refresher-enabled + @refresherrefresh + :refresher-triggered。
    // 守卫钉死三件事：列举的数据页必接上对应机制（防漏接）；凡开了下拉刷新的页必有收尾（防转圈不停）。
    // cart 整页 scroll-view 但纯本地态（购物车条目 + 静态推荐）无远端可刷 → 不做 theater，不入册。
    id: 'pull-refresh-stops',
    roots: ['#8'],
    desc: '数据页下拉刷新闭环（优化批0618·T-F3）：① 页面级滚动数据页(catalog/order-list/reviews/aftersales/order)须 pages.json enablePullDownRefresh + onPullDownRefresh + stopPullDownRefresh；② 整页 scroll-view 数据页(index/me)须 refresher-enabled + @refresherrefresh + :refresher-triggered；③ 任何开 enablePullDownRefresh 的页必调 stopPullDownRefresh、任何用 refresher-enabled 的页必绑 @refresherrefresh+:refresher-triggered（防转圈不停·真机才暴露·根因#8）',
    run() {
      const bad = []
      const MINI = 'packages/miniapp/src'
      let pj = {}
      try {
        pj = JSON.parse(readFileSync(join(ROOT, MINI, 'pages.json'), 'utf8'))
      } catch {
        return ['packages/miniapp/src/pages.json 解析失败（下拉刷新核查）']
      }
      // pages.json：哪些 path 开了 enablePullDownRefresh
      const pullPaths = new Set()
      for (const p of pj.pages || []) {
        if (p.style && p.style.enablePullDownRefresh === true) pullPaths.add(p.path)
      }
      // ① 列举的页面级滚动数据页必开 enablePullDownRefresh（防漏接）
      // 注：order-list T-F4 后改 swiper+per-tab scroll-view（列表移入 scroll-view），下拉刷新随之
      // 从页面级迁到 scroll-view refresher（见下 REFRESHER_PAGES），故不在此页面级册内。
      const PAGE_PULL = [
        'pages/catalog/index',
        'pages/reviews/index',
        'pages/aftersales/index',
        'pages/order/index',
      ]
      for (const path of PAGE_PULL) {
        if (!pullPaths.has(path))
          bad.push(`${path} 未在 pages.json 开 enablePullDownRefresh——数据页下拉刷新漏接（T-F3）`)
      }
      // ③a 凡开 enablePullDownRefresh 的页：.vue 必有 onPullDownRefresh + stopPullDownRefresh（防转圈不停）
      for (const path of pullPaths) {
        const f = `${MINI}/${path}.vue`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失（pages.json 开了 enablePullDownRefresh）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        if (!/onPullDownRefresh\s*\(/.test(src))
          bad.push(`${f} 开了 enablePullDownRefresh 但无 onPullDownRefresh——下拉无响应（T-F3）`)
        if (!/stopPullDownRefresh/.test(src))
          bad.push(`${f} 开了 enablePullDownRefresh 但未调 stopPullDownRefresh——转圈不停（T-F3/根因#8）`)
      }
      // ② 列举的整页 scroll-view 数据页必走 scroll-view refresher（页面级下拉在此不触发）
      // order-list T-F4 后列表在 swiper 内的 scroll-view 滚动，下拉刷新随之走 refresher。
      const REFRESHER_PAGES = ['pages/index/index', 'pages/me/index', 'pages/order-list/index']
      for (const path of REFRESHER_PAGES) {
        const f = `${MINI}/${path}.vue`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失（整页 scroll-view 下拉刷新页）`)
          continue
        }
        if (!/refresher-enabled/.test(readFileSync(abs, 'utf8')))
          bad.push(`${f} scroll-view 未开 refresher-enabled——整页 scroll-view 下拉刷新漏接（T-F3/根因#8）`)
      }
      // ③b 凡用 refresher-enabled 的 .vue 必绑 @refresherrefresh + :refresher-triggered（防转圈不停）
      for (const f of walk(join(ROOT, MINI, 'pages'))) {
        if (!f.endsWith('.vue')) continue
        const src = readFileSync(f, 'utf8')
        if (!/refresher-enabled/.test(src)) continue
        const rel = relative(ROOT, f)
        if (!/@refresherrefresh/.test(src))
          bad.push(`${rel} 用 refresher-enabled 但未绑 @refresherrefresh——下拉无响应（T-F3）`)
        if (!/refresher-triggered/.test(src))
          bad.push(`${rel} 用 refresher-enabled 但未绑 :refresher-triggered——转圈不停（T-F3/根因#8）`)
      }
      return bad
    },
  },
  {
    // 左右滑走原生 swiper（优化批0618·T-F4）。根因#8「手势在真机才暴露」+ 守卫指令「不自造 touchmove」：
    // mp-weixin 横滑（切图/切 tab）与纵向滚动的手势消歧，靠原生 <swiper> 才稳——自造 touchmove 计算
    // 真机易误触纵向滚动/卡顿（H5 假绿）。钉死两个左右滑面用 <swiper>+<swiper-item>：
    //   ① 详情图廊 DetailGallery（左右滑看图 + 指示点）；② 订单列表 order-list（tab 横滑联动顶部高亮）。
    // catalog（派单写「分类」）实为单课程 + 竖向章节折叠、无横向 tab，无可滑面 → 不入册（不做 theater·根因#8）。
    id: 'swipe-native-swiper',
    roots: ['#8'],
    desc: '左右滑走原生 swiper（优化批0618·T-F4）：详情图廊 DetailGallery.vue 与订单列表 order-list/index.vue 的左右滑须用原生 <swiper>+<swiper-item>（mp 手势消歧稳·禁自造 touchmove 计算·根因#8 真机才暴露）；catalog 无横向 tab 不入册',
    run() {
      const bad = []
      const MINI = 'packages/miniapp/src'
      const SWIPE_SURFACES = ['pages/detail/components/DetailGallery.vue', 'pages/order-list/index.vue']
      for (const rel of SWIPE_SURFACES) {
        const f = `${MINI}/${rel}`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失（左右滑面·T-F4）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        if (!/<swiper[\s>]/.test(src))
          bad.push(`${f} 未用原生 <swiper> 做左右滑——手势消歧不稳/疑似自造 touchmove（T-F4/根因#8）`)
        if (!/<swiper-item[\s>]/.test(src)) bad.push(`${f} 缺 <swiper-item>——swiper 无内容项（T-F4）`)
      }
      return bad
    },
  },
  {
    // 微动效保持 CSS 克制版·不引重动画库（优化批0618·T-F5·决策「不引重动画库」）。根因#8「mp 真机才暴露」：
    // 重 JS 动画库在 mp 低端机掉帧/卡顿（H5 快网假绿），克制版微交互应纯 CSS（transform/opacity 走合成层）。
    // 本守卫只钉「不引重动画库」这条可机器化的子约束（denylist 依赖 + import）；视觉手感（跟手/不掉帧/低端机不卡）
    // 不可机器证——按派单 T-F5 决策靠 /frontend-check 真机验（#8 已 CLAUDE 靠人锚，覆盖率不缺）。
    id: 'anim-no-heavy-lib',
    roots: ['#8'],
    desc: '微动效克制版不引重动画库（优化批0618·T-F5）：packages/miniapp 不依赖也不 import 重 JS 动画库（gsap/anime.js/lottie/animate.css/framer-motion/velocity/popmotion/mo.js）——微交互保持纯 CSS transform/opacity（GPU 友好·防 mp 掉帧·根因#8）；视觉手感靠 /frontend-check 真机验',
    run() {
      const bad = []
      const HEAVY = [
        'gsap',
        'animejs',
        'anime.js',
        'lottie-web',
        'lottie-miniprogram',
        'animate.css',
        'framer-motion',
        'velocity-animate',
        'popmotion',
        'mo.js',
        'mojs',
      ]
      // ① package.json 依赖
      const pkgPath = join(ROOT, 'packages/miniapp/package.json')
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
        for (const name of Object.keys(allDeps)) {
          if (HEAVY.some((h) => name === h)) bad.push(`packages/miniapp 依赖重动画库 ${name}——微动效应纯 CSS 克制版（T-F5/根因#8）`)
        }
      }
      // ② src import（防绕过 package.json 直接 import）
      const escaped = HEAVY.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      const importRe = new RegExp(`from\\s+['"](?:${escaped.join('|')})['"]`)
      for (const f of walk(join(ROOT, 'packages/miniapp/src'))) {
        if (!/\.(js|ts|vue)$/.test(f)) continue
        if (importRe.test(readFileSync(f, 'utf8')))
          bad.push(`${relative(ROOT, f)} import 了重动画库——微动效应纯 CSS 克制版（T-F5/根因#8）`)
      }
      return bad
    },
  },
  {
    // 主滚动容器保留弹性拖拽——恢复原 UI 设计的「拖动感」（用户报·优化批0618 续）。根因#8「真机才感知」：
    // 原设计＝HTML 原型在手机上跑、有 iOS 原生弹性滚动（橡皮筋回弹 + 整体跟手弹性惯性·含板块间微弱弹性）；
    // 端口到 uni-app <scroll-view> 后丢失——mp-weixin scroll-view 默认刚性、到边硬停无回弹（H5/快网看不出）。
    // mp 唯一恢复途径＝enhanced（增强模式）+ bounces（iOS 橡皮筋）。列举整页 scroll-view 承载滚动的页，
    // 其主 scroll-view 须带二者。注：enhanced 模式与 scroll-top/@scroll/refresher 共存须真机验（#8）。
    // order-list 不入册——其 scroll-view 嵌在 swiper 内（T-F4 tab 横滑），enhanced 原生滚动器与 swiper
    // 横滑手势仲裁抢资源致横滑掉帧（真机实测·调试日志），故让位顺滑横滑、不开 enhanced（弹性靠 refresher+原生惯性）。
    id: 'main-scroll-elastic',
    roots: ['#8'],
    desc: '主滚动容器保留弹性拖拽（用户报·恢复原设计拖动感）：整页 scroll-view 承载滚动的页(index/me/cart)主 scroll-view 须 enhanced + bounces（mp 默认刚性无回弹·iOS 橡皮筋只此途径·根因#8 真机才感知），防拖动感再丢；order-list 因 scroll-view 嵌 swiper 内 enhanced 致横滑掉帧不入册',
    run() {
      const bad = []
      const MINI = 'packages/miniapp/src'
      const ELASTIC_PAGES = ['pages/index/index', 'pages/me/index', 'pages/cart/index']
      for (const path of ELASTIC_PAGES) {
        const f = `${MINI}/${path}.vue`
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失（弹性滚动页）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        if (!/<scroll-view/.test(src)) {
          bad.push(`${f} 无 scroll-view（弹性滚动核查）`)
          continue
        }
        if (!/\benhanced\b/.test(src))
          bad.push(`${f} 主 scroll-view 未开 enhanced——弹性增强模式关（恢复拖动感·根因#8）`)
        if (!/\bbounces\b/.test(src))
          bad.push(`${f} 主 scroll-view 未开 bounces——橡皮筋回弹关（恢复拖动感·根因#8）`)
      }
      return bad
    },
  },
  {
    // 分包配置存在（优化批0618·T-F6 加载优化）。根因#8「真机冷启/真网才感知」：所有页塞主包→主包大→冷启慢
    // （dev/快网无感），非首屏重页（player 视频 ~124K 编译态）应拆分包按需载 + preloadRule 预载减首跳卡顿。
    id: 'subpackage-config-present',
    roots: ['#8'],
    desc: '分包配置存在（T-F6 加载优化）：pages.json 须有非空 subPackages（≥1 分包页）+ preloadRule 预载规则——非首屏重页拆分包按需载、减主包冷启（根因#8 真机冷启才感知）',
    run() {
      const bad = []
      let pj = {}
      try {
        pj = JSON.parse(readFileSync(join(ROOT, 'packages/miniapp/src/pages.json'), 'utf8'))
      } catch {
        return ['packages/miniapp/src/pages.json 解析失败（分包核查）']
      }
      const subs = pj.subPackages || pj.subpackages || []
      if (!subs.some((s) => Array.isArray(s.pages) && s.pages.length))
        bad.push('pages.json 无 subPackages 分包页——非首屏重页未拆分包、主包冷启慢（T-F6/根因#8）')
      if (!pj.preloadRule || !Object.keys(pj.preloadRule).length)
        bad.push('pages.json 无 preloadRule 预载规则——分包页首次跳转前未预载、首跳卡顿（T-F6）')
      return bad
    },
  },
  {
    // 主包体积预算（优化批0618·T-F6）。根因#8：最重非首屏页 player（视频 ~124K 编译态）须在分包、不回主包；
    // 主包页数设上限，防新页无脑塞主包致冷启退化（dev 无感·真机真网才慢）。
    id: 'main-package-budget',
    roots: ['#8'],
    desc: '主包体积预算（T-F6 加载优化）：最重非首屏页 player 须在 subPackages 不在主包 pages；主包 pages ≤ 18——防重页/新页无脑塞主包致冷启退化（根因#8 真机冷启才感知）',
    run() {
      const bad = []
      let pj = {}
      try {
        pj = JSON.parse(readFileSync(join(ROOT, 'packages/miniapp/src/pages.json'), 'utf8'))
      } catch {
        return ['packages/miniapp/src/pages.json 解析失败（主包预算核查）']
      }
      const mainPages = pj.pages || []
      if (mainPages.some((p) => /player/.test(p.path || '')))
        bad.push('player（最重非首屏页·视频）仍在主包 pages——须移入 subPackages 减主包冷启（T-F6/根因#8）')
      const subs = pj.subPackages || pj.subpackages || []
      if (!subs.some((s) => (s.pages || []).some((pg) => /player/.test(pg.path || pg || ''))))
        bad.push('subPackages 无 player——player 未分包（T-F6）')
      const BUDGET = 18
      if (mainPages.length > BUDGET)
        bad.push(`主包 pages ${mainPages.length} 超预算 ${BUDGET}——新页优先入分包、勿胀主包（T-F6/根因#8）`)
      return bad
    },
  },
  {
    // 视频源不走外链（优化批0618·T-F7·合规红线）。根因#8「urlCheck 翻 true 后真机才暴露」：
    // player 曾硬编码 Google 外链占位视频（.mp4），合规非法域名 + 小程序 urlCheck 开启后真机根本播不了
    // （dev/未校验时能播=假绿）。视频源只许经 getPlaybackUrl/store.playbackUrl 换云端短时效 URL；
    // 前端禁裸 http(s) 视频 URL 字面量。无真实视频 → 本地占位封面（不播外链）。
    id: 'no-external-video-src',
    roots: ['#8'],
    desc: '视频源不走外链（T-F7·合规·双线 2026-07-16 补 rewrite/mp）：packages/miniapp/src（.js/.ts/.vue）+ rewrite/mp（.js/.ts/.wxml）禁裸 http(s) 视频 URL 字面量（.mp4/.m3u8/.mov/.webm 等）——视频源只经 getPlaybackUrl/store.playbackUrl 换云端临时 URL，无真视频显本地占位；防外链合规红线 + urlCheck 翻 true 后真机播不了（根因#8）',
    run() {
      const bad = []
      const re = /https?:\/\/[^'"`\s)]+\.(?:mp4|m3u8|mov|webm|avi|mkv)\b/i
      const scanFile = (f) => {
        const rel = relative(ROOT, f)
        readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (isCommentLine(line) || line.includes('structure-ok')) return
            if (re.test(line))
              bad.push(
                `${rel}:${i + 1} 裸 http(s) 视频 URL 字面量——视频源须经 getPlaybackUrl/云、禁外链（T-F7/合规·根因#8）`,
              )
          })
      }
      // 旧线 packages/miniapp/src（.js/.ts/.vue·walk 默认扩名）
      for (const f of walk(join(ROOT, 'packages/miniapp/src'))) {
        if (/\.(js|ts|vue)$/.test(f)) scanFile(f)
      }
      // 新线 rewrite/mp：.js/.ts 走 walk；.wxml walk 不吐、本地遍历（2026-07-16 双线补真空·仿 font-not-in-package 单源）
      for (const f of walk(join(ROOT, 'rewrite/mp'))) {
        if (/\.(js|ts)$/.test(f)) scanFile(f)
      }
      const wxmlWalk = (d) => {
        if (!existsSync(d)) return
        for (const name of lsScan(d)) {
          if (name === 'node_modules' || name === 'dist') continue
          const p = join(d, name)
          if (statSync(p).isDirectory()) wxmlWalk(p)
          else if (name.endsWith('.wxml')) scanFile(p)
        }
      }
      wxmlWalk(join(ROOT, 'rewrite/mp'))
      return bad
    },
  },
  {
    // mp 内联 <svg> 禁用（新线镜像旧线 inline-svg·2026-07-16 补 rewrite/mp 守卫真空）。旧 inline-svg 物理
    // 锚死 packages/miniapp/src 的 .vue/.scss（check-conventions），活线原生 .wxml 扫不到（文件类型+根都不匹配）。
    // mp 端不渲染内联 <svg>（真机静默不显·dev/H5 假绿）——图标须 <image src="/static/icons/*.svg">（色烘进 svg）。
    id: 'rw-mp-no-inline-svg',
    roots: ['#8'],
    desc: 'mp 内联 svg 禁用（新线·补 inline-svg 真空）：扫 rewrite/mp/**/*.wxml，剥 <!-- --> 注释后出现 <svg 即红——mp 端不渲染内联 svg（真机静默不显·构建过≠真机能用·根因#8），图标走 <image src="/static/icons/*.svg">',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return bad
      const walkW = (d) => {
        for (const name of lsScan(d)) {
          if (name === 'node_modules' || name === 'dist') continue
          const p = join(d, name)
          if (statSync(p).isDirectory()) walkW(p)
          else if (name.endsWith('.wxml')) {
            // 剥 <!-- --> 注释再扫（同 rw-mp-wxml-well-formed 手法·防注释里的 <svg 假红）
            const src = readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
            if (/<svg[\s>]/i.test(src))
              bad.push(
                `${relative(ROOT, p)} 内联 <svg>——mp 端不渲染（真机静默不显·根因#8），图标用 <image src="/static/icons/*.svg">`,
              )
          }
        }
      }
      walkW(base)
      return bad
    },
  },
  {
    // 本地图不走 CSS background:url()（新线镜像旧线 bg-image-local·2026-07-16 补真空）。旧 bg-image-local 锚死
    // packages/miniapp/src 的 .vue/.scss，活线 .wxss 扫不到。本地图 background:url() 在 mp 端不可靠（真机可能不显）；
    // 本地图用 <image>，占位走灰底（新线方向 A·弃 MediaSlot）。放行 http(s):// 与 data:（远程/内联合法）。
    id: 'rw-mp-no-bg-image-local',
    roots: ['#8'],
    desc: 'mp 本地背景图禁用（新线·补 bg-image-local 真空）：扫 rewrite/mp/**/*.wxss，background(-image):url(本地路径) 即红（放行 http(s)://、data:）——本地图 background:url() 在 mp 端不可靠，用 <image>（根因#8）',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return bad
      const re = /background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)/i
      const walkS = (d) => {
        for (const name of lsScan(d)) {
          if (name === 'node_modules' || name === 'dist') continue
          const p = join(d, name)
          if (statSync(p).isDirectory()) walkS(p)
          else if (name.endsWith('.wxss')) {
            readFileSync(p, 'utf8')
              .split('\n')
              .forEach((line, i) => {
                if (isCommentLine(line) || line.includes('structure-ok')) return
                const m = line.match(re)
                if (m && !/^(https?:\/\/|data:)/.test(m[1]))
                  bad.push(
                    `${relative(ROOT, p)}:${i + 1} background:url() 引本地图——mp 端不可靠，本地图用 <image>（根因#8）`,
                  )
              })
          }
        }
      }
      walkS(base)
      return bad
    },
  },
  {
    // WXS 语法子集（2026-07-20·seek.wxs 真机编译失败当场立）。痛：seek.wxs 写了 `Number(value) || 0`，
    // 微信编译器直接语法层拒绝（`seek.wxs:14:28 Unexpected identifier '('` → 连带 `__route__ is not defined`
    // 整页白）——WXS 的 Number 只是常量对象（MAX_VALUE/MIN_VALUE…）不可调用，且 WXS 是自带受限 builtin 的
    // ES5 子集运行时（无 Object/new/箭头/let-const/模板串/try-catch/ES6 方法）。为什么 check 全绿还炸：
    // tests/player-seek-wxs.test.ts 用 new Function 把 WXS 函数体抽到 **Node** 里跑对拍，Node 有 Number——
    // 桩比真运行时宽松＝根因#8「过了≠真能用」在 WXS 面的翻版（同日志 P 内存桩形状不符全假阴）；WXS 又进不了
    // tsc/eslint 编译面（.wxs 不是 .ts/.js），三道闸对它整体真空。本守卫补这块真空：对 .wxs 源剥注释 + 掩蔽
    // 字符串字面量（防注释/文案里的 `=>`、`...` 假红）后逐行扫已知非法构造。扫描面为空即红——WXS 全删属
    // 刻意退役、该同批删守卫（病根#16「空样本＝绿不发信号」）。
    id: 'rw-mp-wxs-runtime-subset',
    roots: ['#8'],
    desc: 'WXS 语法子集（活线 rewrite/mp·根因#8）：.wxs 是自带受限 builtin 的 ES5 子集运行时，且不在 tsc/eslint 编译面内——禁 Number()/String()/Boolean()/Array() 调用、Object.*、new、箭头函数、let/const、模板字符串、展开符、try/catch、class、import/export、Promise/async/await/setTimeout、wx.*、ES6 字符串数组方法（includes/startsWith/endsWith/padStart/padEnd/repeat/find/findIndex）；违例真机编译即失败整页白，而 npm run check 全绿（对拍测试在 Node 跑、桩比真运行时宽松）',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return bad
      // 每条：非法构造正则 + 为什么（WXS 运行时没有它）+ 替代写法。行内 structure-ok 可标刻意例外。
      const BANNED = [
        [/\bNumber\s*\(/, 'WXS 的 Number 是常量对象（MAX_VALUE 等）不可调用', '数值直接用 `x || 0` 或 parseFloat/parseInt'],
        [/\b(?:String|Boolean|Array)\s*\(/, 'WXS 无 String/Boolean/Array 构造函数', "拼串用 `'' + x`、判真用 `!!x`、建数组用 `[]`"],
        [/\bObject\s*\./, 'WXS 无 Object 全局对象', '自己 for-in 遍历'],
        [/\bnew\s+[A-Za-z_$]/, 'WXS 不支持 new（含 new Date/new RegExp）', '用 getDate() / getRegExp()'],
        [/=>/, 'WXS 不支持箭头函数', '写 function (a) { ... }'],
        [/\b(?:let|const)\s+[A-Za-z_$]/, 'WXS 只有 var', '一律 var'],
        [/`/, 'WXS 不支持模板字符串', "用 '+' 拼接"],
        [/\.\.\./, 'WXS 不支持展开/剩余参数', '显式列参数或 concat'],
        [/\b(?:try|catch)\s*[({]/, 'WXS 不支持异常处理', '前置判空代替 try/catch'],
        [/\bclass\s+[A-Za-z_$]/, 'WXS 不支持 class', '用 function + 对象字面量'],
        [/^\s*(?:import|export)\s/, 'WXS 模块走 require/module.exports', "module.exports = { ... }"],
        [/\b(?:Promise|async\s+function|await\s|setTimeout|setInterval|requestAnimationFrame)\b/, 'WXS 无异步/定时能力（渲染层同步闭环）', '异步交回逻辑层 callMethod'],
        [/\bwx\s*\./, 'WXS 内不能调 wx.* 接口', '经 ownerInstance.callMethod 回逻辑层调'],
        [/\.(?:includes|startsWith|endsWith|padStart|padEnd|repeat|find|findIndex)\s*\(/, 'ES6 字符串/数组方法不在 WXS 子集内', '用 indexOf/循环替代'],
        // 2026-07-20 实测：`if (x) { doSomething(); return }` 单行写法编译报 `Unexpected token '}'`——
        // WXS 解析器不接受裸 return 紧跟同行 `}`（换行写同一段就正常）。只咬「return 后直接是 }」，
        // `return { ... }`（返回对象字面量）因 return 后是 `{` 不匹配、不误伤。
        [/\breturn\s*\}/, 'WXS 解析器不接受裸 return 紧跟同行的 }（实测 Unexpected token）', 'return 单独占一行、} 换行'],
      ]
      let scanned = 0
      const walkX = (d) => {
        for (const name of lsScan(d)) {
          if (name === 'node_modules' || name === 'dist') continue
          const p = join(d, name)
          if (statSync(p).isDirectory()) walkX(p)
          else if (name.endsWith('.wxs')) {
            scanned++
            // 剥注释（E1 单源 helper）+ 掩蔽字符串字面量（防文案里的 `=>`/`...` 假红）；两者均保行号一一对应
            const lines = maskStringLiterals(stripComments(readFileSync(p, 'utf8'))).split('\n')
            lines.forEach((line, i) => {
              if (line.includes('structure-ok')) return
              for (const [re, why, fix] of BANNED)
                if (re.test(line))
                  bad.push(`${relative(ROOT, p)}:${i + 1} WXS 非法构造——${why}；改用：${fix}（真机编译即失败整页白·根因#8）`)
            })
          }
        }
      }
      walkX(base)
      if (!scanned)
        bad.push('rewrite/mp 下零个 .wxs——本守卫扫描面空转（病根#16「空样本＝绿」）；WXS 若已刻意全撤，同批退役本守卫')
      return bad
    },
  },
  {
    // 进包位图预算（新线·2026-07-16·病根#15 图片面 + 根因#8 冷启）。内容图归云存储（getTempUrl 换临时址按需拉），
    // 进包位图只该是品牌兜底（hero-full.jpg 42K）。防大位图悄爬进主包（2MB 硬顶·含代码）拖慢冷启动——真机冷启
    // 才感知（根因#8「构建过≠真机能用」）。与 font-not-in-package（禁字体二进制进包）同精神互补：那管字体、这管位图。
    id: 'rw-mp-static-bitmap-budget',
    roots: ['#8', '#15'],
    desc: '进包位图预算（新线·病根#15+#8）：rewrite/mp 下位图（.png/.jpg/.jpeg/.gif/.webp/.bmp）单张 ≤200KB、总量 ≤400KB——内容图归云存储按需加载，进包位图只该是品牌兜底（hero-full.jpg 42K）；防大位图撑主包拖慢冷启动（主包 2MB·真机冷启才感知·根因#8）',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return bad
      const BITMAP = /\.(png|jpe?g|gif|webp|bmp)$/i
      const ONE = 200 * 1024
      const TOTAL = 400 * 1024
      let total = 0
      const walkB = (d) => {
        for (const name of lsScan(d)) {
          if (name === 'node_modules' || name === 'dist') continue
          const p = join(d, name)
          const st = statSync(p)
          if (st.isDirectory()) walkB(p)
          else if (BITMAP.test(name)) {
            total += st.size
            if (st.size > ONE)
              bad.push(
                `${relative(ROOT, p)} 位图 ${Math.round(st.size / 1024)}KB 超单张上限 200KB——内容图归云存储（getTempUrl），进包位图只该是品牌兜底；大图压缩或上云（根因#8 冷启）`,
              )
          }
        }
      }
      walkB(base)
      if (total > TOTAL)
        bad.push(
          `rewrite/mp 进包位图总量 ${Math.round(total / 1024)}KB 超上限 400KB——内容图别进包、走云存储按需加载（病根#15/根因#8 冷启）`,
        )
      return bad
    },
  },
  {
    // 主包体积预算——活线版（2026-07-18·code-gaps 战役批B4）。既有 main-package-budget/
    // subpackage-config-present 两条扫的是冻结旧线 packages/miniapp/src/pages.json，对本仓唯一在
    // 迭代的 rewrite/mp 假绿：23 页全塞主包、app.json 无 subPackages，此前从无人测过真实上传体积
    // （随 packages/ 处置拍板一并退役前先补活线真空，本条只加、不动旧线两条；与 rw-mp-static-bitmap-budget
    // 同精神互补——那管进包位图，这管进包代码/wxml/wxss/json 总量）。
    // 实测方法（2026-07-18）：tsc --module CommonJS --target ES2020 编译 rewrite/mp 全部 .ts 落临时目录，
    // 逐组比对编译前后字节数——比值集中在 1.015–1.026（剥类型注解基本被 CommonJS require/exports 样板
    // 抵消，非显著收缩），取 ×1.05 留安全边际估「编译后 .js」体积；wxml/wxss 真实上传会被
    // project.config.json 当前 minifyWXML/minifyWXSS(true) 再压一道，本估算不折算压缩收益——估算天然
    // 偏保守（宁可判红过严、不可放过真超限）。进包边界：lsScan/SKIP_DIR 已天然排除 node_modules/dist/
    // 隐藏文件（含 .claude 金丝雀夹具·见 guard-scan-liveness）；本表额外剔除四个不可达/工具专属项——
    // tests（vitest 用例，非页面/组件可达）、typings（.d.ts 纯类型声明零运行时产出）、README.md/
    // tsconfig.json（无页面引用，微信 ignoreUploadUnusedFiles 语义下不可达）、project*.config.json
    // （.gitignore 排除、未入库，防本机已生成时误计入）。2026-07-18 实测约 695KB（0.66MiB），预算
    // 1.5MiB＝微信主包硬顶 2MiB（2×1024×1024）的 75%——留 25% 边际盖估算误差；当前用量仅占预算
    // ~44%、占硬顶 ~33%，暂无需分包（评估见 重构日志 同日条目）。
    id: 'rw-mp-main-package-budget',
    roots: ['#8'],
    desc: '主包体积预算（活线 rewrite/mp·根因#8）：会进上传包的源文件（pages/components/custom-tab-bar/lib/api/utils/static/styles + app.json/app.ts/app.wxss/sitemap.json，剔 tests/typings/README/tsconfig/project*.config.json）总字节数（.ts 按 ×1.05 估编译后 .js 体积——实测 tsc CommonJS 输出比源码大 1.5%–2.6%）须 ≤ 1.5MiB（微信主包硬顶 2MiB 的 75%，留边际）——超预算真机冷启退化才现形（根因#8「构建过≠真机能用」）；既有 main-package-budget/subpackage-config-present 扫冻结旧线 packages/miniapp 对活线假绿，本条补活线真空（随 packages/ 处置拍板一并退役前不动旧线两条）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const EXCLUDE_TOP = new Set(['tests', 'typings', 'README.md', 'tsconfig.json', 'project.config.json', 'project.private.config.json'])
      const TS_MULTIPLIER = 1.05
      const BUDGET = 1.5 * 1024 * 1024 // 微信主包硬顶 2MiB 的 75%（见守卫头注）
      let total = 0
      const walkB = (d, top) => {
        for (const name of lsScan(d)) {
          if (top && EXCLUDE_TOP.has(name)) continue
          const p = join(d, name)
          const st = statSync(p)
          if (st.isDirectory()) walkB(p, false)
          else total += /\.ts$/.test(name) ? st.size * TS_MULTIPLIER : st.size
        }
      }
      walkB(base, true)
      if (total > BUDGET)
        return [
          `rewrite/mp 主包体积估算 ${Math.round(total / 1024)}KB 超预算 ${Math.round(BUDGET / 1024)}KB（微信主包硬顶 2048KB 的 75%）——新增源码/静态资源前先量体积，逼近硬顶需评估分包（根因#8·真机冷启才感知）`,
        ]
      return []
    },
  },
  {
    // dev-only H5 演示路不得泄漏生产（T1「微信原生单源」逃生舱双门控）。痛：T1 下 callCloud 在 H5
    // 返回 null，视频播放页因无课程/未解锁/无播放地址直接弹回目录、在 H5 完全跑不起来，测视频只能开
    // 微信开发者工具弄一堆。逃生舱＝加 utils/devCloudMock.js 喂样本课程 + 本地样本视频，让播放器外壳/
    // 交互在 dev:h5 浏览器里热重载调试。风险两面：① 忘 #ifdef H5 包裹 → mp-weixin 生产小程序带上假
    // 数据；② 忘 import.meta.env.DEV 门控 → H5 正式包也启用 mock。本守卫机器保证两道门都在 + mock 不
    // 外溢，逃生舱永不出 dev:h5。（mock 落 utils/cloud.js 不碰 api/，故 api-cloud-only 天然全绿、无需豁免。）
    id: 'dev-mock-h5-only',
    roots: ['T1'],
    desc: 'dev-only H5 演示路不泄漏生产（T1 逃生舱双门控）：utils/devCloudMock.js 存在且仅被 utils/cloud.js 引用；cloud.js 对它的 import/调用须全在 #ifdef H5 块内（mp-weixin 编译期删除）、调用块经 import.meta.env.DEV 门控（H5 正式包不启用）——防视频测试 mock 漏进生产小程序/H5 正式包（根因#8 同源：dev 能用≠生产该有）',
    run() {
      const bad = []
      const mockRel = 'packages/miniapp/src/utils/devCloudMock.js'
      const cloudRel = 'packages/miniapp/src/utils/cloud.js'
      const mockAbs = join(ROOT, mockRel)
      const cloudAbs = join(ROOT, cloudRel)
      if (!existsSync(mockAbs)) return [`${mockRel} 缺失（dev:h5 视频演示路 mock·T1 逃生舱）`]
      // ① 只许 utils/cloud.js 引用 dev mock（不外溢到别处文件）
      for (const f of walk(join(ROOT, 'packages/miniapp/src'))) {
        if (f === mockAbs || f === cloudAbs) continue
        if (/devCloudMock|devMockCloud/.test(readFileSync(f, 'utf8')))
          bad.push(`${relative(ROOT, f)} 引用 dev mock——只许 utils/cloud.js 一处接入（防外溢·T1 逃生舱）`)
      }
      // ② cloud.js 里所有 dev mock 引用须落在 #ifdef H5 块内；调用块须 import.meta.env.DEV 门控
      const src = readFileSync(cloudAbs, 'utf8')
      const blocks = [] // 各 #ifdef H5 ... #endif 块的正文
      const lines = src.split('\n')
      let inH5 = false
      let nest = 0
      let cur = []
      for (const raw of lines) {
        const t = raw.trim()
        if (!inH5) {
          if (/^\/\/\s*#ifdef\s+H5\b/.test(t)) {
            inH5 = true
            nest = 0
            cur = []
          }
          continue
        }
        if (/^\/\/\s*#if(?:def|ndef)\b/.test(t)) {
          nest++
          cur.push(raw)
        } else if (/^\/\/\s*#endif\b/.test(t)) {
          if (nest === 0) {
            blocks.push(cur.join('\n'))
            inH5 = false
          } else {
            nest--
            cur.push(raw)
          }
        } else {
          cur.push(raw)
        }
      }
      const h5Text = blocks.join('\n')
      const reRef = /devCloudMock|devMockCloud/g
      const totalRefs = (src.match(reRef) || []).length
      const h5Refs = (h5Text.match(reRef) || []).length
      if (totalRefs === 0)
        bad.push(`${cloudRel} 未接入 dev mock——dev:h5 视频演示路未生效（应在 #ifdef H5 块内路由）`)
      if (totalRefs !== h5Refs)
        bad.push(`${cloudRel} 有 dev mock 引用落在 #ifdef H5 块外——mp-weixin 生产小程序会带上 dev mock（T1 逃生舱泄漏）`)
      if (!blocks.some((b) => /devMockCloud\s*\(/.test(b) && /import\.meta\.env\.DEV/.test(b)))
        bad.push(`${cloudRel} 调 devMockCloud 的 #ifdef H5 块缺 import.meta.env.DEV 门控——H5 正式包会启用 dev mock`)
      return bad
    },
  },
  {
    // 品牌字体走远程加载（wx.loadFontFace）、绝不进小程序包——杜绝字体二进制撑爆包体积（主包 2MB·总包 20MB）。
    // 痛：文源圆体单字重 ~14MB，若有人把 .otf/.ttf 丢进 src/static（构建原样拷入包）或 base64 内嵌进 wxss，
    // 包体积瞬间爆掉。锁两条进包路径：① src 下无字体二进制 ② mp 可达源码无字体 data-URI（base64 内嵌）。
    // 子集产物正本在仓根 assets/brand-fonts/（不在 src·不进包，仅作部署到托管的真相源 + OFL 授权随附）。
    id: 'font-not-in-package',
    roots: ['基建'],
    desc: '品牌字体远程加载不进包：packages/miniapp/src + rewrite/mp 下无字体二进制(.otf/.ttf/.woff/.woff2/.eot) + mp 可达源码无字面内嵌字体 blob（base64 长串·非运行时 downloadFile→base64 模板）——防 ~14MB 字重撑爆包体积（主包 2MB），字体须远程拉取（正本在 assets/brand-fonts/·远程托管·mp 端 downloadFile→base64 绕 CORS 见 App.vue / rewrite/mp/utils/brandFont.ts）',
    run() {
      const bad = []
      const srcDirs = [join(ROOT, 'packages/miniapp/src'), join(ROOT, 'rewrite/mp')]
      const FONT_BIN = /\.(otf|ttf|woff2?|eot)$/i
      // 只拦「字面内嵌的字体 blob」（base64, 后跟一长串 base64=真把字体打进包），不拦运行时拼的 data URI
      // 模板（如 `data:font/woff;base64,${data}`·downloadFile 后运行时构造·字体不在包里·见 App.vue / brandFont.ts 绕 CORS）。
      const FONT_DATAURI =
        /data:(?:font\/[a-z0-9.+-]+|application\/(?:x-)?font[a-z0-9.+-]*|application\/vnd\.ms-fontobject)[^"')]*?base64,[A-Za-z0-9+/]{200,}/i
      const scan = (dir) => {
        if (!existsSync(dir)) return
        for (const name of lsScan(dir)) {
          if (name === 'node_modules' || name === 'dist') continue
          const p = join(dir, name)
          if (statSync(p).isDirectory()) {
            scan(p)
            continue
          }
          if (FONT_BIN.test(name)) {
            bad.push(
              `${relative(ROOT, p)} 是字体二进制——会被构建打进小程序包（~MB 级撑爆包体积）。品牌字体放仓根 assets/brand-fonts/ 并走 wx.loadFontFace 远程加载`
            )
          } else if (/\.(vue|scss|css|js|mjs|ts|wxss)$/.test(name)) {
            if (FONT_DATAURI.test(mpReachableText(readFileSync(p, 'utf8')))) {
              bad.push(
                `${relative(ROOT, p)} 在 mp 可达处内嵌字体 data-URI（base64）——会编进 wxss 撑爆包体积。字体走 wx.loadFontFace 远程加载、勿 base64 内嵌`
              )
            }
          }
        }
      }
      srcDirs.forEach(scan)
      return bad
    },
  },
  {
    // 播放器「上一段/下一段」=小段切换、连续跨课时（规格 R8 分步播放·用户拍板升级）。痛：原 prev/next
    // 是 switchLesson 整集跳（偏离 R8「下一段播本 lesson 的下一个 segment」），真机一点直接换课时。
    // 改＝抽纯函数 segNav.stepSegment（边界/跨课时/空课时单测锁），player 经它定位目标段。本守卫防回退：
    // ① segNav.js 在 ② player 引用 stepSegment 做导航 ③ 旧 switchLesson 整集跳绝迹。
    id: 'player-seg-nav',
    roots: ['R8'],
    desc: '播放器上一段/下一段=小段切换连续跨课时（规格 R8）：pkg-video/player/segNav.js 存在 + player/index.vue 经 stepSegment 定位上/下一段 + 旧 switchLesson 整集跳绝迹——防回退成「上一集/下一集」整集跳偏离 R8 分步播放',
    run() {
      const bad = []
      const navRel = 'packages/miniapp/src/pkg-video/player/segNav.js'
      const playerRel = 'packages/miniapp/src/pkg-video/player/index.vue'
      if (!existsSync(join(ROOT, navRel))) bad.push(`${navRel} 缺失（分段导航纯函数·R8）`)
      const playerAbs = join(ROOT, playerRel)
      if (!existsSync(playerAbs)) return [`${playerRel} 缺失（播放器·R8）`, ...bad]
      const p = readFileSync(playerAbs, 'utf8')
      if (!/\bstepSegment\s*\(/.test(p))
        bad.push(`${playerRel} 未经 stepSegment 定位上/下一段——分段导航须走 segNav 助手（防回退整集跳·R8）`)
      if (/\bswitchLesson\b/.test(p))
        bad.push(`${playerRel} 仍有 switchLesson 整集跳——上一段/下一段应切小段、连续跨课时（R8）`)
      return bad
    },
  },
  {
    // 切段起播等就绪、不靠定时器猜（根因#8 真机才暴露的卡顿）。痛：换段后新段播放地址是异步现取
    // （getPlaybackUrl 云函数），原 goSeg/toggle 固定 setTimeout(…play…,200) 起播——地址常没取回/
    // 没加载完就 play → 先播旧段残帧再切到新 src → 真机「播一瞬间后卡顿」（dev/模拟器快网常掩盖）。
    // 修＝切段置 pendingPlay，待新段元数据就绪事件 onLoaded(loadedmetadata) 再起播。本守卫防回退竞态写法。
    id: 'player-seg-play-on-ready',
    roots: ['#8'],
    desc: '切段起播等就绪不靠定时器（根因#8 真机卡顿）：pkg-video/player/index.vue 切段后经 pendingPlay + onLoaded(loadedmetadata) 起播，禁 setTimeout 内 play()——防回退「新段地址异步未到就 play→播一瞬间卡顿」',
    run() {
      const bad = []
      const rel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const src = readFileSync(abs, 'utf8')
      src.split('\n').forEach((ln, i) => {
        if (/setTimeout\s*\(/.test(ln) && /\bplay\s*\(/.test(ln))
          bad.push(`${rel}:${i + 1} setTimeout 内起播——切段起播须等 onLoaded 就绪、不猜定时（防真机卡顿·根因#8）`)
      })
      if (!/\bpendingPlay\b/.test(src))
        bad.push(`${rel} 无 pendingPlay——切段起播未挂到 onLoaded 就绪事件（防竞态卡顿·根因#8）`)
      return bad
    },
  },
  {
    // 进度条可拖拽（用户报·真机手势体验·根因#8 拖拽只能真机验）。原进度条只 @tap 点按跳转、不能拖。
    // 改＝scrub.js 纯函数 scrubTimeAt（触点→时间·钳位单测锁）+ 进度条绑 touchstart/move/end 拖动，
    // 拖动期 dragging 挡住 onTimeupdate 回写（拇指与播放头不打架）。本守卫防回退成只点按/拖动打架。
    id: 'player-scrub-draggable',
    roots: ['#8'],
    desc: '进度条可拖拽（真机手势·根因#8）：pkg-video/player/scrub.js 存在 + player/index.vue 进度条绑 @touchmove 拖动 + 经 scrubTimeAt 换算 + onTimeupdate 拖动中(dragging)不回写 current——防回退成只点按、或拖动时播放头与手指打架',
    run() {
      const bad = []
      const navRel = 'packages/miniapp/src/pkg-video/player/scrub.js'
      const playerRel = 'packages/miniapp/src/pkg-video/player/index.vue'
      if (!existsSync(join(ROOT, navRel))) bad.push(`${navRel} 缺失（进度条触点定位纯函数·根因#8）`)
      const playerAbs = join(ROOT, playerRel)
      if (!existsSync(playerAbs)) return [`${playerRel} 缺失`, ...bad]
      const p = readFileSync(playerAbs, 'utf8')
      if (!/@touchmove/.test(p))
        bad.push(`${playerRel} 进度条无 @touchmove——进度条须支持拖拽非仅点按（用户报·根因#8）`)
      if (!/\bscrubTimeAt\s*\(/.test(p))
        bad.push(`${playerRel} 未用 scrubTimeAt——触点→时间须经钳位纯函数（防越界乱 seek·根因#8）`)
      if (!/\bdragging\b/.test(p))
        bad.push(`${playerRel} 无 dragging——拖动期未挡住 onTimeupdate 回写，拇指与播放头会打架（根因#8）`)
      return bad
    },
  },
  {
    // 播放页进入不闪默认课时（根因#8 真机才显的初始渲染闪烁）。痛：idx 原默认 2（老「l3」单课默认），
    // onLoad 异步走完才按传入 lessonId 定位 → 先渲默认课时、再跳到续播那节＝点进去闪一下。
    // 修＝onLoad 首个 await 前同步 locateLesson（从「我」/目录进来时 store 已就绪→首帧即正确那节）。
    // 本守卫锁「同步定位在 await 之前」，防回退异步定位再闪。
    id: 'player-resume-no-flash',
    roots: ['#8'],
    desc: '播放页进入不闪默认课时、不黑屏、自动续播（根因#8 真机才显）：pkg-video/player/index.vue 的 onLoad ① 首个 await 前同步 locateLesson 按 lessonId 定位（防先渲默认再跳闪烁）② 末尾 pendingPlay=true 后显式 refreshPlayUrl 取首段地址（防续播到默认那节时段 id 不变→watch 不取址→黑屏不播）',
    run() {
      const bad = []
      const rel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const src = readFileSync(abs, 'utf8')
      // locateLesson(o) 须在 onLoad 首个 await 前（同步定位·防先渲默认再跳闪烁）；await 可为 store.load
      // 单独或 Promise.all([store.load()…])（拉课程+鉴权并行提速·缩短首屏），故两种形态都认。
      if (!/locateLesson\s*\(o\)[\s\S]*?await\s+(?:store\.load|Promise\.all\(\[\s*store\.load)/.test(src))
        bad.push(`${rel} onLoad 未在首个 await 前同步 locateLesson 定位课时——进入会先渲默认课时再跳（闪烁·根因#8）`)
      if (!/pendingPlay\s*=\s*true[^\n]*\n\s*refreshPlayUrl\s*\(\)/.test(src))
        bad.push(`${rel} onLoad 未在定位后显式 refreshPlayUrl + pendingPlay——续播到默认那节会黑屏不播（段 id 不变·watch 不取址·根因#8）`)
      if (!/o\.seg\b/.test(src))
        bad.push(`${rel} locateLesson 未按 o.seg 定位小段——继续观看恒落第一段、不回到原小段（根因#8）`)
      // 审计 #9：onLoad 首个 await 后须 if (unloaded) return——慢网下 await 期间快返离开，回调别再写已卸载页 /
      // 别再 redirectTo 把人从别页拽回；unloaded 由 onUnload 置（onHide 切后台不算卸载）。
      if (!/await Promise\.all[\s\S]{0,120}?if \(unloaded\) return/.test(src) || !/onUnload\([\s\S]*?unloaded\s*=\s*true/.test(src))
        bad.push(`${rel} onLoad await 后无 unloaded 早退守卫（或 onUnload 未置 unloaded）——慢网快返会写已卸载页/误 redirectTo 拽回（审计 #9·根因#8）`)
      return bad
    },
  },
  {
    // 段间地址预取 + autoplay 停摆兜底 + 未起播 tap 恢复（根因#8 真机段间卡顿/首帧停摆·dev 快网掩盖·活线 rewrite/mp）。
    // 退役 换防：老 player-playback-prefetch-cache 只守冻结 packages/miniapp 字节（oldline-frozen 已焊·永绿·从未守活线），
    // 新线重写了 createPlaybackCache（lib/player.ts·含 prefetch 方法·已单测）却漏把 prefetch 接进播放页——每次切段现取
    // 地址一个云往返（实测 0.7-1.4s）压在关键路径上，且 <video autoplay> 停摆时 onTapVideo 因 paused 恒 false 走反向
    // pause、原地救不回只能切段重建 <video> 才逃（正是用户「视频加载慢+有时要切下一集才能加载」）。守此不变量（均在
    // 方法体内·剥注释后匹配·错题本 E1/E10）：playSegment 体内 ① 真调 cache.prefetch（不止定义）② 预取目标绑
    // navSegment(...,1) 下一段 ③ 有 createVideoContext('lp-video').play 显式兜底 autoplay 停摆；onTapVideo 体内
    // ④ 起播判据含 firstFrameReported（未起播 tap 一律 play·防回退成纯 this.data.paused 判定使停摆首帧原地救不回）。
    id: 'rw-mp-player-prefetch-cache',
    roots: ['#8'],
    desc: '重写线播放页段间提速+停摆恢复（根因#8·承退役老线 player-playback-prefetch-cache 迁到活线 rewrite/mp）：pages/player/player.ts 的 playSegment 体内须真调 cache.prefetch 预热 navSegment(...,1) 下一段（防回退成每次切段现取地址一个云往返·段间卡顿）+ 须有 createVideoContext(lp-video).play 显式兜底 autoplay 停摆；onTapVideo 体内起播判据须含 firstFrameReported（未起播 tap 一律 play·防回退成纯 paused 判定使停摆首帧原地救不回、只能切段才逃）；批3 跨页取址预热（根因#15）：lib/playbackCache.ts 须在场且 export 单例 playbackCache、player.ts 须从 lib/playbackCache import 缓存（防单例拆回页面私有断跨页预热）、catalog.ts 体内须真调 .prefetch(（目录页续播段预热接线不许静默退化）',
    run() {
      const rel = 'rewrite/mp/pages/player/player.ts'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [] // 重写线未建时不红
      const src = stripComments(readFileSync(abs, 'utf8')) // 剥注释单源 helper（错题本 E1/E10）：防注释文本假触发/假放行
      const bad = []
      const ps = methodBody(src, 'playSegment')
      if (!ps) {
        bad.push(`${rel} 找不到 playSegment 方法体——段间预取/停摆兜底单点丢失（根因#8）`)
      } else {
        if (!/cache\.prefetch\s*\(/.test(ps))
          bad.push(`${rel} playSegment 未调 cache.prefetch——切段每次现取地址一个云往返压关键路径（段间卡顿·根因#8）`)
        else if (!/navSegment\(this\.course,[^)]*,\s*1\)[\s\S]{0,160}?cache\.prefetch\s*\(/.test(ps))
          bad.push(`${rel} playSegment 预取未绑定 navSegment(...,1) 下一段——预取目标须是下一段（防退化成预取当前段/空转·根因#8）`)
        if (!/createVideoContext\(\s*['"]lp-video['"][\s\S]{0,60}?\.play\s*\(\)/.test(ps))
          bad.push(`${rel} playSegment 无 createVideoContext('lp-video').play 显式兜底——<video autoplay> 停摆时无自动补播（真机首帧不起·根因#8）`)
      }
      const tap = methodBody(src, 'onTapVideo')
      if (!tap) {
        bad.push(`${rel} 找不到 onTapVideo 方法体——单击起播/暂停单点丢失（根因#8）`)
      } else if (!/firstFrameReported/.test(tap)) {
        bad.push(`${rel} onTapVideo 起播判据不含 firstFrameReported——回退成纯 this.data.paused 判定：autoplay 停摆时点击反向 pause、首帧原地救不回只能切段才逃（根因#8）`)
      }
      // 批3 跨页取址预热（根因#15·目录页/我页停留窗口预热·进播放器 peek 命中零云往返）：单例迁 lib/playbackCache.ts
      // 供 catalog/me 共享，拆回页面私有即断跨页预热。守三件：① 单例文件在场且 export；② player.ts 从它 import
      // （本地名仍叫 cache·上方 cache.prefetch 断言据此成立）；③ catalog.ts 真调 .prefetch(（接线不许静默退化）。
      const cacheRel = 'rewrite/mp/lib/playbackCache.ts'
      const cacheAbs = join(ROOT, cacheRel)
      if (!existsSync(cacheAbs)) {
        bad.push(`${cacheRel} 缺失——播放地址缓存单例未迁出页面，catalog/me 无从跨页预热（根因#15）`)
      } else if (!/export\s+const\s+playbackCache\s*=/.test(readFileSync(cacheAbs, 'utf8'))) {
        bad.push(`${cacheRel} 未 export const playbackCache 单例——跨页预热须共享同一缓存实例（根因#15）`)
      }
      if (!/from\s+['"][^'"]*lib\/playbackCache['"]/.test(src))
        bad.push(`${rel} 未从 lib/playbackCache import 缓存单例——单例拆回页面私有会断 catalog/me 跨页预热（根因#15）`)
      const catRel = 'rewrite/mp/pages/catalog/catalog.ts'
      const catAbs = join(ROOT, catRel)
      if (existsSync(catAbs) && !/\.prefetch\s*\(/.test(stripComments(readFileSync(catAbs, 'utf8'))))
        bad.push(`${catRel} 未调 .prefetch(——目录页续播段预热接线静默退化（进课/段间卡顿回潮·根因#15）`)
      return bad
    },
  },
  {
    // 主按钮点按触觉反馈单源（病根#5 样板复制即漂移）：2026-07-14 用户「深色主要按钮都增加震动反馈」——深色/紫墨
    // 填充主 CTA 点按「震一下」的能力收口 lib/haptics.ts 的 tapHaptic（轻档 impact + VIBE_GAP_MS 节流·单源），
    // 页面处理器一律调 tapHaptic()、禁散写裸 wx.vibrateShort（否则强度/节流各写各的、复制即漂移·同 flipLever→
    // haptics 收编前科）。例外三处：lib/haptics.ts（单源定义本身）+ pages/flip-demo、pages/player（拖动逐格「嗒」/
    // seek 拖动阻尼，用各自实例节流的 vibe()·非离散点按·不并入 tapHaptic）。本守卫为预防性（当前即绿·锁未来不散
    // 写）——反向自检靠篡改（页面塞裸 wx.vibrateShort→红）。覆盖面（哪些按钮该震）是判断题·靠约定+评审，不建脆弱
    // 的枚举式覆盖守卫（§7 防摆设·同 #8/#10 靠人）。
    id: 'rw-mp-tap-haptic-single-source',
    roots: ['#5'],
    desc: '主按钮点按触觉反馈单源（病根#5 复制漂移）：rewrite/mp 离散点按震感一律走 lib/haptics.ts 的 tapHaptic（须导出）·页面 .ts 禁散写裸 wx.vibrateShort；例外仅 lib/haptics.ts（单源）+ pages/flip-demo/player（拖动/seek 阻尼各自实例节流 vibe·非点按）——防强度/节流复制各写各的漂移',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return [] // 重写线未建时不红
      const bad = []
      const lib = 'rewrite/mp/lib/haptics.ts'
      if (!existsSync(join(ROOT, lib))) bad.push(`${lib} 缺失——点按震感单源丢失（病根#5）`)
      else if (!/export\s+function\s+tapHaptic\b/.test(readFileSync(join(ROOT, lib), 'utf8')))
        bad.push(`${lib} 未导出 tapHaptic——离散点按震感须有单源 helper（病根#5）`)
      // 例外白名单：单源本身 + 拖动/seek 阻尼两处（各自实例节流 vibe·非离散点按）
      const allow = new Set([lib, 'rewrite/mp/pages/flip-demo/flip-demo.ts', 'rewrite/mp/pages/player/player.ts'])
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) {
            if (e === 'node_modules' || e === 'dist' || e === 'miniprogram_npm') continue
            walk(p)
          } else if (e.endsWith('.ts') && !e.endsWith('.test.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (allow.has(rel)) continue
            if (/wx\.vibrateShort\s*\(/.test(readFileSync(p, 'utf8')))
              bad.push(`${rel} 散写裸 wx.vibrateShort——离散点按震感须走 lib/haptics.ts 的 tapHaptic（防强度/节流复制漂移·病根#5；拖动/seek 阻尼例外仅 flip-demo/player）`)
          }
        }
      }
      walk(base)
      return bad
    },
  },
  {
    // 课程身份显式流转、不寄生全局可变态（审计 #1+#3·根因#8 单课样本掩盖）。痛：① 取址缓存键原只用 segId，
    // 而种子段 id 课内局部命名（`${lessonId}-s${i}`·不带 courseId）跨课不唯一 → 上第二门课撞同段 id → 命中别课
    // 临时 URL 真机播错课；② 播放页身份原寄生全局 store.currentId（入口只传 lessonId）→ 任何改 currentId 处都让
    // 鉴权/定位/续段/返回串到别课。修＝缓存键 `courseId::segId`、courseId 作参数流入（非模块裸变量）；入口带
    // courseId 进播放页、onLoad 据此 setCurrent。本守卫防回退成「键只 segId / 播放页只认 currentId」。
    id: 'playback-course-identity-explicit',
    roots: ['#8'],
    desc: '课程身份显式流转防串课（审计 #1+#3·根因#8）：utils/playbackCache.js 缓存键含 courseId（`courseId::segId`）+ store 取址传 this.current.id + player onLoad 据 o.courseId setCurrent + catalog/me 入口 player URL 带 courseId——防回退成「缓存键只 segId（上第二门课撞段 id 串课）/ 播放页只认全局 currentId」',
    run() {
      const bad = []
      const cacheRel = 'packages/miniapp/src/utils/playbackCache.js'
      const storeRel = 'packages/miniapp/src/store/courses.js'
      const playerRel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const catRel = 'packages/miniapp/src/pages/catalog/index.vue'
      const meRel = 'packages/miniapp/src/pages/me/index.vue'
      const rd = (rel) => {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) {
          bad.push(`${rel} 缺失`)
          return ''
        }
        return readFileSync(abs, 'utf8')
      }
      const cache = rd(cacheRel)
      // 锚定 keyOf 定义本身（非全文搜串·防注释里写了同样字样致假绿——反向自检逮到过）
      if (cache && !/keyOf\s*=\s*\(courseId,\s*segId\)\s*=>\s*`\$\{courseId\}::\$\{segId\}`/.test(cache))
        bad.push(`${cacheRel} keyOf 缓存键未含 courseId（须 \`courseId::segId\`）——只用 segId 会让上第二门课撞同段 id 串课（根因#8）`)
      const store = rd(storeRel)
      if (store && !/_resolver\.load\(this\.current\.id/.test(store))
        bad.push(`${storeRel} 取址未把 this.current.id 作 courseId 传入解析器——courseId 须作参数流入、非模块裸变量（防竞态串课·审计 #3）`)
      const player = rd(playerRel)
      if (player && !/store\.setCurrent\(decodeURIComponent\(o\.courseId\)\)/.test(player))
        bad.push(`${playerRel} onLoad 未据 o.courseId setCurrent——播放页身份须自带 courseId、不寄生全局 currentId（防串课·审计 #3）`)
      if (rd(catRel) && !/player\/index\?id=[^'"]*courseId=/.test(rd(catRel)))
        bad.push(`${catRel} 进播放页未带 courseId（防串课·审计 #3）`)
      if (rd(meRel) && !/player\/index\?id=[^'"]*courseId=/.test(rd(meRel)))
        bad.push(`${meRel} 续学进播放页未带 courseId（防串课·审计 #3）`)
      // P1-3 尾：① 鉴权失败 redirect 落本课目录（带 courseId·F7）；② 带 courseId 却命中不到课（漂移/下架）→ 不在错课上播
      if (player && !/act\.unlocked\(cid\)[\s\S]{0,240}?\/pages\/catalog\/index\?courseId=/.test(player))
        bad.push(`${playerRel} 鉴权失败 redirect 未带 courseId——应落本课目录而非裸目录（审计 P1-3 尾/F7）`)
      if (player && !/o\.courseId && cid !== decodeURIComponent\(o\.courseId\)/.test(player))
        bad.push(`${playerRel} 缺课程可用性校验——带 courseId 命中不到课会回退别课错播（审计 P1-3 尾）`)
      return bad
    },
  },
  {
    // mp 端进度云失败 fail-closed、不回退演示数据（审计 P2-5·根因#8）。痛：store/progress.js 的 `remote` 仅在
    // getMyProgress 成功时置 true，mp 端云失败 remote 留 false → ofLesson 回退 SAMPLE_PROGRESS（演示进度）→ 真用户
    // 看到假的「已学完/观看中」、继续学习从错课时起。修＝演示回退由 DEMO_FALLBACK 门控、mp(#ifdef) 下 false（空进度）。
    id: 'progress-mp-fail-closed',
    roots: ['#8'],
    desc: 'mp 端进度云失败 fail-closed 不演示（审计 P2-5·根因#8）：store/progress.js 演示回退 SAMPLE_PROGRESS 经 DEMO_FALLBACK 门控、mp(#ifdef MP-WEIXIN) 下为 false——云失败显空进度不显假「已学完/观看中」误导继续学习；防回退成 mp 也吃演示进度',
    run() {
      const rel = 'packages/miniapp/src/store/progress.js'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (!/#ifdef MP-WEIXIN[\s\S]*?DEMO_FALLBACK = false[\s\S]*?#endif/.test(src))
        bad.push(`${rel} mp 下 DEMO_FALLBACK 未置 false——mp 端云失败会回退演示进度误导（审计 P2-5·根因#8）`)
      if (!/!s\.remote\) return DEMO_FALLBACK \?/.test(src))
        bad.push(`${rel} ofLesson 未经 DEMO_FALLBACK 门控演示回退——mp 端会吃演示进度（审计 P2-5）`)
      return bad
    },
  },
  {
    // 首次进课不黑屏（根因#8 真机才显·dev 快网掩盖）。痛：视频区在「拉课程→鉴权→取址→缓冲首帧」整段只是
    // #000 黑底——无加载提示、placeholderMode=!fileMode 在加载途中误闪「整理中」、「标了 hasVideo 却取不到
    // 地址」时永久黑。修＝三态机（dataReady/firstFrame/videoError → stage）按 loading/placeholder/error/ready
    // 盖加载浮层 + 错误重试 + @error 兜底。本守卫防回退成「视频区裸黑、无加载态、失败永久黑」。
    id: 'player-loading-until-firstframe',
    roots: ['#8'],
    desc: '首次进课不黑屏（根因#8）：pkg-video/player/index.vue 用 stage 三态机（dataReady/firstFrame/videoError）+ vp-loading 加载浮层盖到首帧出 + video @error 兜底重试——防回退成视频区裸黑等待、加载途中误闪「整理中」、取址失败永久黑',
    run() {
      const bad = []
      const rel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const src = readFileSync(abs, 'utf8')
      if (!/\bfirstFrame\b/.test(src))
        bad.push(`${rel} 无 firstFrame——加载浮层须盖到视频首帧真正出来（防回退成裸黑等首帧·根因#8）`)
      if (!/\bstage\b/.test(src) || !/'loading'/.test(src))
        bad.push(`${rel} 无 stage='loading' 态——首屏须显加载态而非黑底（根因#8）`)
      if (!/vp-loading/.test(src))
        bad.push(`${rel} 无 vp-loading 加载浮层——视频区加载/失败须有可见浮层（根因#8）`)
      if (!/@error\s*=/.test(src) || !/\bvideoError\b/.test(src))
        bad.push(`${rel} 无 @error/videoError 兜底——取址失败 / 视频出错须可重试，不能永久黑（根因#8）`)
      // F1：错误态须能自愈——视频真在播(onPlay)即清 videoError，否则瞬时 @error 后错误浮层盖死正在播的视频。
      // [^}]* 限定在 onPlay 函数体内（onPlay 无嵌套花括号），不跨到 retry/goSeg 的 videoError 清除（防误绿）。
      if (!/function onPlay\(\)\s*\{[^}]*videoError\.value\s*=\s*false/.test(src))
        bad.push(`${rel} onPlay 未清 videoError——瞬时 @error 后错误态会黏住盖死正在播的视频（F1·根因#8）`)
      // 审计 #2：retry 须失效本段缓存再重取，否则命中那条已失效的旧 URL → 重试形同空操作
      if (!/function retry\(\)\s*\{[^}]*invalidatePlaybackUrl/.test(src))
        bad.push(`${rel} retry 未 invalidatePlaybackUrl——重试会命中已失效的旧缓存 URL、点了没用（审计 #2·根因#8）`)
      return bad
    },
  },
  {
    // 播放页返回固定指向「本课程目录」（根因#8 真机才显·用户报）。痛：back 原用 goBack（栈里有上一页就
    // navigateBack）——从「我」页续看 / 我的课程进来时返回会回到来源页，而非课程目录。修＝从目录来则
    // navigateBack（保留滚动），否则 redirectTo /pages/catalog/index?courseId=<本课>。本守卫防回退成 goBack
    // 回任意来源页（鉴权失败的 redirect 到 catalog 无 courseId，故用带 courseId 区分 back 处理）。
    id: 'player-back-to-catalog',
    roots: ['#8'],
    desc: '播放页返回固定指向本课程目录（根因#8 真机·用户报）：pkg-video/player/index.vue 的 back 从非目录来源 redirectTo /pages/catalog/index?courseId=<本课>——防回退成 goBack 回到「我」页等任意来源页',
    run() {
      const rel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      return /\/pages\/catalog\/index\?courseId=/.test(readFileSync(abs, 'utf8'))
        ? []
        : [`${rel} back 未 redirectTo 本课程目录（/pages/catalog/index?courseId=）——返回须落课程目录而非回任意来源页（根因#8）`]
    },
  },
  {
    // 快速切段取址竞态（视频链路深审 P1·根因#8 网络时序才显、快网/慢点掩盖）。痛：refreshPlayUrl 在
    // await 取址后直接 playUrl.value = url——用户快速连点「下一段」时两个在途取址若乱序回包（后发先至），
    // 先发的旧段地址会覆盖新段：界面标注 C 段、实际播 B 段，且去重标记已停在 C、watch 不再触发、不自愈；
    // 慢回的失败还会把错误浮层误盖到已在播的画面。修＝await 后先核对「当前段还是发起那段」再落地。
    id: 'player-playurl-stale-guarded',
    roots: ['#8'],
    desc: '切段取址防乱序覆盖（深审 P1·根因#8）：pkg-video/player/index.vue 的 refreshPlayUrl 在 await 取址后须复核 curFileSegId 未变才写 playUrl——防「快速连点下一段、慢回的旧段地址覆盖新段」播错段且不自愈',
    run() {
      const rel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const m = readFileSync(abs, 'utf8').match(/async function refreshPlayUrl[\s\S]*?\n}/)
      if (!m) return [`${rel} 找不到 refreshPlayUrl——取址单点丢失（深审 P1）`]
      const awaitAt = m[0].indexOf('await')
      const staleAt = m[0].indexOf('curFileSegId.value !== seg')
      if (awaitAt < 0 || staleAt < 0 || staleAt < awaitAt)
        return [
          `${rel} refreshPlayUrl 取址 await 后未复核 curFileSegId 再写 playUrl——快速切段乱序回包会播错段且不自愈（深审 P1·根因#8）`,
        ]
      return []
    },
  },
  {
    // 目录章节折叠正确性（深审 P2×2·根因#8 单课种子样本掩盖）。痛①：折叠动画写死 max-height:600px，
    // 章节超约 9 节时尾部课时被截断不可见不可点（控制台允许每章 50 节）；痛②：默认展开写死 { c1: true }，
    // 只有种子鸭课第一章 id 恰为 c1，控制台建的课章节 id 随机 → 进目录全折叠。修＝展开高度按课时数动态、
    // 默认展开从 chapters[0] 动态取。本守卫防两处回退。
    id: 'catalog-chapter-fold-correct',
    roots: ['#8'],
    desc: '目录章节折叠不截断+默认展开不写死（深审 P2·根因#8 种子样本掩盖）：pages/catalog/index.vue ① 展开态禁写死 max-height 数值（长章节截断不可点），须按课时数 :style 动态；② 默认展开禁写死章节 id（c1），须从 chapters[0] 动态取',
    run() {
      const rel = 'packages/miniapp/src/pages/catalog/index.vue'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (/vc-chap-body\.open\s*\{[^}]*max-height\s*:\s*\d/.test(src))
        bad.push(`${rel} 章节展开态写死 max-height 数值——超约 9 节的章节尾部课时被截断不可点（每章上限 50 节·深审 P2）`)
      if (!/lessons\.length/.test(src) || !/maxHeight/.test(src))
        bad.push(`${rel} 展开高度未按课时数动态计算（:style maxHeight）——防回退成写死高度截断长章节（深审 P2）`)
      if (/open\s*=\s*ref\(\s*\{\s*c1\s*:/.test(src))
        bad.push(`${rel} 默认展开写死 { c1: true }——控制台建的课章节 id 随机、进目录全折叠（深审 P2·根因#8）`)
      if (!/chapters\[0\]/.test(src))
        bad.push(`${rel} 未从 chapters[0] 动态取默认展开章节（深审 P2）`)
      return bad
    },
  },
  {
    // 试看功能整条撤除（深审 P2·用户拍板 2026-07-03「项目无试看功能，完全取消」·根因#8 功能假绿：
    // 控制台可勾「试看」、云端 getPlaybackUrl 也放行 free 段，但小程序端未激活用户根本走不到播放器——
    // 三层只通两层，admin 的承诺用户永远兑现不了）。修＝segment.free 字段与「试看」字样全链绝迹
    // （种子/清洗白名单/公开目录/播放鉴权/控制台/目录页/dev mock）。防半接回：要恢复试看须整条通路一起接。
    id: 'free-trial-extinct',
    roots: ['#8'],
    desc: '试看（segment.free）全链绝迹（深审 P2·用户拍板取消）：种子/cleanCourse/getCourses/getPlaybackUrl/StepVideos/catalog/devCloudMock 不得再引段级 free 或「试看」——防半接回（只回 admin 勾选却无用户通路=功能假绿·根因#8）',
    run() {
      const files = [
        'packages/shared/src/seed/course.ts',
        'packages/cloud/src/functions/learning/getCourses.ts',
        'packages/cloud/src/functions/learning/getPlaybackUrl.ts',
        'packages/cloud/src/functions/admin/adminApi/lib.ts',
        'packages/admin/src/pages/steps/StepVideos.vue',
        'packages/miniapp/src/pages/catalog/index.vue',
        'packages/miniapp/src/utils/devCloudMock.js',
      ]
      const bad = []
      for (const rel of files) {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) continue
        readFileSync(abs, 'utf8')
          .split('\n')
          .forEach((ln, i) => {
            if (/试看/.test(ln))
              bad.push(`${rel}:${i + 1} 残留「试看」——试看已撤除（用户拍板 2026-07-03），恢复须整条通路一起接、别只回一层`)
            if (/\bfree\s*[:?]|\.free\b/.test(ln))
              bad.push(`${rel}:${i + 1} 残留段级 free 字段——试看已整条撤除（深审 P2）`)
          })
      }
      return bad
    },
  },
  {
    // 首帧耗时埋点（容量体检续·根因#8「构建过≠真机能用」的度量腿）：加载速度此前只能「看码推断已优」，
    // 无真机数字。埋点＝进课(enter)/切段(seg)/重试(retry)三种发起动作各挂一次性 mark，onPlay 首播出画
    // 上报毫秒差（track('first_frame')→events 流水·fire-and-forget 不阻塞播放）。本守卫防埋点被顺手
    // 删掉/漏场景——三个 kind 缺一即红，度量腿断了「已优」又退回推断。
    id: 'player-firstframe-metric-wired',
    roots: ['#8'],
    desc: '首帧耗时埋点在线（容量体检·根因#8）：pkg-video/player/index.vue 须 markFirstFrame 覆盖 enter/seg/retry 三场景 + onPlay 经 reportFirstFrame 单发上报 track(first_frame)——防埋点被删/漏场景致加载速度退回不可测',
    run() {
      const rel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (!/track\(\s*'first_frame'/.test(src))
        bad.push(`${rel} 无 track('first_frame') 上报——首帧耗时度量断线（容量体检·根因#8）`)
      for (const kind of ['enter', 'seg', 'retry']) {
        if (!new RegExp(`markFirstFrame\\(\\s*'${kind}'\\s*\\)`).test(src))
          bad.push(`${rel} 缺 markFirstFrame('${kind}') 场景——首帧耗时漏测该场景（enter=进课/seg=切段/retry=重试）`)
      }
      if (!/function onPlay\(\)[\s\S]{0,200}reportFirstFrame\(\)/.test(src))
        bad.push(`${rel} onPlay 未调 reportFirstFrame——首帧出画时刻无人上报（须单发·mark 在挂才报）`)
      return bad
    },
  },
  {
    // 主包不得 import 分包模块（mp-weixin 平台硬规则·根因#8 真机才崩）。病史：playbackCache 解析器原放
    // pkg-video（分包），主包 store/courses.js import 它 → mp-weixin 主包 require 分包路径运行时找不到 →
    // useCoursesStore 模块求值即抛 → 用到它的「我」页等白屏（H5 无分包概念故假绿、npm check 也测不出·#8）。
    // 不变量：主包源码（src/ 除 pkg-video/pkg-extra）的 import/require 禁指向分包根。navigateTo 的 '/pkg-*'
    // 是路由字符串（跨包跳转合法）不在此列——只扫 import/from/require 语句。分包→主包 允许，不拦。
    id: 'main-no-subpackage-import',
    roots: ['#8'],
    desc: '主包禁 import 分包模块（mp-weixin 主包不能 require 分包·根因#8 真机白屏）：packages/miniapp/src 主包文件（除分包 pkg-video/pkg-extra 自身）的 import/from/require 不得指向 @/pkg-video 或 @/pkg-extra——防回退成主包引分包→真机模块找不到→白屏（H5 假绿）',
    run() {
      const bad = []
      const srcRoot = join(ROOT, 'packages/miniapp/src')
      if (!existsSync(srcRoot)) return bad
      const SUB = /(?:^|['"\s(/])@?\/?pkg-(?:video|extra)\//
      // 仅 import/from/require 语句行才算「引模块」；navigateTo 路由字符串不算
      const isImportLine = (l) => /\b(?:import|require)\b/.test(l) || /\bfrom\s+['"]/.test(l)
      const walk = (dir, relBase) => {
        for (const e of lsScan(dir)) {
          const abs = join(dir, e)
          const rel = relBase ? `${relBase}/${e}` : e
          if (statSync(abs).isDirectory()) {
            if (e === 'pkg-video' || e === 'pkg-extra') continue // 分包自身放行
            walk(abs, rel)
          } else if (/\.(js|vue|ts)$/.test(e)) {
            readFileSync(abs, 'utf8')
              .split('\n')
              .forEach((l, i) => {
                if (isImportLine(l) && SUB.test(l))
                  bad.push(
                    `packages/miniapp/src/${rel}:${i + 1} 主包 import 了分包模块（@/pkg-video|pkg-extra）——mp-weixin 主包不能 require 分包·真机会白屏（根因#8）；把被引模块挪进主包 utils/`
                  )
              })
          }
        }
      }
      walk(srcRoot, '')
      return bad
    },
  },
  {
    // 「全部教程」指向「我的课程」列表，非某单门课的课时（根因#8 多课·用户报）。痛：me 页「全部教程」
    // 原跳 catalog（store.current 单门课的课时列表，多课下还会显默认/演示那门），应跳「我已激活的全部课程」列表。
    // 原跳 catalog（store.current 单门课的课时列表，多课下还会显默认/演示那门），应跳「我已激活的全部课程」列表。
    // 修＝新建 pages/courses（act.mine 去重取课程·resolveMyCourses 纯函数单测锁）；me allCourses 跳 /pages/courses/。
    id: 'my-courses-entry',
    roots: ['#8'],
    desc: '「全部教程」→ 我的课程列表（根因#8 多课）：pkg-video/courses/index.vue + myCourses.js 存在、courses 页经 resolveMyCourses 按 act.mine 去重取课程且冷启挂 <Skeleton> 不抢先显空/演示；me 页 allCourses 跳 /pkg-video/courses/——防回退指向某单门课的课时列表（catalog/welcome）。页入 pkg-video 分包（me 已 preloadRule 预载·不胀主包·T-F6）',
    run() {
      const bad = []
      const pageRel = 'packages/miniapp/src/pkg-video/courses/index.vue'
      const helperRel = 'packages/miniapp/src/pkg-video/courses/myCourses.js'
      const meRel = 'packages/miniapp/src/pages/me/index.vue'
      if (!existsSync(join(ROOT, helperRel))) bad.push(`${helperRel} 缺失（我的课程解析纯函数·根因#8）`)
      if (!existsSync(join(ROOT, pageRel))) {
        bad.push(`${pageRel} 缺失（我的课程列表页·根因#8）`)
      } else {
        const page = readFileSync(join(ROOT, pageRel), 'utf8')
        if (!/resolveMyCourses\s*\(/.test(page))
          bad.push(`${pageRel} 未用 resolveMyCourses——我的课程须按 act.mine 去重取列表`)
        if (!page.includes('<Skeleton'))
          bad.push(`${pageRel} 冷启未挂 <Skeleton>——会抢先显空/演示态（T-F2·根因#8）`)
      }
      const meAbs = join(ROOT, meRel)
      if (existsSync(meAbs) && !/['"]\/pkg-video\/courses\//.test(readFileSync(meAbs, 'utf8')))
        bad.push(`${meRel} 「全部教程」未跳 /pkg-video/courses/——又指向某单门课的课时列表（根因#8 多课）`)
      return bad
    },
  },
  // ── 承面 C 车道 B·外包坐席工作台前端（独立 /agent 部署单元·对 mock 建·不进 /admin）守卫 ──
  {
    id: 'agent-desk-registered',
    roots: ['承面C'],
    desc: '承面C 车道 B·外包坐席工作台接线（独立 /agent 部署单元·不进 /admin）：packages/agent 入口(main.js/App.vue/router.js) + Login/Desk 页 + 接缝(agentApi.js)/mock 存在，router 注册 /login 与 /desk——防独立工作台漏接线/路由缺失（同 my-courses-entry/kf-card-page-registered 接线守卫）',
    run() {
      const bad = []
      const base = 'packages/agent/src'
      const need = ['main.js', 'App.vue', 'router.js', 'pages/Login.vue', 'pages/Desk.vue', 'api/agentApi.js', 'api/mock.js']
      for (const f of need)
        if (!existsSync(join(ROOT, base, f))) bad.push(`${base}/${f} 缺失（外包坐席工作台接线·承面C 车道 B）`)
      const routerAbs = join(ROOT, base, 'router.js')
      if (existsSync(routerAbs)) {
        const r = readFileSync(routerAbs, 'utf8')
        for (const p of ["'/login'", "'/desk'"])
          if (!r.includes(p)) bad.push(`${base}/router.js 未注册路由 ${p}（工作台入口缺失·承面C 车道 B）`)
      }
      return bad
    },
  },
  {
    id: 'agent-poll-cleanup',
    roots: ['承面C', '#8'],
    desc: '承面C 车道 B·轮询 timer 清理（实时=轮询 getThread/listQueue·§1 定稿）：packages/agent 下任何 setInterval 的 .vue 必同时有 clearInterval + onUnmounted/onBeforeUnmount 卸载清理——防切会话/卸载后 timer 泄漏持续拉取（根因#8 运行时坑·同 pull-refresh-stops/events-cleanup-wired）',
    run() {
      const bad = []
      const dir = join(ROOT, 'packages/agent/src')
      if (!existsSync(dir)) return bad
      for (const f of walk(dir)) {
        if (!f.endsWith('.vue')) continue
        const s = readFileSync(f, 'utf8')
        if (!s.includes('setInterval')) continue
        const rel = relative(ROOT, f)
        if (!s.includes('clearInterval'))
          bad.push(`${rel} 用 setInterval 却无 clearInterval——轮询 timer 未清理（根因#8·承面C 车道 B）`)
        if (!/onUnmounted|onBeforeUnmount/.test(s))
          bad.push(`${rel} 用 setInterval 却无 onUnmounted/onBeforeUnmount——卸载不清理 timer（根因#8·承面C 车道 B）`)
      }
      return bad
    },
  },
  {
    id: 'agent-api-single-seam',
    roots: ['承面C'],
    desc: '承面C 车道 B·前后端单点接缝（mock↔真接口）：packages/agent 下唯 api/agentApi.js 可 import api/mock.js——组件/页面/其他模块禁直接引 mock（否则 master 整合切车道 A 真接口时假数据散落、「组件零改」承诺破功）。同 api-cloud-only 精神：可替换点收口一处',
    run() {
      const bad = []
      const dir = join(ROOT, 'packages/agent/src')
      if (!existsSync(dir)) return bad
      const SEAM = 'packages/agent/src/api/agentApi.js'
      const MOCK = 'packages/agent/src/api/mock.js'
      for (const f of walk(dir)) {
        if (!/\.(js|vue)$/.test(f)) continue
        const rel = relative(ROOT, f)
        if (rel === SEAM || rel === MOCK) continue // 接缝自身与 mock 自身豁免
        const s = readFileSync(f, 'utf8')
        if (/from\s+['"][^'"]*\/mock(\.js)?['"]/.test(s))
          bad.push(`${rel} 直接 import api/mock.js——只能经 api/agentApi.js 单点接缝调用（承面C 车道 B·防假数据散落、整合切真接口时组件零改）`)
      }
      return bad
    },
  },
  {
    // 店名单一来源（决策 R23 / 占位⑲，2026-06-15 定名「Lucky Ducky 小棉鸭」）。病根#5「样板复制即漂移」：
    // 店名曾在 order/checkout/welcome/BrandIntro/GroupPanel/productDetail 六处硬编码（order↔checkout 还逐字重复），
    // 改名必漏改。根治＝收口 constants/brand.js 的 BRAND_NAME，「保持一致」从人工义务变机器保证。
    id: 'brand-name-single-source',
    roots: ['#5', 'R23'],
    desc: '店名单一来源（决策 R23 / 占位⑲）：① 旧占位「易织…」+ 漂移变体「幸运小鸭」全库绝迹（中文名定「小棉鸭」；当初只堵「易织」没堵「幸运小鸭」才让中文名漂进来）② 店名字面量「Lucky Ducky 小棉鸭」只在 constants/brand.js、别处引 BRAND_NAME——改名只改一处，防散落硬编码漂移（病根#5）',
    run() {
      const bad = []
      const NAME = 'Lucky Ducky 小棉鸭'
      // 全库绝迹名单：旧占位「易织」+ 中文名漂移变体「幸运小鸭」（定名小棉鸭，幸运小鸭是错掺入的旧名）。
      const BANNED = ['易织', '幸运小鸭']
      const brandFile = 'packages/miniapp/src/constants/brand.js'
      const absBrand = join(ROOT, brandFile)
      if (!existsSync(absBrand)) bad.push(`${brandFile} 缺失（店名单一来源，R23⑲）`)
      else if (!new RegExp(`BRAND_NAME\\s*=\\s*['"]${NAME}['"]`).test(readFileSync(absBrand, 'utf8')))
        bad.push(`${brandFile} 未导出 BRAND_NAME='${NAME}'——店名单源缺定值（R23⑲）`)
      // ① NAME / 官方旗舰店 单源：只在 brand.js，别处引 BRAND_NAME（限引它的 miniapp/admin 两端）
      for (const dir of ['packages/miniapp/src', 'packages/admin/src']) {
        for (const f of walk(join(ROOT, dir))) {
          const rel = relative(ROOT, f)
          const s = readFileSync(f, 'utf8')
          if (rel !== brandFile && s.includes(NAME))
            bad.push(`${rel} 硬编码店名「${NAME}」——须引 constants/brand.js 的 BRAND_NAME 单源（病根#5）`)
          if (rel !== brandFile && s.includes('官方旗舰店'))
            bad.push(`${rel} 硬编码「官方旗舰店」店铺后缀——须引 brand.js 的 SHOP_FULL_NAME 单源（病根#5·债#30）`)
        }
      }
      // ② 绝迹名单全库扫（含 shared 种子 / cloud 云函数 / 根级 tests 夹具——中文名当初从这些「单源缺守」处漂进来；
      //    tests 当初不在扫描内＝守卫盲区，纳入。注意 walk 只看 .js/.ts/.vue，.json/.html 不在内，故 /q 落地页另走 ③）
      for (const dir of ['packages/miniapp/src', 'packages/admin/src', 'packages/shared/src', 'packages/cloud/src', 'tests']) {
        for (const f of walk(join(ROOT, dir))) {
          const rel = relative(ROOT, f)
          const s = readFileSync(f, 'utf8')
          for (const ban of BANNED)
            if (s.includes(ban))
              bad.push(`${rel} 仍含品牌名漂移变体「${ban}…」——中文名定「小棉鸭」，须全替（病根#5 复制漂移）`)
        }
      }
      // ③ 用户可见的静态品牌页（.html 不被 walk 扫·反向自检逮出的假绿·根因#8）——逐个显式钉死
      //    /q 扫码落地页（旧 site/ 单页落地页已删——用户拍板 2026-07-12·根路径由 rewrite/site 提供、④段扫）
      for (const page of ['packages/admin/public/q/index.html']) {
        const absP = join(ROOT, page)
        if (existsSync(absP))
          for (const ban of BANNED)
            if (readFileSync(absP, 'utf8').includes(ban))
              bad.push(`${page} 仍含品牌名漂移变体「${ban}…」——用户可见品牌页，须替为「小棉鸭」（病根#5）`)
      }
      // ④ 重写线内容站（根路径在线版本＝rewrite/site 构建产物·2026-07-09 M5 切换）：.astro/.md 不在
      //    walk 扩展名内（同 ③ 假绿病根·根因#8），单独递归扫 pages+content，防品牌名漂移变体上生产官网
      const siteRoot = join(ROOT, 'rewrite/site/src')
      if (existsSync(siteRoot)) {
        const walkSite = (d) => {
          for (const e of lsScan(d)) {
            const p = join(d, e)
            if (statSync(p).isDirectory()) walkSite(p)
            else if (/\.(astro|md|ts)$/.test(e)) {
              const s = readFileSync(p, 'utf8')
              for (const ban of BANNED)
                if (s.includes(ban))
                  bad.push(`${relative(ROOT, p)} 仍含品牌名漂移变体「${ban}…」——根路径在线内容站页面，须替为「小棉鸭」（病根#5）`)
            }
          }
        }
        walkSite(siteRoot)
      }
      return bad
    },
  },
  {
    // 客服接微信客服官方组件（R18 / 占位⑨，2026-06-15 用户拍板①）：四个客服入口
    // 客服升级独立「微信客服」（R18/占位⑨·决策§19，2026-06-16 用户给真 corpId/url）：4 入口
    // （详情坞 DetailDock / 「我」页 / 售后页 / 播放页 ServicePanel）经 utils/customerService.js 的
    // openCustomerService() 调 wx.openCustomerServiceChat；展示组件 emit→父级调，页面直接调；
    // corpId/url 单源此文件（病根#5 防散落）；旧 open-type="contact" 原生客服按钮退役。
    id: 'customer-service-wired',
    roots: ['R18'],
    desc: '客服已升级独立微信客服（R18 / 占位⑨·决策§19）：utils/customerService.js 单源 corpId/url + openCustomerService()（wx.openCustomerServiceChat）；4 调用点（detail/index·me·aftersales·HelpSheet/index）接通；corpId 字面量只在单源文件 + 旧 open-type="contact" 原生客服按钮 + 「正在接入人工客服」假 Toast 全库绝迹（接待人/真机靠人·根因#8）',
    run() {
      const bad = []
      const src = (f) => {
        const abs = join(ROOT, f)
        return existsSync(abs) ? readFileSync(abs, 'utf8') : null
      }
      // ① 旧占位假 Toast 绝迹（曾散在 detail/me/aftersales）
      for (const dir of ['packages/miniapp/src']) {
        for (const f of walk(join(ROOT, dir))) {
          if (readFileSync(f, 'utf8').includes('正在接入人工客服'))
            bad.push(`${relative(ROOT, f)} 仍有「正在接入人工客服」假 Toast——客服未接微信客服（R18⑨）`)
        }
      }
      // ② 单源 helper：存在 + 导出 openCustomerService + 调 openCustomerServiceChat + 参数齐
      const HELPER = 'packages/miniapp/src/utils/customerService.js'
      const hs = src(HELPER)
      if (hs === null) {
        bad.push(`${HELPER} 缺失（微信客服单源 + openCustomerService helper·R18⑨）`)
      } else {
        if (!/export\s+function\s+openCustomerService/.test(hs))
          bad.push(`${HELPER} 未导出 openCustomerService()——4 入口无收口（R18⑨）`)
        if (!hs.includes('openCustomerServiceChat'))
          bad.push(`${HELPER} 未调 wx.openCustomerServiceChat——未接独立微信客服（R18⑨）`)
        if (!/corpId/.test(hs) || !/extInfo/.test(hs))
          bad.push(`${HELPER} 缺 corpId/extInfo——openCustomerServiceChat 参数不全（R18⑨）`)
      }
      // ③ corpId 对外企业 ID 字面量单源：只能出现在 helper（病根#5 防散落）
      for (const dir of ['packages/miniapp/src']) {
        for (const f of walk(join(ROOT, dir))) {
          if (f.endsWith('customerService.js')) continue
          if (readFileSync(f, 'utf8').includes('wwda6861818cb50dd9'))
            bad.push(
              `${relative(ROOT, f)} 含 corpId 字面量——须收口 utils/customerService.js 单源（病根#5·R18⑨）`,
            )
        }
      }
      // ④ 4 调用点接通 openCustomerService（展示组件父级 / 页面）
      const WIRED = [
        'packages/miniapp/src/pages/detail/index.vue',
        'packages/miniapp/src/pages/me/index.vue',
        'packages/miniapp/src/pages/aftersales/index.vue',
        'packages/miniapp/src/pkg-video/player/components/HelpSheet/index.vue',
      ]
      for (const f of WIRED) {
        const s = src(f)
        if (s === null) bad.push(`${f} 缺失（客服调用点·R18⑨）`)
        else if (!s.includes('openCustomerService'))
          bad.push(`${f} 未接 openCustomerService——客服入口点不出微信客服（R18⑨）`)
      }
      // ⑤ 旧 open-type="contact" 原生客服按钮在 4 原入口绝迹（已升级）
      const OLD_ENTRIES = [
        'packages/miniapp/src/pages/detail/components/DetailDock.vue',
        'packages/miniapp/src/pages/me/index.vue',
        'packages/miniapp/src/pages/aftersales/index.vue',
        'packages/miniapp/src/pkg-video/player/components/HelpSheet/ServicePanel.vue',
      ]
      for (const f of OLD_ENTRIES) {
        const s = src(f)
        if (s !== null && /open-type="contact"/.test(s))
          bad.push(`${f} 仍含 open-type="contact" 旧原生客服按钮——未升级到微信客服（R18⑨）`)
      }
      return bad
    },
  },
  {
    // 详情导航单一来源（病根#5「样板复制即漂移」）：跳商品详情的 URL 曾在 index/detail/order 三处
    // 内联 navigateTo 构造（首页卡/详情推荐/订单复购），购物车再加即四处漂移。根治＝收口 utils/nav.js
    // 的 goProductDetail，URL 形状只此一处；share.js 构造的是分享卡 path（非导航）一并放行。
    id: 'detail-nav-single-source',
    roots: ['#5'],
    desc: '详情导航单一来源（病根#5）：跳商品详情走 utils/nav.js 的 goProductDetail，详情 URL「pages/detail/index?id=」只在 nav.js（导航）+ share.js（分享卡 path）构造，页面/组件禁内联 navigateTo 到详情——防 URL 形状多处漂移',
    run() {
      const bad = []
      const NEEDLE = 'pages/detail/index?id='
      const allow = new Set([
        'packages/miniapp/src/utils/nav.js',
        'packages/miniapp/src/utils/share.js',
      ])
      for (const f of walk(join(ROOT, 'packages/miniapp/src'))) {
        const rel = relative(ROOT, f)
        if (allow.has(rel)) continue
        if (readFileSync(f, 'utf8').includes(NEEDLE))
          bad.push(`${rel} 内联构造详情 URL「${NEEDLE}」——须走 utils/nav.js 的 goProductDetail 单源（病根#5）`)
      }
      const nav = join(ROOT, 'packages/miniapp/src/utils/nav.js')
      if (!existsSync(nav) || !/export function goProductDetail/.test(readFileSync(nav, 'utf8')))
        bad.push('utils/nav.js 未导出 goProductDetail——详情导航单源缺失（病根#5）')
      return bad
    },
  },
  {
    // 首页商品卡加购真做事（病根#6「假反馈泄漏」：用户动作伪成功反馈而无真效果，账本 K-⑤
    // 「拒单吞进回退＝本地伪成功」同源）。曾发病：首页 ProductCard 的 ＋（@add＝加入购物车）
    // 被接成 onProductAdd→ping('已收藏')＝收藏占位⑪ 假反馈，点了不进购物车。守卫锁 onProductAdd
    // 真调 cart.add 且不留「已收藏」假 toast。同「占位假 toast 占真按钮」家族（detail-share/customer-service）。
    id: 'home-card-add-real',
    roots: ['#6'],
    desc: '首页商品卡加购真做事（病根#6）：pages/index/index.vue 的 onProductAdd（ProductCard @add 处理）须调 cart.add 真加购物车、不弹「已收藏」假反馈，防加购按钮接成收藏占位',
    run() {
      const f = 'packages/miniapp/src/pages/index/index.vue'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失（首页）`]
      const src = readFileSync(abs, 'utf8')
      const m = src.match(/function onProductAdd\([^)]*\)\s*\{([\s\S]*?)\n\}/)
      if (!m) return [`${f} 无 onProductAdd 处理函数（首页商品卡 @add 加购）`]
      const body = m[1]
      const bad = []
      if (!/cart\.add\s*\(/.test(body))
        bad.push(`${f} onProductAdd 未调 cart.add——加购按钮没真加购物车（病根#6 假反馈）`)
      if (/已收藏/.test(body))
        bad.push(`${f} onProductAdd 仍弹「已收藏」假反馈——加购按钮接成收藏占位（病根#6）`)
      return bad
    },
  },
  {
    // 页脚链接接真（病根#6「用户动作无真效果」家族·占位未接真）：SiteFooter 的「关于我们」「Lucky 鸭」
    // 曾是纯 <text>、无 @tap、点了没反应（用户报「这两个是空的」）。守卫锁两链接必绑 @tap 导航
    // + 关于我们页 pages/about/index.vue 存在，防回退死链接。同 detail-share-wired/customer-service-wired/
    // home-card-add-real 的「占位/死按钮占真入口」家族。
    id: 'footer-links-wired',
    roots: ['#6'],
    desc: '页脚链接接真（病根#6 占位未接真家族）：pages/index/components/SiteFooter.vue 的「关于我们」「Lucky 鸭」须绑 @tap 导航（不留纯 text 死链接），且 pages/about/index.vue 关于我们页存在——防页脚链接回退「点了没反应」',
    run() {
      const bad = []
      const f = 'packages/miniapp/src/pages/index/components/SiteFooter.vue'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失（页脚）`]
      const src = readFileSync(abs, 'utf8')
      for (const label of ['关于我们', 'Lucky 鸭']) {
        const re = new RegExp(`<text\\b[^>]*@tap[^>]*>\\s*${label}\\s*</text>`)
        if (!re.test(src))
          bad.push(`${f}「${label}」链接未绑 @tap 导航——死链接占位（病根#6 占位未接真）`)
      }
      const about = 'packages/miniapp/src/pages/about/index.vue'
      if (!existsSync(join(ROOT, about)))
        bad.push(`${about} 缺失（关于我们页，页脚链接目标）`)
      return bad
    },
  },
  {
    // 钱链可观测告警接入（债#23 代码侧·根因#13/钱链）：平台自带指标看不见「语义级/静默失败」——
    // payCallback 金额不符/未知订单、refundCallback 与单不符/非成功 等回调返 ACK 200 却实际出错。
    // 这些静默失败点须经 kit/observe 的 alert() 打统一可告警标记，控制台对 [LD_ALERT] 配日志告警。
    // 守卫锁两钱链回调引 alert，防告警被静默移除回退成「平台看着成功、实则钱链炸了无人知」。
    id: 'moneychain-alert-wired',
    roots: ['#14'],
    desc: '钱链可观测告警接入（债#23 代码侧）：payCallback/refundCallback 静默语义失败须经 kit/observe 的 alert()/notifyAlert() 打 [LD_ALERT] 标记（控制台日志告警抓取；notifyAlert＝alert+企微群机器人推送·债#23续）——防钱链失败信号被移除，平台指标看不见的「返200却出错」无人知',
    run() {
      const bad = []
      const files = [
        'packages/cloud/src/functions/orders/payCallback.ts',
        'packages/cloud/src/functions/orders/refundCallback.ts',
      ]
      for (const f of files) {
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失（钱链回调，债#23）`)
          continue
        }
        if (!/\b(notifyAlert|alert)\(/.test(readFileSync(abs, 'utf8')))
          bad.push(`${f} 未用 alert()/notifyAlert() 打钱链告警标记——静默语义失败无信号（债#23 可观测）`)
      }
      const obs = join(ROOT, 'packages/cloud/src/kit/observe.ts')
      if (!existsSync(obs) || !/export function alert/.test(readFileSync(obs, 'utf8')))
        bad.push('kit/observe.ts 未导出 alert——钱链告警标记缺失（债#23）')
      return bad
    },
  },
  {
    // 支付窗口单一来源（病根#5「样板复制即漂移」）：15 分钟支付倒计时/超时关单窗口曾硬编码三份
    // ——closeExpiredOrders（关单 cron）/ pay（惰性关单）/ 前端 order 页（倒计时），且跨端。一处改了
    // 别处不改 → 前端倒计时与服务端关单口径不一致（钱/体验都会错）。根治＝收口 shared/limits.ts 的
    // PAY_WINDOW_MS，三处引常量；字面量「15 * 60 * 1000」只许出现在 limits.ts。
    id: 'pay-window-single-source',
    roots: ['#5'],
    desc: '支付窗口单一来源（病根#5）：15 分钟支付窗口 PAY_WINDOW_MS 只在 shared/limits.ts 定义，closeExpiredOrders/pay/前端 order 页引常量——防三处硬编码 15*60*1000 跨端漂移致倒计时与关单口径不一致',
    run() {
      const bad = []
      const NEEDLE = '15 * 60 * 1000'
      const home = 'packages/shared/src/limits.ts'
      const absHome = join(ROOT, home)
      if (!existsSync(absHome) || !/export const PAY_WINDOW_MS/.test(readFileSync(absHome, 'utf8')))
        bad.push(`${home} 未导出 PAY_WINDOW_MS——支付窗口单源缺失（病根#5）`)
      for (const dir of ['packages/cloud/src', 'packages/miniapp/src']) {
        for (const f of walk(join(ROOT, dir))) {
          const rel = relative(ROOT, f)
          if (readFileSync(f, 'utf8').includes(NEEDLE))
            bad.push(`${rel} 硬编码支付窗口「${NEEDLE}」——须引 shared 的 PAY_WINDOW_MS 单源（病根#5）`)
        }
      }
      return bad
    },
  },
  {
    // 物流轨迹接快递100免费插件（R17 / 占位③，2026-06-15 用户拍板②）：manifest mp-weixin 声明
    // 插件 wx6885acbedba59c14（别名 kuaidi100）+ 订单页「查看物流」微信端 `plugin://kuaidi100/index`
    // 打开插件查询页（别名跳转·非 plugin-private://APPID，调试日志 O 修正），打开失败/其它端回退复制运单号；
    // 中文快递名→快递100 编码经 utils/express（com 选填）。诚实边界：插件真机渲染靠人验（根因#8）。
    id: 'express-plugin-wired',
    roots: ['R17'],
    desc: '物流轨迹接快递100插件（R17/占位③）：manifest 声明插件 wx6885acbedba59c14 + 订单页「查看物流」用 plugin://kuaidi100/index 打开插件查询页 + utils/express 中文快递名→编码，防回退只复制运单号',
    run() {
      const bad = []
      const APPID = 'wx6885acbedba59c14'
      const mani = join(ROOT, 'packages/miniapp/src/manifest.json')
      if (!existsSync(mani)) bad.push('manifest.json 缺失')
      else if (!readFileSync(mani, 'utf8').includes(APPID))
        bad.push(`manifest.json 未声明快递100插件 ${APPID}——物流插件未注册（R17③）`)
      const order = join(ROOT, 'packages/miniapp/src/pages/order/index.vue')
      if (!existsSync(order)) bad.push('pages/order/index.vue 缺失')
      else if (!readFileSync(order, 'utf8').includes('plugin://kuaidi100/'))
        bad.push('order/index.vue「查看物流」未用 plugin://kuaidi100/ 打开插件——别名跳转缺失（R17③）')
      const exp = join(ROOT, 'packages/miniapp/src/utils/express.js')
      if (!existsSync(exp)) bad.push('utils/express.js 缺失（中文快递名→快递100 编码映射，R17③）')
      else if (!/export function expressCode/.test(readFileSync(exp, 'utf8')))
        bad.push('utils/express.js 未导出 expressCode——快递公司编码映射缺失（R17③）')
      return bad
    },
  },
  {
    // 看板/批次读路径不静默封顶（债#18/#22·规模）：getDashboard 曾各表 limit(1000) 内存聚合——
    // 破千静默少算 GMV/计数；batches 列表 limit(1000) 截断旧码。治法＝计数走 .count()（精确不封顶）、
    // 列表走分页全取（fetchAll）、钱链异常走定向 where。守卫锁 dashboard 用 count() + 两文件禁裸
    // limit(1000)（分析样本用 limit(SAMPLE) 具名常量、不匹配此字面量）。courses uploadChunks 的
    // limit(1000) 上游 uploadFinish 已卡 total<=200、不在此列（安全·见债#22）。
    // 360 provider（B1.3 起）：每个 customer360/providers/*.ts 的列表 .get() 须带 .limit() 上界——
    // 防大客户 360 聚合一次拉爆某板块（坐席查一个老客户即拖垮整页·架构规范铁律三注「每 provider bounded」）。
    id: 'capacity-reads-bounded',
    roots: ['规模'],
    desc: '读路径不静默封顶（债#18/#22·规模）：dashboard 计数走 .count() 精确、batches 列表分页全取（禁裸 limit(1000)）；customer360/providers/ 每个 provider 列表 .get() 须带 .limit()（防大客户 360 拖垮·铁律三）；承面C 坐席台 agentDesk listQueue/getThread 列表读须带 .limit()（防大待接队列/长会话拖垮·B6）',
    run() {
      const bad = []
      const dash = 'packages/cloud/src/functions/admin/adminApi/actions/dashboard.ts'
      const batches = 'packages/cloud/src/functions/admin/adminApi/actions/batches.ts'
      const absDash = join(ROOT, dash)
      if (!existsSync(absDash)) bad.push(`${dash} 缺失（看板）`)
      else if (!/\.count\(/.test(readFileSync(absDash, 'utf8')))
        bad.push(`${dash} 未用 .count() 精确计数——总量恐回退内存 length 封顶（债#18）`)
      for (const f of [dash, batches]) {
        const abs = join(ROOT, f)
        if (existsSync(abs) && readFileSync(abs, 'utf8').includes('limit(1000)'))
          bad.push(`${f} 含裸 limit(1000)——读路径须 count()/分页，不得固定上限封顶（债#18/#22）`)
      }
      // 360 provider 读须 bounded（B1.3·铁律三）：凡做列表 .get() 的 provider 文件须带 .limit()
      const provDir = join(ROOT, 'packages/cloud/src/functions/admin/adminApi/customer360/providers')
      if (existsSync(provDir)) {
        for (const e of readdirSync(provDir)) {
          if (!e.endsWith('.ts')) continue
          const src = readFileSync(join(provDir, e), 'utf8')
          if (/\.get\s*\(/.test(src) && !/\.limit\s*\(/.test(src))
            bad.push(`customer360/providers/${e} 列表 .get() 未带 .limit() 上界——provider 读须 bounded（防大客户 360 拖垮·铁律三）`)
        }
      }
      // 承面C 坐席台读路径 bounded（B6·根因#7）：listQueue（待接队列）/getThread（会话消息流）列表读须带 .limit() 上界
      const desk = join(ROOT, 'packages/cloud/src/functions/admin/adminApi/actions/agentDesk.ts')
      if (existsSync(desk)) {
        const dsrc = readFileSync(desk, 'utf8')
        const sliceFn = (name) => {
          const st = dsrc.indexOf('export async function ' + name)
          if (st < 0) return ''
          const nx = dsrc.indexOf('export async function ', st + 1)
          return nx < 0 ? dsrc.slice(st) : dsrc.slice(st, nx)
        }
        for (const fn of ['listQueue', 'getThread']) {
          const body = sliceFn(fn)
          if (!body) bad.push(`agentDesk.ts 缺 ${fn}（承面C 坐席台读路径·B6）`)
          else if (!/\.limit\s*\(/.test(body))
            bad.push(`agentDesk.ts ${fn} 列表读未带 .limit() 上界——坐席台读须 bounded（防大待接队列/长会话拖垮·根因#7·B6）`)
        }
      }
      return bad
    },
  },
  {
    // 学习域按用户读路径有界（规模·根因#7/#8）：getMyCourses/getMyProgress/confirmEnter 对
    // activations/progress/orders 的本人查询裸 `.get()` 会吃 CloudBase 默认 100 上限静默截断——
    // 重度用户漏课/漏进度，confirmEnter 漏撤退货权（>100 单时退货权失效漏判=可白退）。mock 不复现
    // 默认截断（根因#8 桩≠真），故以结构守卫钉「这些读须带 .limit() 显式上界」防回退裸 .get()。
    id: 'learning-user-reads-bounded',
    roots: ['#7'],
    desc: '学习域按用户读有界（规模·根因#7/#8 mock 不复现默认 100 截断）：getMyCourses/getMyProgress/confirmEnter 对 activations/progress/orders 的本人查询须带 .limit() 显式上界——杜绝裸 .get() 默认 100 静默截断（重度用户漏课/漏撤退货权）',
    run() {
      const bad = []
      const dir = join(ROOT, 'packages/cloud/src/functions/learning')
      for (const f of ['getMyCourses.ts', 'getMyProgress.ts', 'confirmEnter.ts']) {
        const abs = join(dir, f)
        if (!existsSync(abs)) {
          bad.push(`learning/${f} 缺失（按用户读有界·规模）`)
          continue
        }
        if (!/\.limit\(/.test(readFileSync(abs, 'utf8')))
          bad.push(`learning/${f} 本人读未带 .limit() 上界——裸 .get() 默认 100 静默截断（规模·根因#7/#8）`)
      }
      return bad
    },
  },
  {
    // 评价列表 cursor 分页（根因#7 固定 limit 规模挤出·债#13）：原 getReviews `limit(200)` 固定——
    // 商品评价过 200 时「全部评价」页旧评价被截断挤出。列表须走 pageQuery 游标分页（同订单/售后）；
    // 汇总仍基于 bounded 样本（≤200·approx 标注·真增量聚合属院外债#13 后半·同 dashboard 近似口径）。
    id: 'reviews-list-paged',
    roots: ['#7'],
    desc: '评价列表 cursor 分页（根因#7·债#13）：catalog/getReviews.ts 列表须经 kit pageQuery 游标分页（不再固定 limit 截断·>200 评价被挤出全部评价页）；汇总另走 bounded 样本（approx）',
    run() {
      const f = 'packages/cloud/src/functions/catalog/getReviews.ts'
      if (!existsSync(join(ROOT, f))) return [`${f} 缺失（评价列表·债#13）`]
      const src = readFileSync(join(ROOT, f), 'utf8')
      const bad = []
      if (!/pageQuery\s*\(/.test(src))
        bad.push(`${f} 列表未经 pageQuery 游标分页——固定 limit 规模即把旧评价挤出全部评价页（根因#7·债#13）`)
      return bad
    },
  },
  {
    // 集合名只用已登记的（债#28·安全·根因#3 信任边界）：库权限按集合逐一锁，打错字（aftersales）
    // → 静默建/查锁名单外的无保护集合＝洞。kit/collections.ts 的 COLLECTIONS 是集合名权威册；
    // 校验全库 .collection()/createCollection/ensure 的字面量名都在册内——打错即红，新集合须先登记。
    id: 'known-collections-only',
    roots: ['#3'],
    desc: '集合名只用已登记的（债#28）：kit/collections.ts 的 COLLECTIONS 为集合名单源；任何 .collection()/createCollection/ensure 的字面量名须在册内——防打错字建到 16 集合锁名单外的无权限保护集合',
    run() {
      const home = join(ROOT, 'packages/cloud/src/kit/collections.ts')
      if (!existsSync(home)) return ['packages/cloud/src/kit/collections.ts 缺失（集合名单源·债#28）']
      const m = readFileSync(home, 'utf8').match(/COLLECTIONS\s*=\s*\{([\s\S]*?)\}/)
      const known = new Set(m ? [...m[1].matchAll(/['"]([a-zA-Z_]+)['"]/g)].map((x) => x[1]) : [])
      if (!known.size) return ['kit/collections.ts 未定义 COLLECTIONS（集合名单源·债#28）']
      const bad = []
      const pat = /(?:\.collection|createCollection)\(\s*['"]([a-zA-Z_]+)['"]|ensure\(\s*\w+\s*,\s*['"]([a-zA-Z_]+)['"]/g
      const root = join(ROOT, 'packages/cloud/src')
      const walkDir = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walkDir(p)
          else if (e.endsWith('.ts') && p !== home) {
            const s = readFileSync(p, 'utf8')
            for (const mm of s.matchAll(pat)) {
              const name = mm[1] || mm[2]
              if (!known.has(name))
                bad.push(`${relative(ROOT, p)} 用了未登记集合名「${name}」——须先登记 kit/collections.ts COLLECTIONS（防打错字建无保护集合·债#28）`)
            }
          }
        }
      }
      walkDir(root)
      return bad
    },
  },
  {
    // 付费视频白嫖防护单源（审计 P1·根因#3 信任边界）：付费课视频是受保护资产，播放地址只能
    // 经鉴权云函数 getPlaybackUrl 服务端换短时效临时 URL 下发——既现有架构正确，又防新加 learning
    // 函数把 fileID 漏进公开返回 / 绕鉴权自行造 URL（既有 getCourses 剥成 hasVideo·getPlaybackUrl
    // 鉴权后发 URL，已被 getPlaybackUrl.test.js 行为锁；本守卫补结构闸——新函数撞规即红，防回归）。
    id: 'video-url-via-cloud-only',
    roots: ['#3'],
    desc: '付费视频白嫖防护单源（审计 P1·根因#3 信任边界）：learning/ 域内 ① 临时 URL 接缝 getTempUrl 只许 getPlaybackUrl.ts 调（播放地址单源经鉴权云函数下发）；② 原始 videoFileId 只许在 getPlaybackUrl.ts(服务端定位)/getCourses.ts(剥成 hasVideo 布尔) 出现，其他 learning 函数引用即红——防新函数漏 fileID 进公开返回 / 绕鉴权造 URL（白嫖付费课视频）；③ getPlaybackUrl.ts 须既经 getTempUrl 又有权属闸 NOT_ENTITLED，缺任一即白嫖洞',
    run() {
      const dir = join(ROOT, 'packages/cloud/src/functions/learning')
      if (!existsSync(dir)) return ['learning 域缺失（付费视频保护单点·审计 P1）']
      const GATE = 'getPlaybackUrl.ts' // 唯一鉴权后下发播放 URL 的云函数
      const FILEID_ALLOW = new Set([GATE, 'getCourses.ts']) // 定位 / 剥 hasVideo·已审计
      const bad = []
      for (const e of lsScan(dir)) {
        if (!e.endsWith('.ts')) continue
        const src = readFileSync(join(dir, e), 'utf8')
        if (e !== GATE && /\bgetTempUrl\s*\(/.test(src))
          bad.push(`learning/${e} 调 getTempUrl 造播放 URL——临时 URL 只许经鉴权云函数 ${GATE} 下发（白嫖防护·审计 P1·根因#3）`)
        if (!FILEID_ALLOW.has(e) && /videoFileId/.test(src))
          bad.push(`learning/${e} 引用 videoFileId——原始 fileID 只许在 ${GATE}(定位)/getCourses.ts(剥 hasVideo) 出现，防漏进公开返回（审计 P1·根因#3）`)
      }
      const gate = join(dir, GATE)
      if (!existsSync(gate)) bad.push(`learning/${GATE} 缺失——播放 URL 鉴权单点丢失（审计 P1）`)
      else {
        const g = readFileSync(gate, 'utf8')
        if (!/\bgetTempUrl\s*\(/.test(g)) bad.push(`learning/${GATE} 未经 getTempUrl 接缝下发 URL——临时 URL 单源失守（审计 P1）`)
        if (!/NOT_ENTITLED/.test(g)) bad.push(`learning/${GATE} 缺权属闸 NOT_ENTITLED——付费段白嫖防护失守（审计 P1·根因#3）`)
      }
      // 审计 #10：getCourses 课/章/节须逐层显式白名单、不裸 ...c/...ch/...l 展开原始文档——否则往课/课时文档
      // 加内部字段会静默漏进公开返回，而上面只盯 videoFileId 字面量、抓不到对象展开（fail-open）。
      const gc = join(dir, 'getCourses.ts')
      if (existsSync(gc) && /\.\.\.(c|ch|l)\b/.test(readFileSync(gc, 'utf8')))
        bad.push(`learning/getCourses.ts 裸 ...c/...ch/...l 展开原始文档——课/章/节须逐层显式白名单（fail-closed·防加字段静默漏进公开返回·审计 #10）`)
      // 审计 P2-4：trackEvent 进度折叠须按「已确认进课 enteredAt 非空」过滤·与播放鉴权同闸——否则「已激活
      // 未确认」直调 trackEvent 可污染进度 + 看板统计。
      const te = join(dir, 'trackEvent.ts')
      if (existsSync(te)) {
        const t = readFileSync(te, 'utf8')
        if (/collection\('activations'\)/.test(t) && !/enteredAt:\s*_\.neq\(null\)/.test(t))
          bad.push(`learning/trackEvent.ts 进度折叠 activations 查询未要求 enteredAt 非空——「已激活未确认进课」可污染进度/看板（须与 getPlaybackUrl/getMyCourses 同闸·审计 P2-4）`)
      }
      return bad
    },
  },
  {
    // 帮助视频地址经云端临时 URL 单源（审计 P1·根因#3 信任边界·同 video-url-via-cloud-only 思路）：
    // 求助面板「辅助视频」是云存储资产（控制台「帮助视频」上传），播放地址只能经 catalog/getHelpVideos.ts
    // 服务端换短时效临时 URL 下发——videoFileId 不出公开接口（前端拿裸 fileID 会造外链·撞合规红线 +
    // urlCheck 翻 true 真机播不了·根因#8）。本守卫补结构闸：新加 catalog 函数若漏 fileID 进返回 / 自行
    // 造 URL 当场红。getHelpVideos 是免费通用求助内容（非付费课），故无 NOT_ENTITLED 权属闸（与付费版区别）。
    id: 'help-video-url-via-cloud-only',
    roots: ['#3'],
    desc: '帮助视频地址经云端临时 URL 单源（审计 P1·根因#3 信任边界）：catalog/ 域内 ① 帮助视频临时 URL 接缝 getHelpVideos.ts 须经 getTempUrl 下发；② 原始 videoFileId 只许在 getHelpVideos.ts 服务端解析、其他 catalog 函数引用即红——防新函数漏 fileID 进公开返回 / 前端拿裸 fileID 造外链（合规红线·根因#8/#3）',
    run() {
      const dir = join(ROOT, 'packages/cloud/src/functions/catalog')
      if (!existsSync(dir)) return ['catalog 域缺失（帮助视频地址单点·审计 P1）']
      const GATE = 'getHelpVideos.ts' // 唯一服务端换帮助视频临时 URL 的云函数
      const bad = []
      for (const e of lsScan(dir)) {
        if (!e.endsWith('.ts')) continue
        const src = readFileSync(join(dir, e), 'utf8')
        if (e !== GATE && /\bgetTempUrls?\s*\(/.test(src))
          bad.push(`catalog/${e} 调 getTempUrl(s) 造帮助视频 URL——临时 URL 只许经 ${GATE} 下发（审计 P1·根因#3）`)
        if (e !== GATE && /videoFileId/.test(src))
          bad.push(`catalog/${e} 引用 videoFileId——帮助视频原始 fileID 只许在 ${GATE} 服务端解析，防漏进公开返回（审计 P1·根因#3）`)
      }
      const gate = join(dir, GATE)
      if (!existsSync(gate)) bad.push(`catalog/${GATE} 缺失——帮助视频播放 URL 单点丢失（审计 P1）`)
      else if (!/\bgetTempUrls?\s*\(/.test(readFileSync(gate, 'utf8')))
        bad.push(`catalog/${GATE} 未经 getTempUrl(s) 接缝下发 URL——临时 URL 单源失守（审计 P1）`)
      return bad
    },
  },
  {
    // 生产 env id 单源（病根#5·债#30①脚本侧）：deploy-fns 部署目标 / loadtest·deploy-test「拒生产」
    // 安全闸 共用生产 env id；各写一份→改一漏一致安全闸与部署目标不一致。收口 scripts/lib/env.mjs 一份。
    id: 'prod-env-single-source',
    roots: ['#5'],
    desc: '生产 env id 单源（病根#5·债#30①）：scripts/ 里生产云环境 id 只在 scripts/lib/env.mjs 定义（PROD_ENV）；deploy-fns/loadtest/deploy-test 须 import、不各写一份——防改一漏一致「拒生产」安全闸不一致。guard-deploy 的 id 仅在确认消息文案（非逻辑常量）·豁免',
    run() {
      const src = join(ROOT, 'scripts/lib/env.mjs')
      if (!existsSync(src)) return ['scripts/lib/env.mjs 缺失（生产 env id 单源·病根#5）']
      const m = readFileSync(src, 'utf8').match(/PROD_ENV\s*=\s*['"]([a-z0-9-]+)['"]/i)
      const envId = m ? m[1] : ''
      if (!envId) return ['scripts/lib/env.mjs 未定义 PROD_ENV（生产 env id 单源·病根#5）']
      const bad = []
      for (const f of readdirSync(join(ROOT, 'scripts'))) {
        if (!f.endsWith('.mjs') || f === 'guard-deploy.mjs') continue // guard-deploy：id 仅在文案·非逻辑常量·豁免
        if (readFileSync(join(ROOT, 'scripts', f), 'utf8').includes(envId))
          bad.push(`scripts/${f} 硬编码生产 env id「${envId}」——须 import { allDeployNames } from './lib/deploy-aliases.mjs'
import { PROD_ENV } from './lib/env.mjs'（单源·病根#5·债#30①）`)
      }
      return bad
    },
  },
  {
    // 集合计数单源（文档体系规则⑥·客观计数机器维护）：巡检 #001-003 反复标 16/17/18 口径漂移——
    // 库权限表标题「17」/系统事实「17+1」/真值 18 三处不一，因计数被手抄、加集合没同步。kit/collections.ts
    // COLLECTIONS 是集合数真值；系统事实「DB collection」计数列 + 库权限表标题须报同一数、不手抄 stale。
    id: 'collection-count-synced',
    roots: ['#11'],
    desc: '集合计数单源（规则⑥·客观计数机器维护）：kit/collections.ts COLLECTIONS 集合数为真值；系统事实「DB collection」计数列 + 库权限表标题须报同一数——防 16/17/18 手抄漂移（巡检 #001-003 反复标）',
    run() {
      const home = join(ROOT, 'packages/cloud/src/kit/collections.ts')
      if (!existsSync(home)) return []
      const m = readFileSync(home, 'utf8').match(/COLLECTIONS\s*=\s*\{([\s\S]*?)\}/)
      const n = m ? new Set([...m[1].matchAll(/['"]([a-zA-Z_]+)['"]/g)].map((x) => x[1])).size : 0
      if (!n) return []
      const bad = []
      const sys = join(ROOT, 'docs/系统事实.md')
      if (existsSync(sys)) {
        const row = readFileSync(sys, 'utf8')
          .split('\n')
          .find((l) => l.trimStart().startsWith('|') && l.includes('DB collection'))
        const cell = row ? (row.split('|')[2] || '').trim() : ''
        if (cell !== String(n))
          bad.push(`系统事实「DB collection」计数列为「${cell}」≠ COLLECTIONS 真值 ${n}（客观计数单源·规则⑥·别手抄）`)
      }
      const perm = join(ROOT, 'console-assets/02-库权限期望表.md')
      if (existsSync(perm) && !new RegExp('##\\s*' + n + '\\s*个集合').test(readFileSync(perm, 'utf8')))
        bad.push(`库权限表标题未报 ${n} 个集合——计数漂移（巡检反复标 16/17/18·须随 COLLECTIONS 同步）`)
      // 跨文档防漂（熵地图 E2·守卫盲区补缺）：引用文档不得手抄集合总数（应纯指针指 系统事实）——任何「N 集合」≠ 真值即红。
      // 扫描面含 active-15 之外的层（console-assets/README·这层原漏守·「看别的文档」批补入）。
      for (const rel of ['docs/业务逻辑架构.md', 'console-assets/README.md']) {
        const p = join(ROOT, rel)
        if (!existsSync(p)) continue
        for (const mm of readFileSync(p, 'utf8').matchAll(/(\d+)\s*集合/g))
          if (Number(mm[1]) !== n)
            bad.push(`${rel} 手抄「${mm[1]} 集合」≠ COLLECTIONS 真值 ${n}（客观计数单源·应纯指针指 系统事实·别手抄·熵地图 E2）`)
      }
      return bad
    },
  },
  {
    // 新线集合逐名登记库权限期望表（2026-07-12 配置清单可填写化审查批）：secureConfig（企微 Secret/商户
    // 私钥承重）动态建默认 private 是已知真洞（rateLimit/wxBills 前科·期望表自注），漏出期望表＝逃出
    // 「上线前逐项锁 adminonly」的人工核对面。collection-count-synced 只核旧线 packages/cloud 计数，
    // 新线净新增集合（anomalies/inspectRuns/secureConfig…）对它结构性不可见——本守卫按名补上。
    id: 'rw-collection-perm-registered',
    roots: ['#9', '#3'],
    desc: '新线集合逐名登记库权限期望表：rewrite/shared/src/collections.ts 每个集合名须在 console-assets/02-库权限期望表.md 有期望档位行——动态建默认 private=真洞，漏登记即逃出锁权限人工核对（配置清单审查批·secureConfig 首踩）',
    run() {
      const home = join(ROOT, 'rewrite/shared/src/collections.ts')
      const perm = join(ROOT, 'console-assets/02-库权限期望表.md')
      if (!existsSync(home) || !existsSync(perm)) return []
      const m = stripComments(readFileSync(home, 'utf8')).match(/COLLECTIONS\s*=\s*\{([\s\S]*?)\}/)
      if (!m) return ['rewrite/shared/src/collections.ts 未解析到 COLLECTIONS 块（守卫失效·先修解析）']
      const names = new Set([...m[1].matchAll(/:\s*['"]([a-zA-Z_]+)['"]/g)].map((x) => x[1]))
      if (!names.size) return ['rewrite/shared COLLECTIONS 解析为空（守卫失效·先修解析）']
      const table = readFileSync(perm, 'utf8')
      const bad = []
      for (const n of names)
        if (!table.includes('`' + n + '`'))
          bad.push(`新线集合 ${n} 未登记 console-assets/02-库权限期望表.md（动态建默认 private·须有期望档位行并于控制台锁 adminonly）`)
      return bad
    },
  },
  {
    id: 'function-count-synced',
    roots: ['#11'],
    desc: '云函数计数单源（规则⑥·客观计数机器维护）：cloudbaserc.json 的 functions 数为真值；系统事实「云函数」计数行须报同一数——防 28/32/33 手抄漂移（doc-audit 首审命中：部署后没回写状态文档）',
    run() {
      const rc = join(ROOT, 'cloudbaserc.json')
      if (!existsSync(rc)) return []
      let n = 0
      try {
        const fns = JSON.parse(readFileSync(rc, 'utf8')).functions
        n = Array.isArray(fns) ? fns.length : 0
      } catch {
        return []
      }
      if (!n) return []
      const bad = []
      const sys = join(ROOT, 'docs/系统事实.md')
      if (existsSync(sys)) {
        // §3 扫描基线表里「| 云函数 | N | …」那行（数字格·区别于 §2 归口表的同名行）
        const row = readFileSync(sys, 'utf8')
          .split('\n')
          .find((l) => l.trimStart().startsWith('| 云函数 |') && /^\d+$/.test((l.split('|')[2] || '').trim()))
        const cell = row ? (row.split('|')[2] || '').trim() : ''
        if (cell !== String(n))
          bad.push(`系统事实「云函数」计数为「${cell || '缺'}」≠ cloudbaserc.json functions 真值 ${n}（客观计数单源·规则⑥·别手抄·部署后回写）`)
      }
      return bad
    },
  },
  {
    // admin action 计数单源（规则⑥·病根#11·客观计数机器维护）：系统事实「admin action」行长期手抄
    // （94＝91+3），巡检抓到真值已是 97+3=100——两个真值都动态解析、不许硬编码（硬编码=再造手抄计数，
    // 恰是本守卫要治的病）：①ACTIONS 键数＝rewrite/cloud/src/functions/adminApi/index.ts `const ACTIONS`
    // 花括号块（配平取块防 `}` 提前截断，同 collection-count-synced 手法）内 `键:` 行数；②pre-auth 判支数＝
    // main() 分发处「先于 checkKey(db,key,false) 校验」的 `action === '字面量'` if 链个数（当前实现＝字面量
    // 比对：ping/login/loginByWecomCode，非集合，故按此构造动态数）。任一解析为 0 视为解析失败即红（防
    // 结构改动后假绿·同 rw-agent-tokens-synced 交集<5 手法）。
    id: 'admin-action-count-synced',
    roots: ['#11'],
    desc: 'admin action 计数单源（规则⑥·病根#11·客观计数机器维护）：rewrite/cloud/src/functions/adminApi/index.ts 的 ACTIONS 键数 + main() 分发处 checkKey(db,key,false) 之前的 pre-auth `action===字面量` 判支数为真值；系统事实「admin action」行「ACTIONS（N）」与总数须报同一数——防手抄漂移（任一解析为 0 视为解析失败即红）',
    run() {
      const bad = []
      const idx = join(ROOT, 'rewrite/cloud/src/functions/adminApi/index.ts')
      if (!existsSync(idx)) return []
      const src = readFileSync(idx, 'utf8')
      // ① ACTIONS 键数：花括号配平取块（防 `}` 提前截断）
      const actionsStart = src.indexOf('const ACTIONS')
      let keyCount = 0
      if (actionsStart >= 0) {
        const braceStart = src.indexOf('{', actionsStart)
        let depth = 0
        let braceEnd = -1
        for (let i = braceStart; i < src.length; i++) {
          if (src[i] === '{') depth++
          else if (src[i] === '}') {
            depth--
            if (depth === 0) {
              braceEnd = i
              break
            }
          }
        }
        const actionsBlock = braceEnd > braceStart ? src.slice(braceStart + 1, braceEnd) : ''
        keyCount = (actionsBlock.match(/^\s{2}\w+:/gm) || []).length
      }
      // ② pre-auth 判支数：main() 分发处、checkKey(db, key, false) 之前的 `action === '字面量'` 个数
      const mainStart = src.indexOf('export const main')
      const authIdx = mainStart >= 0 ? src.indexOf("checkKey(db, key, false)", mainStart) : -1
      const preauthSlice = mainStart >= 0 && authIdx > mainStart ? src.slice(mainStart, authIdx) : ''
      const preauthCount = (preauthSlice.match(/action === '\w+'/g) || []).length
      if (!keyCount || !preauthCount) {
        bad.push(
          `admin-action-count-synced：解析失败（ACTIONS 键数=${keyCount}、pre-auth 判支数=${preauthCount}，任一为 0 视为解析失败，防结构改动假绿）`,
        )
        return bad
      }
      const total = keyCount + preauthCount
      const sys = join(ROOT, 'docs/系统事实.md')
      if (existsSync(sys)) {
        const text = readFileSync(sys, 'utf8')
        const row = text.split('\n').find((l) => l.trimStart().startsWith('| admin action |'))
        if (!row) {
          bad.push('系统事实.md 未找到「| admin action |」行——admin-action-count-synced 无法比对')
          return bad
        }
        const totalCell = (row.split('|')[2] || '').trim()
        if (totalCell !== String(total))
          bad.push(
            `系统事实「admin action」总数为「${totalCell}」≠ 真值 ${total}（ACTIONS ${keyCount} + pre-auth ${preauthCount}·客观计数单源·规则⑥·别手抄）`,
          )
        const actionsMatch = row.match(/ACTIONS`?\s*[（(](\d+)[）)]/)
        if (!actionsMatch || Number(actionsMatch[1]) !== keyCount)
          bad.push(
            `系统事实「admin action」行「ACTIONS（${actionsMatch ? actionsMatch[1] : '缺'}）」≠ ACTIONS 键数真值 ${keyCount}（客观计数单源·规则⑥·别手抄）`,
          )
      }
      return bad
    },
  },
  {
    id: 'archive-index-synced',
    roots: ['#11'],
    desc: '退役-唤起闭环（根因#11·文档生命周期）：docs/archive/ 每份归档须在 archive/README.md 索引登记（防退役了查不到=唤起失效）+ 活文档（CLAUDE/docs 顶层）引用的 archive/* 路径须真实存在（防悬空退役指针）。索引本身被守＝不会自己 stale',
    run() {
      const adir = join(ROOT, 'docs/archive')
      if (!existsSync(adir)) return []
      const readmePath = join(adir, 'README.md')
      if (!existsSync(readmePath)) return ['docs/archive/README.md 缺失——退役归档无索引、不可唤起（根因#11）']
      const readme = readFileSync(readmePath, 'utf8')
      const bad = []
      // 正向：每份归档在索引有登记
      for (const f of readdirSync(adir)) {
        if (!f.endsWith('.md') || f === 'README.md') continue
        if (!readme.includes(f)) bad.push(`docs/archive/${f} 未登记 archive/README.md 索引——退役了查不到（唤起失效·根因#11）`)
      }
      // 反向：活文档引用的 archive/* 路径须存在（防悬空指针）
      const actives = ['CLAUDE.md']
      const docsDir = join(ROOT, 'docs')
      if (existsSync(docsDir))
        for (const f of readdirSync(docsDir)) if (f.endsWith('.md')) actives.push('docs/' + f)
      for (const rel of actives) {
        const p = join(ROOT, rel)
        if (!existsSync(p)) continue
        for (const m of readFileSync(p, 'utf8').matchAll(/archive\/([^\s)）`、，。"']+\.md)/g))
          if (!existsSync(join(adir, m[1]))) bad.push(`${rel} 引用 archive/${m[1]} 但文件不存在——悬空退役指针（根因#11）`)
      }
      return bad
    },
  },
  {
    // 跨文档「重构日志 <日期>」指针随批次卷档失活（熵地图 E1·我边治边造的盲区）：批次卷档到 archive 后，
    // 活文档里「详 重构日志 2026-06-24」这类指针指向的日期已不在活档（只剩卷档标签）→ 读者扑空。
    // 守卫扫活文档紧邻「重构日志」的日期引用，该日期须在活 重构日志 有 ## 标题（排除卷档标签行），
    // 否则该处须显式指 archive（含 'archive'）。同 archive-index-synced 守指针不悬空。
    id: 'docs-pointer-liveness',
    roots: ['#11'],
    desc: '跨文档指针不失活（根因#11·熵地图 E1）：活文档「重构日志 <YYYY-MM-DD>」引用，该日期须在活 重构日志.md 有真标题（非卷档标签）；否则该行须显式指 archive——防批次卷档后指针扑空',
    run() {
      const log = join(ROOT, 'docs/重构日志.md')
      if (!existsSync(log)) return []
      // 活日期＝真标题里的日期；排除卷档标签行（含「卷档」或「archive」）——那些日期已搬走、不算活
      const liveDates = new Set(
        readFileSync(log, 'utf8')
          .split('\n')
          .filter((l) => /^#{2,3}\s/.test(l) && !l.includes('卷档') && !l.includes('archive'))
          .flatMap((l) => [...l.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]))
      )
      const bad = []
      const dir = join(ROOT, 'docs')
      for (const f of lsScan(dir)) {
        if (!f.endsWith('.md') || f === '重构日志.md') continue
        readFileSync(join(dir, f), 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (line.includes('archive')) return // 已显式指归档·放行
            for (const m of line.matchAll(/重构日志[`\s]{0,4}(\d{4}-\d{2}-\d{2})/g))
              if (!liveDates.has(m[1]))
                bad.push(
                  `docs/${f}:${i + 1} 引用「重构日志 ${m[1]}」但该日期已不在活 重构日志（卷档了）——失活指针，须改指 archive（根因#11·熵地图 E1）`
                )
          })
      }
      return bad
    },
  },
  {
    // 归档层无界增长（熵地图 E4·我早先 flag 过没闭的盲区）：退役制把熵移进 archive 而非消除，archive 同样
    // 会无界膨胀（archive-index-synced 只守索引在、不守量）。超份数上限即提示季度合并——治「熵只是搬家不是消失」。
    id: 'archive-bounded',
    roots: ['#11'],
    desc: '归档层有界（根因#11·熵地图 E4）：docs/archive/ 归档文件数 ≤ 上限；超限即提示季度合并（同主题旧档归并为一卷 + 更新 README 索引）——退役制的熵搬进 archive 后同样需治膨胀',
    run() {
      const adir = join(ROOT, 'docs/archive')
      if (!existsSync(adir)) return []
      const CAP = 30
      const files = readdirSync(adir).filter((f) => f.endsWith('.md') && f !== 'README.md')
      if (files.length > CAP)
        return [
          `docs/archive/ ${files.length} 份归档 > ${CAP} 上限——归档层膨胀（根因#11·熵地图 E4）；季度合并旧档（同主题归并为一卷）+ 更新 README 索引`,
        ]
      return []
    },
  },
  {
    // 文档引用不失效（「看别的文档」批·泛化 archive-index-synced 反向指针检查到所有 doc 引用）：active docs +
    // CLAUDE + skills 里写的 `docs/X.md` / `archive/X.md` 引用，被引文件须真实存在——治「接口正册→已并入系统事实 /
    // 切换runbook→已归档 / 上线前占位清单→不存在」这类失活指针（重命名/归档/删除后引用没跟·active-15 之外的层原漏守）。
    id: 'doc-refs-exist',
    roots: ['#11'],
    desc: '文档引用不失效（根因#11）：docs/* + CLAUDE + skills 里的 `docs/X.md`/`archive/X.md` 引用须 resolve——防重命名/归档/删除后失活指针（泛化 archive-index-synced 反向检查到所有 doc 引用·覆盖 active-15 之外的层）',
    run() {
      const bad = []
      const targets = ['CLAUDE.md']
      const docsDir = join(ROOT, 'docs')
      if (existsSync(docsDir)) for (const f of readdirSync(docsDir)) if (f.endsWith('.md')) targets.push('docs/' + f)
      const skillsDir = join(ROOT, '.claude/skills')
      if (existsSync(skillsDir))
        for (const d of readdirSync(skillsDir)) {
          const sp = join('.claude/skills', d, 'SKILL.md')
          if (existsSync(join(ROOT, sp))) targets.push(sp)
        }
      for (const rel of targets) {
        const text = readFileSync(join(ROOT, rel), 'utf8')
        for (const m of text.matchAll(/(docs\/archive\/|docs\/|archive\/)([^\s)）、，。`"'\]|]+\.md)/g)) {
          const [, pre, name] = m
          const target = pre === 'docs/' ? join(ROOT, 'docs', name) : join(ROOT, 'docs/archive', name)
          if (!existsSync(target)) bad.push(`${rel} 引用 ${pre}${name} 但文件不存在——失活文档指针（重命名/归档/删除后没跟·根因#11）`)
        }
      }
      return bad
    },
  },
  {
    // CLAUDE §9 把工作流声明为「可直调 skill」，但原先没守卫校验这些 `/skill` 引用真有对应 skill 目录——
    // 治理体检抓到 `/anti-overengineering-check` 列在册却无 .claude/skills/ 目录（悬空指针·点了调不出）。
    // 与 archive-index-synced 守归档指针、guard-coverage 守 [机器守:id]/test 文件指针同类（防文档指向不存在的东西）。
    id: 'skills-referenced-exist',
    roots: ['#11'],
    desc: 'skill 指针不悬空（根因#11·同 archive-index-synced）：CLAUDE §9 工作流注册表里每个 `/skill-name` 引用须有 .claude/skills/<name>/SKILL.md——防列了点不出的悬空 skill 指针',
    run() {
      const claudePath = join(ROOT, 'CLAUDE.md')
      if (!existsSync(claudePath)) return []
      const claude = readFileSync(claudePath, 'utf8')
      // 取 §9 段（## 9. … 到 ## 10. 之前）——「工作流 = skills」的声明册
      const seg = claude.match(/## 9\.[\s\S]*?(?=\n## 10\.)/)
      if (!seg) return ['CLAUDE.md 解析不到 §9 工作流段（## 9. … ## 10.）——skills 注册表无从核（根因#11）']
      const bad = []
      const seen = new Set()
      for (const m of seg[0].matchAll(/`\/([a-z][a-z-]+)`/g)) {
        const name = m[1]
        if (seen.has(name)) continue
        seen.add(name)
        if (!existsSync(join(ROOT, '.claude/skills', name, 'SKILL.md')))
          bad.push(`CLAUDE §9 列 \`/${name}\` 但无 .claude/skills/${name}/SKILL.md——悬空 skill 指针（点了调不出·根因#11）`)
      }
      return bad
    },
  },
  {
    id: 'module-registry-complete',
    roots: ['#11'],
    desc: '模块正册不重不漏（车队地基批1·病根#11 单源防漂）：modules.json 把活线全部 app action / adminApi action 文件 / mp 页 / admin 页 / agent 页 / 集合按业务模块登记，一条目归属唯一模块——加 action/页面/集合不登记、登记了源码里不存在的名字、或一条目挂两模块，即红。用途：异常归因带模块 ID（批2 接线）+ 车队施工单范围=模块（tier 定档：red 工头亲自/yellow 逐行评审/green 放手）',
    run() {
      const bad = []
      const regPath = join(ROOT, 'modules.json')
      if (!existsSync(regPath)) return ['modules.json 缺失——模块正册是异常归因与车队派活的单源，恢复它（结构见守卫 desc）']
      let reg
      try {
        reg = JSON.parse(readFileSync(regPath, 'utf8'))
      } catch (e) {
        return [`modules.json 不是合法 JSON：${e.message}`]
      }
      const modules = reg?.modules ?? {}
      const TIERS = new Set(['red', 'yellow', 'green'])
      for (const [mid, m] of Object.entries(modules)) {
        if (!m?.name) bad.push(`modules.json 模块 \`${mid}\` 缺 name——补中文名`)
        if (!TIERS.has(m?.tier)) bad.push(`modules.json 模块 \`${mid}\` tier=\`${m?.tier}\` 非法——取 red/yellow/green 之一`)
      }
      // 六轴真值全部从源码/目录现读（不信正册自述·与 build.mjs/枚举同源规则）
      const appSrc = readFileSync(join(ROOT, 'rewrite/cloud/src/functions/app/index.ts'), 'utf8')
      const appBlock = appSrc.match(/const ACTIONS[^{]*\{([\s\S]*?)\n\}/)
      const truth = {
        appActions: appBlock ? [...appBlock[1].matchAll(/^\s*([A-Za-z0-9_]+),/gm)].map((m) => m[1]) : [],
        adminActionFiles: readdirSync(join(ROOT, 'rewrite/cloud/src/functions/adminApi/actions'))
          .filter((f) => f.endsWith('.ts'))
          .map((f) => f.replace(/\.ts$/, '')),
        mpPages: readdirSync(join(ROOT, 'rewrite/mp/pages')).filter((d) =>
          statSync(join(ROOT, 'rewrite/mp/pages', d)).isDirectory()
        ),
        adminPages: readdirSync(join(ROOT, 'rewrite/admin/src/pages'))
          .filter((f) => f.endsWith('.vue'))
          .map((f) => f.replace(/\.vue$/, '')),
        agentPages: readdirSync(join(ROOT, 'rewrite/agent/src'))
          .filter((f) => f.endsWith('.vue'))
          .map((f) => f.replace(/\.vue$/, '')),
        collections: [
          ...readFileSync(join(ROOT, 'rewrite/shared/src/collections.ts'), 'utf8').matchAll(
            /^\s*([A-Za-z0-9_]+):\s*'/gm
          ),
        ].map((m) => m[1]),
      }
      for (const axis of Object.keys(truth)) {
        const owner = new Map()
        for (const [mid, m] of Object.entries(modules)) {
          for (const item of m?.[axis] ?? []) {
            if (owner.has(item))
              bad.push(`\`${item}\`（${axis}）被登记在 \`${owner.get(item)}\` 与 \`${mid}\` 两个模块——一条目唯一归属，删一处`)
            else owner.set(item, mid)
          }
        }
        for (const item of truth[axis])
          if (!owner.has(item))
            bad.push(`${axis} \`${item}\` 未在 modules.json 任一模块登记——加进所属模块（源头新增先登记再用）`)
        for (const item of owner.keys())
          if (!truth[axis].includes(item))
            bad.push(`modules.json 登记的 ${axis} \`${item}\` 在源码里不存在——删除或改名（防幽灵登记）`)
      }
      return bad
    },
  },
  {
    // 守卫计数 + 病根计数 + 测试计数自洽（文档体系规则⑥·客观计数机器维护·巡检 #009 ④/💡）：守卫数随加守卫
    // 天天涨、病根数随立新病根涨（12→13）、被手抄进治理文档必漂（#009 标 31 vs 真值 35；治理体检抓到
    // 自动化验证系统「13 条 repoCheck」vs 真值 86、元模式/账本「12 类病根」vs 真值 13）——同 collection-count-synced
    // 的「客观计数别手抄」病（病根#11），但作用在**治理文档自身**：元守卫 guard-coverage 只核「病根↔守卫」逻辑闭环、
    // 不核这些计数，于是它们漂了没人发现。本守卫补这条缝：repoChecks/fileRules 数组长度＝守卫数真值（含本守卫自己）、
    // 根因账本 §一 `### N.` 病根数＝病根数真值（与 guard-coverage 同源），**全部治理文档**里「N repoCheck / M fileRule /
    // K 类病根」须报同一数。（原「测试数自洽」子检查批1 退役——空样本恒绿的摆设，见 run() 尾注。）
    id: 'guard-count-synced',
    roots: ['#11'],
    desc: '客观计数机器维护（规则⑥·病根#11·治理文档自身防漂）：repoChecks/fileRules 数组长度为守卫数真值、根因账本 §一 `### N.` 数为病根数真值（与 guard-coverage 同源）；所有治理文档（现状与路线/自动化验证系统/CLAUDE/元模式/根因账本）里「N repoCheck / M fileRule / K 类病根」须报同一数（防手抄漂移·体检抓的 13≠86、12≠13 那类）',
    run() {
      const bad = []
      const realRepo = repoChecks.length
      const realFile = fileRules.length
      // 病根数真值：根因账本 §一 `### N.` 标题数（与 guard-coverage 解析同源·单一来源不二抄）
      const ledgerPath = join(ROOT, 'docs/根因账本.md')
      const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : ''
      const realRoots = ledger
        ? [...ledger.split('## 二、')[0].matchAll(/^###\s*(\d+)\.\s/gm)].length
        : 0
      // 扫全部治理文档：守卫计数 + 病根计数 须报真值（客观计数机器维护·别手抄·病根#11 作用在治理文档自身）
      const govDocs = [
        'docs/现状与路线.md',
        'docs/自动化验证系统.md',
        'CLAUDE.md',
        'docs/元模式.md',
        'docs/根因账本.md',
      ]
      for (const rel of govDocs) {
        const p = join(ROOT, rel)
        if (!existsSync(p)) continue
        const text = readFileSync(p, 'utf8')
        for (const m of text.matchAll(/(\d+)\s*条?\s*(?:仓级\s*)?repoCheck/g))
          if (Number(m[1]) !== realRepo)
            bad.push(`${rel} 报「${m[1]} repoCheck」≠ 真值 ${realRepo}（repoChecks 数组·客观计数单源·别手抄·#11）`)
        for (const m of text.matchAll(/(\d+)\s*条?\s*(?:逐文件\s*)?fileRule/g))
          if (Number(m[1]) !== realFile)
            bad.push(`${rel} 报「${m[1]} fileRule」≠ 真值 ${realFile}（fileRules 数组·客观计数单源·别手抄·#11）`)
        if (realRoots)
          for (const m of text.matchAll(/(\d+)\s*类病根/g))
            if (Number(m[1]) !== realRoots)
              bad.push(`${rel} 报「${m[1]} 类病根」≠ 真值 ${realRoots}（根因账本 §一 病根数·客观计数单源·别手抄·#11）`)
      }
      // 测试数子检查已退役（批1·盲区体检 2026-07-18·病根#16「空样本=绿」实例）：原「现状与路线内多处
      // 『测试 N』互相自洽」检查自 M0 后永久空转——该文档的测试数全是「测试 1033→1547」式历史里程碑区间
      // （本就该互不相等·自洽前提不成立），且两条正则实测只捞到 1 个样本（'1033'），Set.size>1 恒假。
      // 摆设守卫比没有守卫更糟（给「测试数有人核」的假安全感）。测试数真值只在 vitest 运行时报告里，
      // 静态闸证不了；若将来要机器核，需 vitest reporter 落一份受版本控制的计数文件再比对（另立批）。
      return bad
    },
  },
  {
    // 剥注释/方法体截取单源守卫（病根#5 样板复制即漂移·执行者错题本 E1 坑史：方法体正则咬注释假绿——
    // 2026-07-08 播放页批/客服批连栽两次）：stripComments/methodBody 是原三处/四处重复正则字面量收敛后
    // 的单源 helper（scripts/check-structure.mjs 工具函数区·isCommentLine 之后）。本守卫钉住「不许绕开
    // helper 再裸写一遍同款字面量」——两个 needle 只许出现在各自 helper 定义 span 内，出现在别处即漂移
    // 复辟。自指手法：needle 用字符串拼接构造，防本守卫自身源码里出现完整字面量、自己咬自己。
    id: 'guard-strip-single-source',
    roots: ['#5'],
    desc: '剥注释/方法体截取单源（病根#5 样板复制即漂移·防裸写正则绕开 helper 再咬注释）：剥注释正则字面量只许出现在 stripComments 定义内、方法体截取边界字面量只许出现在 methodBody 定义内——出现在别处即视为绕开单源 helper 裸写复辟（错题本 E1）',
    run() {
      const bad = []
      const self = join(ROOT, 'scripts/check-structure.mjs')
      const src = readFileSync(self, 'utf8')
      // 两个 needle 字符串拼接构造（防本守卫自身源码含完整字面量、自己把自己咬红）
      // stripComments 块注释替换回调用换行占位（保留行号，P2 复审）——needle 同步跟着实现改，
      // 否则本守卫会因实现文本变了而永远搜不到自己、静默失去防漂移作用（不是「不咬」，是「咬不到」）。
      const stripNeedle =
        'replace(/\\/\\/' + "[^\\n]*/g, '').replace(/\\/\\*" + "[\\s\\S]*?\\*\\//g, (m) => m.replace(/[^\\n]/g, ''))"
      const boundaryNeedle = '\\n {2}' + '\\},'
      // 容忍 export 前缀（helper 已 export 供单测）——起点/下一函数边界都放宽匹配。边界只认「function」
      // 关键字会漏防：const/let/var 写的箭头函数裸写同款字面量、插在两个 helper 定义之间（或其后到下一个
      // function 关键字之前），会被误判「落在 span 内」而放行——2026-07-09 反向自检咬出，见错题本。
      // 边界关键字集扩到 function/const/let/var，堵住这一类顶层声明绕过。
      const findSpan = (fnName) => {
        const startMatch = src.match(new RegExp('(?:export\\s+)?function\\s+' + fnName + '\\b'))
        if (!startMatch) return null
        const start = startMatch.index
        const nextMatch = src.slice(start + 1).match(/\n(?:export\s+)?(?:function|const|let|var)\s/)
        return [start, nextMatch ? start + 1 + nextMatch.index : src.length]
      }
      const stripSpan = findSpan('stripComments')
      const bodySpan = findSpan('methodBody')
      if (!stripSpan) return ['scripts/check-structure.mjs 找不到 stripComments 定义——单源 helper 缺失（错题本 E1）']
      if (!bodySpan) return ['scripts/check-structure.mjs 找不到 methodBody 定义——单源 helper 缺失（错题本 E1）']
      const inAnySpan = (idx) =>
        (idx >= stripSpan[0] && idx < stripSpan[1]) || (idx >= bodySpan[0] && idx < bodySpan[1])
      const lineOf = (idx) => src.slice(0, idx).split('\n').length
      for (const needle of [stripNeedle, boundaryNeedle]) {
        let i = -1
        while ((i = src.indexOf(needle, i + 1)) !== -1) {
          if (!inAnySpan(i))
            bad.push(`scripts/check-structure.mjs:${lineOf(i)} 裸写正则字面量绕开单源 helper（stripComments/methodBody·病根#5 样板复制即漂移·错题本 E1）`)
        }
      }
      return bad
    },
  },
  {
    // 错误码只用已登记的（债#29·根因#3）：kit `err()` 返回的码是**前端按精确字符串分支的契约**；
    // shared/errors.ts 的 ERR 是错误码权威册。校验全库 `err('字面量')` 的码都在册内——打错码即红、
    // 新码须先登记（前端才能对得上）。动态码 `err('X:'+v)` 非纯字面量、不校验。
    id: 'known-error-codes',
    roots: ['#3'],
    desc: '错误码只用已登记的（债#29）：shared/errors.ts 的 ERR 为错误码单源；全库 kit `err(\'字面量\')` 的码须在册内——防打错码致前端契约对不上（前端按精确码分支）',
    run() {
      const home = join(ROOT, 'packages/shared/src/errors.ts')
      if (!existsSync(home)) return ['packages/shared/src/errors.ts 缺失（错误码单源·债#29）']
      const m = readFileSync(home, 'utf8').match(/ERR\s*=\s*\{([\s\S]*?)\}\s*as const/)
      const known = new Set(m ? [...m[1].matchAll(/:\s*['"]([A-Z_]+)['"]/g)].map((x) => x[1]) : [])
      if (!known.size) return ['shared/errors.ts 未定义 ERR（错误码单源·债#29）']
      const bad = []
      const pat = /\berr\(\s*['"]([A-Z_]+)['"]\s*\)/g // 纯字面量 err('X')；动态 err('X:'+v) 不匹配
      const root = join(ROOT, 'packages/cloud/src')
      const walkDir = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walkDir(p)
          else if (e.endsWith('.ts')) {
            for (const mm of readFileSync(p, 'utf8').matchAll(pat)) {
              if (!known.has(mm[1]))
                bad.push(`${relative(ROOT, p)} 用了未登记错误码「${mm[1]}」——须先登记 shared/errors.ts ERR（前端按精确码分支·债#29）`)
            }
          }
        }
      }
      walkDir(root)
      return bad
    },
  },
  {
    // 订单域派生物与声明同步（P3「安全处生成」spike·北极星 A）：order.spec.ts 是订单/售后状态机的
    // 声明单源；order.ts（类型/常量/流转表）与 scripts/order-domain.generated.json 是其生成物。
    // 改声明须跑 `node scripts/gen-order-domain.mjs` 同步生成物——漂移即红，杜绝「改了声明忘重生成」。
    // 覆盖面＝gen-order-domain.mjs 的 DOMAINS 数组全量（跑一次 --check 全域一起验，不逐域列举——新增域
    // 只用改 DOMAINS，本守卫零改动自动纳管）：packages/ 侧 order+learning+cs+scm 四域；rewrite/ 侧目前
    // 仅 scm 一域镜像声明（scm.ts 头部曾错误自称「由本脚本生成」实为手工镜像，本项补齐覆盖后横幅才不撒谎）。
    id: 'gen-order-domain-synced',
    roots: ['#2', 'P3'],
    desc: '声明域派生物与声明同步（P3 安全处生成，覆盖面见 gen-order-domain.mjs DOMAINS：packages/ order+learning+cs+scm 四域、rewrite/ scm 一域镜像）：各域 .ts + order-domain.generated.json 由对应 .spec.ts 经 scripts/gen-order-domain.mjs 生成；漂移（改声明未重生成，含 rewrite/shared/src/scm.ts）即红——跑 `node scripts/gen-order-domain.mjs` 修复',
    run() {
      const spec = join(ROOT, 'packages/shared/src/order.spec.ts')
      const learnSpec = join(ROOT, 'packages/shared/src/learning.spec.ts')
      const rwScmSpec = join(ROOT, 'rewrite/shared/src/scm.spec.ts')
      if (!existsSync(spec)) return ['packages/shared/src/order.spec.ts 缺失（订单域声明单源·P3）']
      if (!existsSync(learnSpec)) return ['packages/shared/src/learning.spec.ts 缺失（learning 域声明单源·P3 扩）']
      if (!existsSync(rwScmSpec)) return ['rewrite/shared/src/scm.spec.ts 缺失（新线 SCM 域声明单源·P3 扩）']
      try {
        execSync(`node ${join(ROOT, 'scripts/gen-order-domain.mjs')} --check`, { encoding: 'utf8', stdio: 'pipe' })
        return []
      } catch (e) {
        const msg = (e && (e.stderr || e.stdout || e.message)) || '生成物与声明不同步'
        return [String(msg).trim()]
      }
    },
  },
  {
    // 订单域状态写入只走声明流转（根因#2 状态散写从「靠人记」升「机器对账」·P3 spike 核心 ROI）：
    // order.spec.ts 声明合法流转表，本守卫把散落在云函数里的状态写入与之对账——
    // ① 任何 transition('orders'|'afterSales', …, [from], 'to') 的 (from[]→to) 须是声明里的一条边；
    // ② 任何写 orders/afterSales status 的字面量值须是声明里出现过的状态（init/terminal/流转两端）。
    // 函数私自越流转（写未声明状态 / transition 走未声明边）当场红——防「散写各自背诵规则」回归。
    id: 'order-transitions-declared',
    roots: ['#2', 'P3'],
    desc: '订单+learning+cs 域状态写入只走声明流转（根因#2·P3 spike·扩 learning·承面C 扩 cs）：transition(orders/afterSales/qrcodes/csSession) 的边须在 order.spec.ts/learning.spec.ts/cs.spec.ts 声明流转表内；写这些集合 status 的字面量须是声明状态——函数私自越流转/写未声明状态即红（扫 functions/orders+learning + admin orders/refunds/agentDesk）',
    run() {
      const jsonPath = join(ROOT, 'scripts/order-domain.generated.json')
      if (!existsSync(jsonPath)) return ['scripts/order-domain.generated.json 缺失——跑 `node scripts/gen-order-domain.mjs`（订单域声明派生物·P3）']
      let spec
      try {
        spec = JSON.parse(readFileSync(jsonPath, 'utf8'))
      } catch {
        return ['scripts/order-domain.generated.json 解析失败——重生成（P3）']
      }
      // 声明流转表（拆成「单个 from → to」原子边集）+ 状态集（按集合）。
      // 拆原子边：声明里 from:['a','b']→c 记为 a→c 与 b→c 两条；实现里 transition([a,b],c) 的每个
      // from 元素都须有声明的原子边到 c（union 语义：当前态 ∈ {a,b} 则翻 c）。
      const declaredEdges = {} // coll -> Set("from=>to")（原子边·单 from）
      const declaredStates = {} // coll -> Set(state)
      for (const coll of Object.keys(spec)) {
        declaredStates[coll] = new Set(spec[coll].states)
        const edges = new Set()
        for (const t of spec[coll].transitions) for (const f of t.from) edges.add(f + '=>' + t.to)
        declaredEdges[coll] = edges
      }
      const COLLS = new Set(Object.keys(spec)) // 'orders' / 'afterSales'

      // 受管域文件：orders 函数 + admin 订单/退款 actions + learning 函数（qrcodes 状态写入散落处·P3 扩 learning）
      const files = []
      for (const dir of ['packages/cloud/src/functions/orders', 'packages/cloud/src/functions/learning']) {
        const abs = join(ROOT, dir)
        if (existsSync(abs)) for (const e of readdirSync(abs)) if (e.endsWith('.ts')) files.push(join(abs, e))
      }
      // + 承面C 坐席台 actions（B6·transition('csSession')·对账 cs 流转·工单 §3 车道 A）
      for (const a of ['orders.ts', 'refunds.ts', 'agentDesk.ts']) {
        const p = join(ROOT, 'packages/cloud/src/functions/admin/adminApi/actions', a)
        if (existsSync(p)) files.push(p)
      }
      // + 进销存 SCM actions（SCM-0 门2 扩面·蓝图 docs/进销存ERP/：车道文件 scm*.ts 按前缀全纳对账——
      // purchaseOrders/outworkOrders 状态写入散落处·车道 A/B 新增 scmPurchase/scmOutwork 自动覆盖、不用再改本守卫）
      {
        const actionsDir = join(ROOT, 'packages/cloud/src/functions/admin/adminApi/actions')
        if (existsSync(actionsDir)) for (const e of readdirSync(actionsDir)) if (/^scm\w*\.ts$/.test(e)) files.push(join(actionsDir, e))
      }

      const bad = []
      for (const p of files) {
        const src = readFileSync(p, 'utf8')
        const rel = relative(ROOT, p)

        // ① transition('<coll>', id, [<from...>], '<to>', …)：整条边对账
        const transRe = /transition\(\s*['"](\w+)['"]\s*,[^,]+,\s*\[([^\]]*)\]\s*,\s*['"](\w+)['"]/g
        let tm
        while ((tm = transRe.exec(src))) {
          const coll = tm[1]
          if (!COLLS.has(coll)) continue // 未声明集合不在本守卫范围（声明集合＝orders/afterSales/qrcodes）
          const from = [...tm[2].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
          const to = tm[3]
          // union 语义：每个 from 元素都须有声明的原子边 from→to，缺一即越流转
          const undeclared = from.filter((f) => !declaredEdges[coll].has(f + '=>' + to))
          if (undeclared.length)
            bad.push(`${rel}：transition('${coll}', …, [${from.join(',')}] → '${to}') 含未声明边 ${undeclared.map((f) => f + '→' + to).join('、')}——order.spec.ts 流转表里没有，越流转或改声明再生成（根因#2·P3）`)
        }

        // ② 写库 status 字面量：.update({ data: { … status: 'X' … } })（含 add/set 初始态）须是声明状态。
        // 只在写侧（update/add/set 的 data 对象内）取值，避开 .where 过滤侧与 err('BAD_STATUS') 等读侧。
        // 判定哪个集合：取该 status 写入点之前最近的 .collection('<coll>') / transition('<coll>')。
        const writeRe = /\bstatus:\s*['"]([a-z_]+)['"]/g
        let wm
        while ((wm = writeRe.exec(src))) {
          const val = wm[1]
          const at = wm.index
          // 写侧判定：往前 160 字符若处于未闭合 .where({… 则跳过（过滤侧 from 条件，非写入）——只对账写库 status
          const before = src.slice(Math.max(0, at - 160), at)
          const inWhere = /\.where\(\s*\{[^}]*$/.test(before)
          if (inWhere) continue // where 过滤侧（from 条件），不是写入
          // 找最近归属集合
          const head = src.slice(0, at)
          const collMatches = [...head.matchAll(/(?:\.collection\(|transition\()\s*['"](\w+)['"]/g)]
          const coll = collMatches.length ? collMatches[collMatches.length - 1][1] : null
          if (!coll || !COLLS.has(coll)) continue // 未声明集合（声明集合＝orders/afterSales/qrcodes）
          if (!declaredStates[coll].has(val))
            bad.push(`${rel}：写 ${coll}.status='${val}' 不是 order.spec.ts 声明状态（${[...declaredStates[coll]].join('/')}）——打错状态名或改声明再生成（根因#2·P3）`)
        }
      }
      return bad
    },
  },
  {
    // 前端订单/售后状态值只走 shared 单源（根因#2「限调用方用 ORDER_STATUS 常量」+ #5 散落·P3 消费侧）：
    // 云端 transition()/写库已被 order-transitions-declared 对账，但前端散写 `=== 'pending'` / `status:'paid'`
    // 仍能打错状态名静默不匹配（根因#2 账本：「限调用方用常量」）。本守卫把那条不变量延伸到消费侧——
    // 受管前端文件里订单/售后状态字面量出现在**逻辑位**（比较 ===/!== / `status:` 值 / `.status =` 赋值 /
    // `[…].includes` 成员）即红，须改引 `@luckyducky/shared` 的 ORDER_STATUS/AFTERSALE_STATUS 常量（P3 生成物）。
    // 只咬逻辑位：UI 标签键（order-list `key:'pending'`）、CSS 类名（aftersales `cls:'applied'`）、课程进度
    // （catalog 的 'done'·非订单域·不在册）等同形异义不误伤；故 catalog/profile 等不入受管册。
    id: 'order-status-frontend-via-shared',
    roots: ['#2', '#5', 'P3'],
    desc: '前端订单/售后状态值只走 shared 单源（根因#2 账本「限调用方用 ORDER_STATUS 常量」延伸到消费侧·#5 散落·P3 生成物消费侧）：受管前端文件里订单/售后状态字面量出现在逻辑位（比较/status:值/.status=赋值/.includes 成员）即红，须引 @luckyducky/shared 的 ORDER_STATUS/AFTERSALE_STATUS——防散写打错状态名静默不匹配（同形异义的 UI 键/CSS 类/课程进度不误伤）',
    run() {
      // 状态枚举从声明派生（让守卫读声明·不手写枚举追状态·根因#2 元模式本仓核心主张）：orders + afterSales
      // 全状态从 order-domain.generated.json 取——新增状态（如 refund_required）自动纳入覆盖，不再靠手补枚举。
      const jsonPath = join(ROOT, 'scripts/order-domain.generated.json')
      let states
      try {
        const spec = JSON.parse(readFileSync(jsonPath, 'utf8'))
        const set = new Set()
        for (const coll of ['orders', 'afterSales']) for (const s of spec[coll]?.states || []) set.add(s)
        states = [...set]
      } catch {
        return ['scripts/order-domain.generated.json 缺失/解析失败——跑 `node scripts/gen-order-domain.mjs`（前端状态枚举派生源·P3）']
      }
      if (!states.length) return ['order-domain.generated.json 无 orders/afterSales 状态——派生源损坏（P3）']
      const STATUS = '(?:' + states.join('|') + ')'
      // 逻辑位侦测（只咬会因打错状态名静默坏逻辑的位置；UI 键/标签/CSS 类不在内）
      const pats = [
        new RegExp(`(?:===|!==|==|!=)\\s*['"]${STATUS}['"]`), // 比较右值
        new RegExp(`['"]${STATUS}['"]\\s*(?:===|!==|==|!=)`), // 比较左值
        new RegExp(`\\bstatus:\\s*['"]${STATUS}['"]`), // 对象 status: 值（如 order-list tab 过滤 status）
        new RegExp(`\\.status\\s*=\\s*['"]${STATUS}['"]`), // .status = 赋值（store 乐观置态）
        new RegExp(`\\[[^\\]]*['"]${STATUS}['"][^\\]]*\\]\\s*\\.includes`), // [..状态..].includes 成员
      ]
      // 受管册：订单/售后状态进逻辑分支的前端文件。新增此类逻辑文件须入册（同 order-transitions-declared 扫固定处的边界）。
      const managed = [
        'packages/miniapp/src/pages/order/index.vue',
        'packages/miniapp/src/pages/order-list/index.vue',
        'packages/miniapp/src/pages/checkout/index.vue',
        'packages/miniapp/src/pages/aftersales/index.vue',
        'packages/miniapp/src/pages/me/index.vue',
        'packages/miniapp/src/store/orders.js',
        'packages/miniapp/src/data/orders.js',
      ]
      const bad = []
      for (const rel of managed) {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) continue
        readFileSync(abs, 'utf8').split('\n').forEach((line, i) => {
          if (/^\s*(\/\/|\/\*|\*)/.test(line) || line.includes('structure-ok')) return
          if (pats.some((re) => re.test(line)))
            bad.push(`${rel}:${i + 1}：订单/售后状态字面量在逻辑位裸写——改引 @luckyducky/shared 的 ORDER_STATUS/AFTERSALE_STATUS 常量（根因#2·别散写打错状态名）：${line.trim().slice(0, 70)}`)
        })
      }
      return bad
    },
  },
  {
    // 扫普通链接二维码进站 routing（R3/决策§13）：印刷码扫码经微信「扫普通链接二维码打开小程序」进站，
    // 微信把扫到的 URL 经启动参数 q 传给**入口页（pages/index/index）**——入口页非激活页，须识别激活码
    // 并 reLaunch 转发 welcome，否则 q 被忽略、用户落商城首页、激活断（根因#8 真机入口落首页）。
    id: 'activation-scan-routed',
    roots: ['R3'],
    desc: '扫普通链接二维码进站 routing（R3/决策§13）：入口页 pages/index/index onLoad 须 parseActivationCode 识别激活码并 reLaunch 转发 /pages/welcome/index——防微信扫码进首页时 q 被忽略、激活断（根因#8 真机入口）',
    run() {
      const f = 'packages/miniapp/src/pages/index/index.vue'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (!/parseActivationCode/.test(src))
        bad.push(`${f} 入口页未用 parseActivationCode 识别扫码激活码——微信扫普通链接二维码进首页时 q 被忽略（R3/决策§13/根因#8）`)
      if (!/\/pages\/welcome\/index/.test(src))
        bad.push(`${f} 入口页未转发 /pages/welcome/index——识别到激活码却不跳激活页、激活断（R3）`)
      return bad
    },
  },
  {
    // 激活页背景图后台可管（橱窗·用户请求 2026-06-18）：welcome 激活页背景图从写死改为内容控制台可上传。
    // 链路 3 处缺一即断：① admin Showcase 传图存 fileID 到 home.activationBg；② 云端 saveHomeContent
    // 持久化 activationBg（content 文档白名单·不加这字段会被整存抹掉）；③ miniapp welcome 读它渲染
    // （mp <image> 原生支持 cloud:// fileID·无配回退 /static/hero-full.jpg）。
    id: 'activation-bg-wired',
    roots: ['橱窗'],
    desc: '激活页背景图后台可管（按「课程×状态」分管·用户拍板 2026-06-18）：① 全局兜底 home.activationBg（橱窗·无码引导/失败兜底）；② 按课程·按状态 home.activationBgByCourse[courseId]={welcome,welcomeBack,taken}（上新向导 StepImages 一门课传三张·欢迎页/欢迎回来/已被激活）；③ 全局·正在激活 home.loadingBg（橱窗·loading 拿不到 courseId 故全局）。每态链路：云端 saveHomeContent 持久化 + admin 上传 + miniapp content store 暴露 + welcome 按屏取——任一缺即链断。CODE_TAKEN 返 courseId（已被激活图按课程）行为由 activateCourse.test.js 锁。',
    run() {
      const bad = []
      // [文件, 须含 token, 链断说明]
      const checks = [
        ['packages/cloud/src/functions/admin/adminApi/actions/content.ts', 'activationBg', '云端 saveHomeContent 未持久化 activationBg——后台传的背景图被整存抹掉'],
        ['packages/admin/src/pages/Showcase.vue', 'activationBg', 'admin Showcase 未接 activationBg 上传——后台管不了激活页背景图'],
        ['packages/miniapp/src/pages/welcome/index.vue', 'activationBg', 'welcome 未读 activationBg——后台配的背景图不生效'],
        // ② 按课程映射（欢迎页与产品对应·用户请求 2026-06-18）
        ['packages/cloud/src/functions/admin/adminApi/actions/content.ts', 'activationBgByCourse', '云端 saveHomeContent 未持久化 activationBgByCourse——按课程欢迎图存不下（白名单漏＝整存抹掉）'],
        ['packages/admin/src/pages/steps/StepImages.vue', 'activationBgByCourse', 'admin 上新向导 StepImages 未接 activationBgByCourse 上传——后台管不了按产品/课程欢迎图'],
        ['packages/miniapp/src/store/content.js', 'activationBgByCourse', 'miniapp content store 未暴露 activationBgByCourse——欢迎页取不到按课程欢迎图'],
        ['packages/miniapp/src/pages/welcome/index.vue', 'activationBgFor', 'welcome 未按 courseId 取激活欢迎图（activationBgFor）——按产品欢迎图不生效'],
        // ②b 按课程·按状态拆三张（用户拍板 2026-06-18）：欢迎回来(welcomeBack) / 已被激活(taken)
        ['packages/cloud/src/functions/admin/adminApi/actions/content.ts', 'welcomeBack', '云端白名单未净化 welcomeBack——欢迎回来图存不下'],
        ['packages/cloud/src/functions/admin/adminApi/actions/content.ts', 'taken', '云端白名单未净化 taken——已被激活图存不下'],
        ['packages/admin/src/pages/steps/StepImages.vue', 'welcomeBack', 'admin StepImages 未接 welcomeBack 上传——后台管不了欢迎回来图'],
        ['packages/admin/src/pages/steps/StepImages.vue', 'taken', 'admin StepImages 未接 taken 上传——后台管不了已被激活图'],
        ['packages/miniapp/src/pages/welcome/index.vue', 'welcomeBack', 'welcome 未按 mine 屏取 welcomeBack 图——欢迎回来按课程图不生效'],
        ['packages/miniapp/src/pages/welcome/index.vue', 'taken', 'welcome 未按 CODE_TAKEN 屏取 taken 图——已被激活按课程图不生效'],
        // ③ 全局·正在激活(loading)图（用户拍板：loading 拿不到 courseId 故全局·橱窗管）
        ['packages/cloud/src/functions/admin/adminApi/actions/content.ts', 'loadingBg', '云端 saveHomeContent 未持久化 loadingBg——正在激活全局图存不下'],
        ['packages/admin/src/pages/Showcase.vue', 'loadingBg', 'admin 橱窗未接 loadingBg 上传——后台管不了正在激活图'],
        ['packages/miniapp/src/store/content.js', 'loadingBg', 'miniapp content store 未暴露 loadingBg——正在激活图取不到'],
        ['packages/miniapp/src/pages/welcome/index.vue', 'loadingBg', 'welcome 未读 loadingBg——正在激活图不生效'],
      ]
      for (const [f, token, msg] of checks) {
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失`)
          continue
        }
        if (!new RegExp(token).test(readFileSync(abs, 'utf8'))) bad.push(`${f}：${msg}（${token} 未见·链断）`)
      }
      return bad
    },
  },
  {
    // 目录课程随激活集/扫码 courseId 取，不恒 list[0]（根因#8：单课样本曾掩盖·多课暴露）。
    // 病史：current=list[0] 硬编码（注释「暂只有一门·多课按激活集取」的 TODO 未做）——只有 course-duck
    // 一门时 list[0] 恰等于用户课，看不出错；真上 小熊 第二门课后，激活小熊跳目录仍显 list[0]＝小鸭。
    // 链 3 处缺一即回到「永远 list[0]」：① courses store 有 currentId + setCurrent；② catalog 按
    // courseId/激活集 setCurrent；③ welcome 跳目录带 courseId=。
    id: 'catalog-course-by-activation',
    roots: ['#8'],
    desc: '课程随激活/观看记录取，不恒 list[0]（根因#8 单课样本失真·多课暴露）：courses store currentId+setCurrent + catalog 按 courseId/激活集 setCurrent + welcome 跳目录带 courseId= + 「我」页继续学习按 resolveContinue(观看记录/已解锁课)定位并 setCurrent 聚焦——任一缺即恒显第一门(演示)课',
    run() {
      const bad = []
      const checks = [
        ['packages/miniapp/src/store/courses.js', 'currentId', 'courses store 无 currentId——current 又回到恒 list[0]'],
        ['packages/miniapp/src/store/courses.js', 'setCurrent', 'courses store 无 setCurrent——无法聚焦激活课'],
        ['packages/miniapp/src/pages/catalog/index.vue', 'setCurrent', 'catalog 未按 courseId/激活集 setCurrent——目录不随激活课'],
        ['packages/miniapp/src/pages/welcome/index.vue', 'courseId=', 'welcome 跳目录未带 courseId=——目录不知聚焦哪门课'],
        ['packages/miniapp/src/pages/me/index.vue', 'resolveContinue', '「我」页继续学习未按 resolveContinue(观看记录/已解锁课)定位——进小程序又显默认演示课、点进演示列表'],
        ['packages/miniapp/src/pages/me/index.vue', 'setCurrent', '「我」页续播未 setCurrent 聚焦那门课——播放器仍取默认 list[0]演示课'],
        ['packages/miniapp/src/pages/me/index.vue', 'seg=', '「我」页继续观看未传 seg= 段标识——续播恒落第一段、不回到原小段（根因#8）'],
      ]
      for (const [f, token, msg] of checks) {
        const abs = join(ROOT, f)
        if (!existsSync(abs)) {
          bad.push(`${f} 缺失`)
          continue
        }
        if (!new RegExp(token).test(readFileSync(abs, 'utf8'))) bad.push(`${f}：${msg}（${token} 未见·链断）`)
      }
      return bad
    },
  },
  {
    // 用户反馈写库过闸 + 限频 + 集合登记（运营钩子①·待办#23 前端半边）。根因#3「写库必过闸 fail-closed」
    // + 根因#13「用户端写函数防刷」：submitFeedback 是公网可调的用户写函数，必经 withOpenId（不信前端 openid）
    // + withRateLimit（防刷库堆垃圾），且写入的 feedback 集合须在 COLLECTIONS 册（known-collections-only 同治·
    // 否则建到锁名单外无保护集合）。注：writes-need-gate 已普查「写库必过闸」、known-collections-only 已普查
    // 「集合在册」——本守卫额外钉死「这个具体函数」的频控与目标集合，防回退成无频控 / 写错集合（运营钩子绝迹证明）。
    id: 'feedback-write-gated',
    roots: ['债#23', '#13'],
    desc: '用户反馈写库过闸+限频+集合登记（运营钩子①·待办#23）：submitFeedback 须经 withOpenId + withRateLimit（根因#3/#13·公网用户写函数防伪+防刷）且写 COLLECTIONS.feedback（known-collections-only 同治）。【批L】原「cloudbaserc 须配 submitFeedback」断言已退役：本守卫守冻结旧线，而 cloudbaserc 已迁活线、新线 submitFeedback 是 app 内 action',
    run() {
      const bad = []
      const f = 'packages/cloud/src/functions/feedback/submitFeedback.ts'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失——用户反馈云函数（运营钩子①·待办#23）`]
      const src = readFileSync(abs, 'utf8')
      if (!/withOpenId\s*\(/.test(src)) bad.push(`${f} 未经 withOpenId——写库不过身份闸（根因#3 fail-closed）`)
      if (!/withRateLimit\s*\(/.test(src)) bad.push(`${f} 未经 withRateLimit——用户写函数无频控、可被刷（根因#13）`)
      // 须写 feedback 集合（认 COLLECTIONS.feedback 或裸 'feedback'；known-collections-only 另查在册）
      if (!/COLLECTIONS\.feedback|['"]feedback['"]/.test(src))
        bad.push(`${f} 未写 feedback 集合——反馈无处落库（待办#23）`)
      // 集合须登记 COLLECTIONS 册（与 known-collections-only 同治，缺则建到锁名单外无保护集合）
      const coll = join(ROOT, 'packages/cloud/src/kit/collections.ts')
      if (existsSync(coll) && !/feedback:\s*['"]feedback['"]/.test(readFileSync(coll, 'utf8')))
        bad.push('kit/collections.ts COLLECTIONS 未登记 feedback——写到锁名单外无权限保护集合（债#28/#23）')
      // 【2026-07-19 批L 退役此断言】本守卫扫描面＝冻结旧线 packages/（独立云函数形态），而 cloudbaserc.json
      // 已随部署链迁活线：新线没有独立 submitFeedback 函数，它是 `app` 网关内的一个 action，其写库过闸由活线
      // 守卫族（rw-writes-need-gate / rw-user-writes-throttled）覆盖，部署配置完整性由 deploy-config-complete
      // （已迁活线枚举）守。旧线守卫不该对活线部署配置提要求——跨线断言即指针漂移（病根#16）。
      return bad
    },
  },
  {
    // 前端错误自动上报接通（运营钩子①·待办#23 前端半边）。根因#8「构建过+单人能用≠线上无 bug」：
    // 上线初期前端 JS 错误 / 未捕获 Promise 拒绝若只静默在用户端，开发侧看不见 → 主动上报复用 events 通道
    // （有 cleanupEvents TTL 兜底·只写不读·安全）。钉死：① utils/report.js 经 track 上报（不改 trackEvent 本体、
    // 复用既有通道）；② App.vue 全局 onError + onUnhandledRejection 都调 reportError（防回退成只 logger 静默）。
    id: 'error-report-wired',
    roots: ['债#23', '#8'],
    desc: '前端错误自动上报接通（运营钩子①·待办#23）：utils/report.js reportError 经 track 走 events 通道（不改 trackEvent 本体）+ App.vue onError/onUnhandledRejection 都调 reportError（防回退成只本地静默·线上 bug 收不到·根因#8）',
    run() {
      const bad = []
      const rep = 'packages/miniapp/src/utils/report.js'
      const repAbs = join(ROOT, rep)
      if (!existsSync(repAbs)) return [`${rep} 缺失——前端错误自动上报（运营钩子①·待办#23）`]
      const repSrc = readFileSync(repAbs, 'utf8')
      if (!/export function reportError/.test(repSrc)) bad.push(`${rep} 未导出 reportError——上报入口缺失（待办#23）`)
      // 复用既有 events 通道（经 track/trackEvent），不另起新写库链
      if (!/from '@\/utils\/track\.js'|utils\/track/.test(repSrc))
        bad.push(`${rep} 未经 utils/track（events 通道）上报——应复用既有 trackEvent 通道（待办#23）`)
      const app = 'packages/miniapp/src/App.vue'
      const appAbs = join(ROOT, app)
      if (!existsSync(appAbs)) {
        bad.push(`${app} 缺失`)
        return bad
      }
      const appSrc = readFileSync(appAbs, 'utf8')
      if (!/reportError\s*\(/.test(appSrc))
        bad.push(`${app} 未调 reportError——全局错误未自动上报（线上 bug 静默·待办#23/根因#8）`)
      // onError 与 onUnhandledRejection 两条全局兜底都须接上报（任一漏即半边静默）
      for (const hook of ['onError', 'onUnhandledRejection']) {
        const m = appSrc.match(new RegExp(hook + '\\([\\s\\S]{0,200}?\\}\\)'))
        if (!m || !/reportError/.test(m[0]))
          bad.push(`${app} ${hook} 未调 reportError——该路径错误不上报（待办#23）`)
      }
      return bad
    },
  },
  {
    // admin 导航 ↔ 路由同步（根因#5 样板复制即漂移）：页面路径在 router.js 与 Sidebar.vue 各写一份，
    // 漂移两种形态：① Sidebar 引了未注册路由＝死链（点了白屏）；② router 注册了页面但侧边栏没入口＝
    // 孤儿页（加页忘加导航，页面部署了没人能进）。侧边栏重组为主类目结构后条目分散四组，人眼更难核全，交机器。
    id: 'admin-nav-route-synced',
    roots: ['#5'],
    desc: 'admin 导航与路由同步（根因#5 复制即漂移）：Sidebar.vue 引用的每个路径须在 router.js 注册（防死链）；router.js 每个静态页面路由（除 /login、重定向、带参向导）须在 Sidebar.vue 有入口（防加页忘加导航的孤儿页）',
    run() {
      const routerRel = 'packages/admin/src/router.js'
      const sidebarRel = 'packages/admin/src/components/Sidebar.vue'
      const routerAbs = join(ROOT, routerRel)
      const sidebarAbs = join(ROOT, sidebarRel)
      const bad = []
      if (!existsSync(routerAbs) || !existsSync(sidebarAbs))
        return [`${routerRel} / ${sidebarRel} 缺失（admin 导航同步守卫无从核起·#5）`]
      const routerSrc = readFileSync(routerAbs, 'utf8')
      let sidebar = readFileSync(sidebarAbs, 'utf8')
      // 跟随 Sidebar.vue 本地 @/ 静态 import 一层（如 utils/scmFlow.js 把某组 nav items 拆成共享单源
      // 供顶部标签条复用·防两处各写一份顺序漂移）：把被引文件内容并入扫描面，见得到里面的 to: 路径。
      for (const m of sidebar.matchAll(/from\s+['"]@\/([^'"]+)['"]/g)) {
        const dep = join(ROOT, 'packages/admin/src', m[1])
        if (existsSync(dep)) sidebar += '\n' + readFileSync(dep, 'utf8')
      }
      const routePaths = [...routerSrc.matchAll(/path:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
      // ① 防死链：Sidebar 声明/绑定的路径（to: 'x' 或 to="x"）都须已注册
      for (const m of sidebar.matchAll(/\bto[:=]\s*['"](\/[^'"]*)['"]/g)) {
        if (!routePaths.includes(m[1]))
          bad.push(`${sidebarRel} 引用未注册路由 ${m[1]}——死链，点了白屏（router.js 无此 path·#5）`)
      }
      // ② 防孤儿页：每个静态页面路由（非 /login、非 '/' 重定向、非带参向导）须在 Sidebar 出现
      const staticPages = routePaths.filter((p) => p !== '/login' && p !== '/' && !p.includes(':'))
      for (const p of staticPages) {
        if (!sidebar.includes(`'${p}'`) && !sidebar.includes(`"${p}"`))
          bad.push(`router.js 注册了 ${p} 但 ${sidebarRel} 无入口——孤儿页（加页忘加导航·#5）`)
      }
      return bad
    },
  },
  {
    id: 'rw-admin-nav-route-synced',
    roots: ['#5'],
    desc: '新线 admin 导航↔路由同步（根因#5 复制即漂移·旧 admin-nav-route-synced 只护 packages·换皮期新线加页/改路径无机器兜底而失守）：Shell.vue nav 引用的每个 path 须在 router.ts 注册（防死链·点了白屏）；router.ts 每个子页路由（除 login·父 /·带参）须在 Shell.vue nav 有入口（防加页忘加导航的孤儿页）。新线子路由用相对 path（orders / 空=Dashboard）·nav 用绝对（/orders /）——归一后对账',
    run() {
      const routerRel = 'rewrite/admin/src/router.ts'
      const shellRel = 'rewrite/admin/src/shell/Shell.vue'
      const routerAbs = join(ROOT, routerRel)
      const shellAbs = join(ROOT, shellRel)
      if (!existsSync(routerAbs) || !existsSync(shellAbs)) return [`${routerRel} / ${shellRel} 缺失（新线导航同步守卫无从核起·#5）`]
      const routerSrc = readFileSync(routerAbs, 'utf8')
      const shellSrc = readFileSync(shellAbs, 'utf8')
      const bad = []
      // 路由所有 path（含子页相对 path 与父/顶层绝对 path）
      const routePaths = [...routerSrc.matchAll(/path:\s*['"]([^'"]*)['"]/g)].map((m) => m[1])
      // 子页＝不带前导 / 的 path（相对·如 orders、''=Dashboard）；父 '/' 与顶层 '/login' 带前导 / 排除
      const childPages = routePaths.filter((p) => !p.startsWith('/'))
      // Shell nav 的绝对 path（{ path: '/x' }）
      const navPaths = [...shellSrc.matchAll(/\bpath:\s*['"](\/[^'"]*)['"]/g)].map((m) => m[1])
      const norm = (p) => p.replace(/^\//, '') // /orders→orders，/→''
      const childSet = new Set(childPages)
      // ① 死链：Shell nav 每个 path 须有对应子路由
      for (const np of navPaths) {
        if (!childSet.has(norm(np))) bad.push(`${shellRel} nav 引用未注册路由 ${np}——死链，点了白屏（router.ts 无对应子 path '${norm(np)}'·#5）`)
      }
      // ② 孤儿页：每个子路由（非 login·非带参）须在 Shell nav 有入口
      const navSet = new Set(navPaths.map(norm))
      for (const p of childPages) {
        if (p === 'login' || p.includes(':')) continue
        if (!navSet.has(p)) bad.push(`router.ts 注册了子路由 '${p}' 但 ${shellRel} nav 无入口——孤儿页（加页忘加导航·#5）`)
      }
      return bad
    },
  },
  {
    // 控制台/坐席台凭证不落盘（深审 P1·根因#3 信任边界）：口令是可复用主凭证——明文写 localStorage 且每请求
    // 回传，落在外包机器/共用浏览器＝失守。登录后前端只准存服务端签发的会话令牌（12h 自灭·停号即拒·sha 入库），
    // 后端 login 必经 issueSession 签发（否则前端被迫回退存口令）。行为侧由 admin-session-issued（测试）锁。
    id: 'admin-session-token-not-password',
    roots: ['#3'],
    desc: '控制台/坐席台前端登录只存服务端签发 sessionToken、口令原文不写 localStorage（深审 P1·#3）；adminApi login 必经 issueSession 签发令牌',
    run() {
      const bad = []
      for (const rel of ['packages/admin/src/api/cloud.js', 'packages/agent/src/api/agentApi.js']) {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) {
          bad.push(`${rel} 缺失（凭证不落盘守卫无从核起·#3）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        // 只盯「持久化点」：persist(...) / localStorage.setItem(...) 的实参窗口内出现口令即红。
        // 登录请求上送一次口令（body 里 key: password）是协议必需、不落盘，放行。
        for (const m of src.matchAll(/(?:\bpersist\s*\(|localStorage\.setItem\s*\()/g)) {
          const windowSrc = src.slice(m.index, m.index + 200)
          if (/(?:\bkey|token)\s*:\s*password\b/.test(windowSrc))
            bad.push(`${rel} 把口令原文写进持久化存储——只准存服务端签发的 sessionToken（深审 P1·#3）`)
        }
        if (!src.includes('sessionToken'))
          bad.push(`${rel} 未使用 sessionToken——登录须存服务端签发的会话令牌、不存口令（深审 P1·#3）`)
      }
      const idxAbs = join(ROOT, 'packages/cloud/src/functions/admin/adminApi/index.ts')
      const idxSrc = existsSync(idxAbs) ? readFileSync(idxAbs, 'utf8') : ''
      if (!/issueSession\s*\(/.test(idxSrc))
        bad.push('adminApi/index.ts login 未经 issueSession 签发会话令牌——前端将被迫存口令原文（深审 P1·#3）')
      return bad
    },
  },
  {
    // 坐席台 mock 懒加载（深审 P3·根因#8 样本数据卫生）：静态 import mock 会把整套演示数据（样本客户/订单/
    // 激活码/FAQ）打进生产 JS——内部数据形状对公网可见；动态 import 让 Vite 拆独立 chunk、只有 mock 模式才加载。
    id: 'agent-mock-lazy-only',
    roots: ['#8'],
    desc: '坐席台 mock 只准动态 import 懒加载（深审 P3·#8）：agentApi.js 禁静态 import ./mock，须 await import 按需拆 chunk——演示数据不进生产包',
    run() {
      const rel = 'packages/agent/src/api/agentApi.js'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失（mock 懒加载守卫无从核起·#8）`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (/^import\s[^\n]*from\s+['"]\.\/mock(\.js)?['"]/m.test(src))
        bad.push(`${rel} 静态 import mock——演示数据整套进生产包，改动态 import 懒加载（深审 P3·#8）`)
      if (!/await import\(['"]\.\/mock\.js['"]\)/.test(src))
        bad.push(`${rel} 未见 mock 动态 import——mock 模式将不可用（须 await import('./mock.js')·#8）`)
      return bad
    },
  },
  {
    // 认证失效前端统一处理（深审 P2·根因#3 配套）：会话令牌有 12h 过期/账号可停用——前端请求层必须认 401
    // 清登录态回登录页（否则操作者卡满屏「加载失败」不知重登，令牌过期从安全特性变成每日故障）。403 只提示不登出。
    id: 'admin-auth-expiry-handled',
    roots: ['#3'],
    desc: '控制台/坐席台请求层统一处理 401（清登录态+回登录页）——令牌过期/停号后引导重登，不卡死在报错页（深审 P2·#3 配套）',
    run() {
      const bad = []
      for (const rel of ['packages/admin/src/api/cloud.js', 'packages/agent/src/api/agentApi.js']) {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) {
          bad.push(`${rel} 缺失（401 统一处理守卫无从核起·#3）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        const has401 = /status\s*===\s*401/.test(src) && /logout\(\)/.test(src)
        if (!has401) bad.push(`${rel} 请求层未统一处理 401（须清登录态 logout() + 回登录页）——令牌过期后操作者卡死报错页（深审 P2·#3）`)
      }
      return bad
    },
  },
  {
    id: 'rw-line-in-gates',
    roots: ['铁律'],
    desc: '新线包必须被三道闸扫到（M1 批1·ADR §24 测试一等公民）：root typecheck 覆盖 rewrite/shared、vitest projects 含 rewrite 测试、listPackageJsons 扫描 rewrite/*（stub-only-sdk 等包级守卫随之覆盖新线）——防 rewrite/ 代码默默漏出 check',
    run() {
      const bad = []
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      for (const p of ['rewrite/shared', 'rewrite/cloud']) {
        if (!new RegExp(p).test(pkg.scripts?.typecheck || '')) {
          bad.push(`package.json scripts.typecheck 未覆盖 ${p}——新线类型不过闸`)
        }
      }
      const vconf = readFileSync(join(ROOT, 'vitest.config.mjs'), 'utf8')
      if (!/rewrite\//.test(vconf)) {
        bad.push('vitest.config.mjs 未含 rewrite 测试 project——新线测试不过闸')
      }
      if (!listPackageJsons().some((p) => p.startsWith('rewrite/'))) {
        bad.push('listPackageJsons() 未扫描 rewrite/*——包级守卫（stub-only-sdk 等）漏新线')
      }
      return bad
    },
  },
  {
    id: 'rw-writes-need-gate',
    roots: ['#3'],
    desc: '新线函数写库必过 kit 闸（移植 writes-need-gate·设计约束#3「不过闸写不出库」）：rewrite/cloud/src/functions/ 下每个函数单元（app/actions 逐文件；callbacks/timers/cs 顶层逐文件；多文件函数目录如 kfCallback 聚合判——index 的 defineKfCallback 外壳即全单元的闸）含写库者必须出现 withOpenId/withAdminGate/defineNotifyCallback/defineKfCallback/isServerCall/checkKey 之一',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/cloud/src/functions')
      if (!existsSync(base)) return bad
      const GATE = /\b(withOpenId|withAdminGate|defineNotifyCallback|defineKfCallback|isServerCall|checkKey)\b/
      const WRITE = /\.(add|set|update|remove)\s*\(/
      const readAll = (d) => {
        let src = ''
        for (const f of lsScan(d)) {
          const fp = join(d, f)
          if (statSync(fp).isDirectory()) src += readAll(fp)
          else if (f.endsWith('.ts')) src += readFileSync(fp, 'utf8')
        }
        return src
      }
      // 单元清单：functions/ 递归到「文件」或「含 index.ts 的目录」为一单元（与旧线域级聚合同保护强度、粒度更细）
      const units = []
      const collect = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) {
            if (existsSync(join(p, 'index.ts'))) units.push(p)
            else collect(p)
          } else if (e.endsWith('.ts')) units.push(p)
        }
      }
      collect(base)
      for (const u of units) {
        const src = statSync(u).isDirectory() ? readAll(u) : readFileSync(u, 'utf8')
        if (WRITE.test(src) && !GATE.test(src)) {
          bad.push(`${relative(ROOT, u)} 有写库但未见 kit 闸——设计约束#3 不过闸写不出库`)
        }
      }
      return bad
    },
  },
  {
    id: 'rw-order-transitions-declared',
    roots: ['#2'],
    desc: '新线订单/售后状态写入只走声明流转（根因#2·移植 order-transitions-declared·深审 2026-07-05 抓到旧守卫只扫冻结线的缺口）：rewrite/cloud 里 transition(orders/afterSales) 的边、裸条件 CAS（where status→update status）的边须在 rewrite/shared/src/order.ts 声明流转表内；写这两集合 status 的字面量须是声明状态——越流转/打错状态名即红（谱源直接解析 order.ts·零生成器·qrcode/cs/scm 域各有 spec 派生调用不在本册）',
    run() {
      const specPath = join(ROOT, 'rewrite/shared/src/order.ts')
      const base = join(ROOT, 'rewrite/cloud/src/functions')
      if (!existsSync(specPath) || !existsSync(base)) return []
      const specSrc = readFileSync(specPath, 'utf8')
      // 谱源解析：ORDER_STATUS_SPEC / AFTERSALE_STATUS_SPEC → 每集合 原子边集 + 状态集
      const declaredEdges = {} // coll -> Set('from=>to')
      const declaredStates = {} // coll -> Set(state)
      for (const bm of specSrc.matchAll(/export const \w+_STATUS_SPEC = \{([\s\S]*?)\n\} as const/g)) {
        const body = bm[1]
        const coll = (body.match(/collection:\s*'(\w+)'/) || [])[1]
        if (!coll) continue
        const states = new Set()
        for (const lm of body.matchAll(/(?:initial|terminal):\s*\[([^\]]*)\]/g))
          for (const s of lm[1].matchAll(/'([a-z_]+)'/g)) states.add(s[1])
        const edges = new Set()
        for (const tm of body.matchAll(/\{\s*from:\s*\[([^\]]*)\]\s*,\s*to:\s*'([a-z_]+)'/g)) {
          const to = tm[2]
          states.add(to)
          for (const f of tm[1].matchAll(/'([a-z_]+)'/g)) {
            edges.add(f[1] + '=>' + to)
            states.add(f[1])
          }
        }
        declaredEdges[coll] = edges
        declaredStates[coll] = states
      }
      const COLLS = new Set(Object.keys(declaredEdges)) // orders / afterSales
      const files = []
      const collectTs = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) collectTs(p)
          else if (e.endsWith('.ts')) files.push(p)
        }
      }
      collectTs(base)
      const collOf = (head) => {
        const ms = [...head.matchAll(/(?:\.collection\(|transition\()\s*(?:['"](\w+)['"]|COLLECTIONS\.(\w+))/g)]
        return ms.length ? ms[ms.length - 1][1] || ms[ms.length - 1][2] : null
      }
      const bad = []
      for (const p of files) {
        const src = readFileSync(p, 'utf8')
        const rel = relative(ROOT, p)
        // ① transition(<coll>, id, [from...], 'to')：整条边对账（union 语义每个 from 元素都须有声明原子边）
        const transRe = /transition\(\s*(?:['"](\w+)['"]|COLLECTIONS\.(\w+))\s*,[^,]+,\s*\[([^\]]*)\]\s*,\s*['"]([a-z_]+)['"]/g
        let tm
        while ((tm = transRe.exec(src))) {
          const coll = tm[1] || tm[2]
          if (!COLLS.has(coll)) continue
          const from = [...tm[3].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
          const undeclared = from.filter((f) => !declaredEdges[coll].has(f + '=>' + tm[4]))
          if (undeclared.length)
            bad.push(`${rel}：transition('${coll}', …, [${from.join(',')}] → '${tm[4]}') 含未声明边 ${undeclared.map((f) => f + '→' + tm[4]).join('、')}——rewrite/shared/src/order.ts 流转表里没有，越流转或先改声明（根因#2）`)
        }
        // ①' 裸条件 CAS：where({…status:'X'|_.in([..])…}).update({data:{…status:'Y'…}}) 的边对账（refunds/shipOne/关单/refundCallback 形态）
        const casRe = /\.where\(\s*\{[^{}]*?status:\s*(?:['"]([a-z_]+)['"]|(?:db\.command|_)\.in\(\[([^\]]*)\]\))[^{}]*?\}\s*\)[\s\S]{0,60}?\.update\(\s*\{\s*data:\s*\{[\s\S]{0,160}?\bstatus:\s*['"]([a-z_]+)['"]/g
        let cm
        while ((cm = casRe.exec(src))) {
          const coll = collOf(src.slice(0, cm.index))
          if (!coll || !COLLS.has(coll)) continue
          const from = cm[1] ? [cm[1]] : [...cm[2].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
          const to = cm[3]
          const undeclared = from.filter((f) => !declaredEdges[coll].has(f + '=>' + to))
          if (undeclared.length)
            bad.push(`${rel}：条件 CAS ${coll} [${from.join(',')}] → '${to}' 含未声明边 ${undeclared.map((f) => f + '→' + to).join('、')}——rewrite/shared/src/order.ts 流转表里没有（根因#2）`)
        }
        // ② 写侧 status 字面量须是声明状态（add/update 的 data 内·where 过滤侧跳过——打错状态名即红）
        const writeRe = /\bstatus:\s*['"]([a-z_]+)['"]/g
        let wm
        while ((wm = writeRe.exec(src))) {
          const before = src.slice(Math.max(0, wm.index - 160), wm.index)
          if (/\.where\(\s*\{[^}]*$/.test(before)) continue
          const coll = collOf(src.slice(0, wm.index))
          if (!coll || !COLLS.has(coll)) continue
          if (!declaredStates[coll].has(wm[1]))
            bad.push(`${rel}：写 ${coll}.status='${wm[1]}' 不是 rewrite/shared/src/order.ts 声明状态（${[...declaredStates[coll]].join('/')}）——打错状态名或先改声明（根因#2）`)
        }
      }
      return bad
    },
  },
  {
    id: 'rw-cs-transitions-declared',
    roots: ['#2'],
    desc: '新线客服会话状态写入只走声明流转（根因#2·csSession 域·谱源 rewrite/shared/src/cs.spec.ts）：rewrite/cloud 里 transition(csSession) 的边、裸条件 CAS（where status→update status）的边须在 rewrite/shared/src/cs.spec.ts 声明流转表内；写该集合 status 的字面量须是声明状态——越流转/打错状态名即红（谱源直接解析 cs.spec.ts·零生成器）',
    run() {
      const specPath = join(ROOT, 'rewrite/shared/src/cs.spec.ts')
      const base = join(ROOT, 'rewrite/cloud/src/functions')
      if (!existsSync(specPath) || !existsSync(base)) return []
      const specSrc = readFileSync(specPath, 'utf8')
      // 谱源解析：CS_SESSION_STATUS_SPEC → 每集合 原子边集 + 状态集
      const declaredEdges = {} // coll -> Set('from=>to')
      const declaredStates = {} // coll -> Set(state)
      for (const bm of specSrc.matchAll(/export const \w+_STATUS_SPEC = \{([\s\S]*?)\n\} as const/g)) {
        const body = bm[1]
        const coll = (body.match(/collection:\s*'(\w+)'/) || [])[1]
        if (!coll) continue
        const states = new Set()
        for (const lm of body.matchAll(/(?:initial|terminal):\s*\[([^\]]*)\]/g))
          for (const s of lm[1].matchAll(/'([a-z_]+)'/g)) states.add(s[1])
        const edges = new Set()
        for (const tm of body.matchAll(/\{\s*from:\s*\[([^\]]*)\]\s*,\s*to:\s*'([a-z_]+)'/g)) {
          const to = tm[2]
          states.add(to)
          for (const f of tm[1].matchAll(/'([a-z_]+)'/g)) {
            edges.add(f[1] + '=>' + to)
            states.add(f[1])
          }
        }
        declaredEdges[coll] = edges
        declaredStates[coll] = states
      }
      const COLLS = new Set(Object.keys(declaredEdges))
      const files = []
      const collectTs = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) collectTs(p)
          else if (e.endsWith('.ts')) files.push(p)
        }
      }
      collectTs(base)
      const collOf = (head) => {
        const ms = [...head.matchAll(/(?:\.collection\(|transition\()\s*(?:['"](\w+)['"]|COLLECTIONS\.(\w+))/g)]
        return ms.length ? ms[ms.length - 1][1] || ms[ms.length - 1][2] : null
      }
      const bad = []
      for (const p of files) {
        const src = readFileSync(p, 'utf8')
        const rel = relative(ROOT, p)
        // ① transition(<coll>, id, [from...], 'to')：整条边对账（union 语义每个 from 元素都须有声明原子边）
        const transRe = /transition\(\s*(?:['"](\w+)['"]|COLLECTIONS\.(\w+))\s*,[^,]+,\s*\[([^\]]*)\]\s*,\s*['"]([a-z_]+)['"]/g
        let tm
        while ((tm = transRe.exec(src))) {
          const coll = tm[1] || tm[2]
          if (!COLLS.has(coll)) continue
          const from = [...tm[3].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
          const undeclared = from.filter((f) => !declaredEdges[coll].has(f + '=>' + tm[4]))
          if (undeclared.length)
            bad.push(`${rel}：transition('${coll}', …, [${from.join(',')}] → '${tm[4]}') 含未声明边 ${undeclared.map((f) => f + '→' + tm[4]).join('、')}——rewrite/shared/src/cs.spec.ts 流转表里没有，越流转或先改声明（根因#2）`)
        }
        // ①' 裸条件 CAS：where({…status:'X'|_.in([..])…}).update({data:{…status:'Y'…}}) 的边对账
        const casRe = /\.where\(\s*\{[^{}]*?status:\s*(?:['"]([a-z_]+)['"]|(?:db\.command|_)\.in\(\[([^\]]*)\]\))[^{}]*?\}\s*\)[\s\S]{0,60}?\.update\(\s*\{\s*data:\s*\{[\s\S]{0,160}?\bstatus:\s*['"]([a-z_]+)['"]/g
        let cm
        while ((cm = casRe.exec(src))) {
          const coll = collOf(src.slice(0, cm.index))
          if (!coll || !COLLS.has(coll)) continue
          const from = cm[1] ? [cm[1]] : [...cm[2].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
          const to = cm[3]
          const undeclared = from.filter((f) => !declaredEdges[coll].has(f + '=>' + to))
          if (undeclared.length)
            bad.push(`${rel}：条件 CAS ${coll} [${from.join(',')}] → '${to}' 含未声明边 ${undeclared.map((f) => f + '→' + to).join('、')}——rewrite/shared/src/cs.spec.ts 流转表里没有（根因#2）`)
        }
        // ② 写侧 status 字面量须是声明状态（add/update 的 data 内·where 过滤侧跳过——打错状态名即红）
        const writeRe = /\bstatus:\s*['"]([a-z_]+)['"]/g
        let wm
        while ((wm = writeRe.exec(src))) {
          const before = src.slice(Math.max(0, wm.index - 160), wm.index)
          if (/\.where\(\s*\{[^}]*$/.test(before)) continue
          const coll = collOf(src.slice(0, wm.index))
          if (!coll || !COLLS.has(coll)) continue
          if (!declaredStates[coll].has(wm[1]))
            bad.push(`${rel}：写 ${coll}.status='${wm[1]}' 不是 rewrite/shared/src/cs.spec.ts 声明状态（${[...declaredStates[coll]].join('/')}）——打错状态名或先改声明（根因#2）`)
        }
      }
      return bad
    },
  },
  {
    // SCM 域（购/外协单）状态写入只走声明流转——新线扫描面（批K·根因#2·移植 order-transitions-declared 的
    // scm* 前缀纳管，同 rw-order-transitions-declared 精神：旧守卫（line 3758）只扫 packages/cloud，
    // rewrite/cloud/src/functions/adminApi/actions/scmPurchase.ts、scmOutwork.ts 头注承诺「受
    // order-transitions-declared 守卫保护」对生产代码是假的——这两个文件的 transition('purchaseOrders'/
    // 'outworkOrders', …) 从未被任何守卫对账过。COLLS 直接复用 scripts/order-domain.generated.json 里的
    // purchaseOrders/outworkOrders 声明（不是「借用旧线数据」：gen-order-domain.mjs 强制 packages/scm.spec.ts
    // 与 rewrite/scm.spec.ts 两份声明逐集合比对一致、不一致直接生成失败，故该 JSON 对新线同样权威——不用
    // 另写一套 rewrite/shared/src/scm.ts 的 TS 解析器）。edges/writeRe/casRe 扫描逻辑镜像
    // rw-order-transitions-declared（已验证适配新线代码形态），只收窄 COLLS 到 SCM 两集合、避免与其重复报
    // orders/afterSales。
    //
    // 批S 修复（P1·根因#2）：①的原正则只认字面量 `[...]` 第三参数——但 scmPurchase.ts/scmOutwork.ts 全部 7 处
    // transition() 调用实际写法是 `transition(coll, id, fromFor('X'), 'Y', ...)`（fromFor 是这两个文件内的
    // helper，按目标态从 PURCHASE_ORDER_TRANSITIONS/OUTWORK_ORDER_TRANSITIONS 反查 from 集合，见文件内注释），
    // 对这两个文件原正则匹配 0 次、①对全部 7 处真实流转提供的保护为零（静默假绿）。新增 fromFor(...) 形态分支：
    // 语义上 fromFor(X) 永远等于声明表里 to=X 那条的 from 集合（fromFor 找不到 to=X 会直接 throw，运行时已经
    // fail-fast），故静态守卫要抓的不是「fromFor(X) 算出的 from 对不对」，而是「调用点传给 fromFor 的 X 是否
    // 就是这次 transition() 真正写入的 to」——两者不一致＝拿错状态的 from 集合去校验另一状态的流转，越流转会
    // 被静默放行（写库时 transition() 内部仍会用实际 from 数组核对当前文档状态，但那份 from 数组已经是错的）。
    id: 'rw-scm-transitions-declared',
    roots: ['#2'],
    desc: '新线 SCM 域（购/外协单）状态写入只走声明流转（根因#2·批K 引入·批S 修复①对 fromFor(X) 调用形态的假绿：新增分支核对 fromFor 参数 X 与 transition() 第四参数 to 一致，不一致＝越流转被静默放行）：rewrite/cloud/src/functions/adminApi/actions/scm*.ts 里 transition(purchaseOrders/outworkOrders) 的边（字面量数组或 fromFor(X) 两种形态）、裸条件 CAS 的边须在 order-domain.generated.json 声明流转表内（该 JSON 由 gen-order-domain-synced 守卫保证与 packages/+rewrite 两份 scm.spec.ts 逐集合一致，对新线同样权威）；写这两集合 status 的字面量须是声明状态——越流转/打错状态名即红',
    run() {
      const jsonPath = join(ROOT, 'scripts/order-domain.generated.json')
      if (!existsSync(jsonPath)) return ['scripts/order-domain.generated.json 缺失——跑 `node scripts/gen-order-domain.mjs`（SCM 域声明派生物）']
      let spec
      try {
        spec = JSON.parse(readFileSync(jsonPath, 'utf8'))
      } catch {
        return ['scripts/order-domain.generated.json 解析失败——重生成']
      }
      const COLLS = new Set(['purchaseOrders', 'outworkOrders'].filter((c) => spec[c]))
      if (!COLLS.size) return [] // JSON 未含 SCM 集合（生成物尚未覆盖）——不报，避免误挡未落地阶段
      const declaredEdges = {} // coll -> Set('from=>to')
      const declaredStates = {} // coll -> Set(state)
      for (const coll of COLLS) {
        declaredStates[coll] = new Set(spec[coll].states)
        const edges = new Set()
        for (const t of spec[coll].transitions) for (const f of t.from) edges.add(f + '=>' + t.to)
        declaredEdges[coll] = edges
      }

      const actionsDir = join(ROOT, 'rewrite/cloud/src/functions/adminApi/actions')
      if (!existsSync(actionsDir)) return []
      const files = readdirSync(actionsDir).filter((e) => /^scm\w*\.ts$/.test(e)).map((e) => join(actionsDir, e))
      const collOf = (head) => {
        const ms = [...head.matchAll(/(?:\.collection\(|transition\()\s*(?:['"](\w+)['"]|COLLECTIONS\.(\w+))/g)]
        return ms.length ? ms[ms.length - 1][1] || ms[ms.length - 1][2] : null
      }
      const bad = []
      for (const p of files) {
        const src = readFileSync(p, 'utf8')
        const rel = relative(ROOT, p)
        // ① transition(<coll>, id, [from...]|fromFor('X'), 'to')：整条边对账（union 语义每个 from 元素都须
        // 有声明原子边；fromFor(X) 形态见批S 修复注——核对 X 与实际写入的 to 一致，见上方文件头长注）
        const transRe = /transition\(\s*(?:['"](\w+)['"]|COLLECTIONS\.(\w+))\s*,[^,]+,\s*(?:\[([^\]]*)\]|fromFor\(\s*['"]([a-z_]+)['"]\s*\))\s*,\s*['"]([a-z_]+)['"]/g
        let tm
        while ((tm = transRe.exec(src))) {
          const coll = tm[1] || tm[2]
          if (!COLLS.has(coll)) continue
          const to = tm[5]
          if (tm[4] !== undefined) {
            // fromFor(X) 形态：fromFor 永远返回声明表里 to=X 那条的 from 集合（找不到会 throw，已 fail-fast）——
            // 静态守卫要抓的不是这个恒真关系，而是调用点的 X 是否就是本次真正写入的 to（不一致＝拿错状态的
            // from 集合去校验另一状态的流转，越流转会被静默放行）。
            if (tm[4] !== to)
              bad.push(`${rel}：transition('${coll}', …, fromFor('${tm[4]}'), '${to}') 参数不一致——fromFor 求的是 '${tm[4]}' 状态的合法 from 集合，但实际写入 to='${to}'，两者应相同，否则越流转会被静默放行（根因#2·批S）`)
            continue
          }
          const from = [...tm[3].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
          const undeclared = from.filter((f) => !declaredEdges[coll].has(f + '=>' + to))
          if (undeclared.length)
            bad.push(`${rel}：transition('${coll}', …, [${from.join(',')}] → '${to}') 含未声明边 ${undeclared.map((f) => f + '→' + to).join('、')}——order-domain.generated.json 流转表里没有，越流转或先改声明（根因#2）`)
        }
        // ①' 裸条件 CAS：where({…status:'X'|_.in([..])…}).update({data:{…status:'Y'…}}) 的边对账。
        // 例外：技术性失败补偿回滚（applyStockMoves 失败后把已被 transition 抢占的状态复原，非业务逆向
        // 流转、scm.spec 刻意不声明——声明了就等于开放成业务动作，见 scmOutwork.ts/scmPurchase.ts 行内长
        // 注释）——紧邻代码块（往前 800 字符窗口内）写明 structure-ok 即放行，同本文件其它守卫的既定豁免写法。
        const casRe = /\.where\(\s*\{[^{}]*?status:\s*(?:['"]([a-z_]+)['"]|(?:db\.command|_)\.in\(\[([^\]]*)\]\))[^{}]*?\}\s*\)[\s\S]{0,60}?\.update\(\s*\{\s*data:\s*\{[\s\S]{0,160}?\bstatus:\s*['"]([a-z_]+)['"]/g
        let cm
        while ((cm = casRe.exec(src))) {
          const coll = collOf(src.slice(0, cm.index))
          if (!coll || !COLLS.has(coll)) continue
          const from = cm[1] ? [cm[1]] : [...cm[2].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1])
          const to = cm[3]
          const undeclared = from.filter((f) => !declaredEdges[coll].has(f + '=>' + to))
          if (!undeclared.length) continue
          const context = src.slice(Math.max(0, cm.index - 800), cm.index)
          if (context.includes('structure-ok')) continue
          bad.push(`${rel}：条件 CAS ${coll} [${from.join(',')}] → '${to}' 含未声明边 ${undeclared.map((f) => f + '→' + to).join('、')}——order-domain.generated.json 流转表里没有（根因#2）`)
        }
        // ② 写侧 status 字面量须是声明状态（add/update 的 data 内·where 过滤侧跳过——打错状态名即红）
        const writeRe = /\bstatus:\s*['"]([a-z_]+)['"]/g
        let wm
        while ((wm = writeRe.exec(src))) {
          const before = src.slice(Math.max(0, wm.index - 160), wm.index)
          if (/\.where\(\s*\{[^}]*$/.test(before)) continue
          const coll = collOf(src.slice(0, wm.index))
          if (!coll || !COLLS.has(coll)) continue
          if (!declaredStates[coll].has(wm[1]))
            bad.push(`${rel}：写 ${coll}.status='${wm[1]}' 不是 order-domain.generated.json 声明状态（${[...declaredStates[coll]].join('/')}）——打错状态名或先改声明（根因#2）`)
        }
      }
      return bad
    },
  },
  {
    // 原料账单点收口——新线扫描面（批K·SCM 门1·根因#1/#2·移植 material-stock-single-seam，同
    // rw-order-transitions-declared 精神：旧守卫（line 822）只扫 packages/cloud/src，rewrite/cloud/src/
    // kit/scmStock.ts 头注承诺「全库唯一 materials.stock/stockLedger 读写处（守卫 material-stock-single-seam）」
    // 对生产代码此前是假的——rewrite/cloud 下任何文件直碰这两个集合从未被拦过。逻辑镜像旧守卫（同一套判定，
    // 不弱化）：applyStockMoves 须导出、CAS 须用条件 where(stock)、除 seam 本身外全仓禁直碰。
    id: 'rw-material-stock-single-seam',
    roots: ['#1', '#2'],
    desc: '新线原料账单点收口（SCM 门1·根因#1/#2·批K·移植 material-stock-single-seam，同 rw-order-transitions-declared 精神：旧守卫只扫冻结线，kit/scmStock.ts 头注承诺的保护对生产代码此前是假的）：materials.stock/stockLedger 仅 rewrite/cloud/src/kit/scmStock.ts 读写（applyStockMoves 唯一入口·乐观 CAS）；rewrite/cloud/src 其余文件直碰即红（防绕 CAS/绕流水改账）',
    run() {
      const seam = 'rewrite/cloud/src/kit/scmStock.ts'
      const seamAbs = join(ROOT, seam)
      // seam 缺失即红（批1 从被退役的旧副本移植回：seam 文件整个没了=守卫目标消失，必须显式退役而非静默绿）
      if (!existsSync(seamAbs)) return [`${seam} 缺失——生产线原料账原语（SCM 门1）·守卫目标消失须显式退役本守卫`]
      const bad = []
      const src = stripComments(readFileSync(seamAbs, 'utf8')) // 剥注释再匹配（E1/E10：注释掉保护代码不得仍绿·Phase3 批I 评审加固·合流保留）
      if (!/export\s+async\s+function\s+applyStockMoves/.test(src)) bad.push(`${seam} 未导出 applyStockMoves——门1 空壳`)
      if (!/\.where\(\{[^}]*stock/.test(src)) bad.push(`${seam} 库存变更未用条件 where(stock) 乐观 CAS——有并发互覆盖风险（根因#1）`)
      const allow = new Set([seam])
      const srcRoot = join(ROOT, 'rewrite/cloud/src')
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts')) {
            const rel = relative(ROOT, p).replace(/\\/g, '/')
            if (allow.has(rel)) continue
            if (/COLLECTIONS\.(materials|stockLedger)\b|\.collection\(\s*['"](materials|stockLedger)['"]\s*\)/.test(stripComments(readFileSync(p, 'utf8'))))
              bad.push(`${rel} 直碰 materials/stockLedger 集合——原料账读写须经 kit/scmStock（SCM 门1·防绕 CAS/绕流水）`)
          }
        }
      }
      if (existsSync(srcRoot)) walk(srcRoot)
      return bad
    },
  },
  {
    // 原料流水确定性幂等——新线扫描面（批K·根因#2·移植 scm-ledger-idempotent，同上精神）。
    // 顺手修正旧守卫（line 854）本体带的潜伏 bug（不改旧守卫本身、只是不在新守卫里复制同一个洞）：旧正则
    // 用「'stockLedger' 与 '.add(' 相距 ≤200 字符」定位流水写入点，但实际代码里两者靠变量名（`ledger`）
    // 间接关联、源码相距 >200 字符——`node -e` 实测旧正则对 packages/cloud/src/kit/scmStock.ts 当前内容
    // 匹配 0 次，即该守卫的「_id 是否带确定性构造」检查从未真正跑过、静默假绿。新守卫改按 data 对象内是否
    // 含 `itemKey:`（流水行的标志字段，物料主档 add 没有这个字段）定位真正的流水 add 调用，不依赖变量名/
    // 字符距离；并新增「一个流水 add 都没找到」本身也报红——防止代码形态再变一次时守卫又悄悄测不到东西。
    //
    // 批S 修复（P3·根因#2）：原「确定性 _id 构造」检查与「流水 add 带 _id」检查是两条独立正则各自宽松匹配
    // ——只证明「文件里某处有三段模板」+「add 里某处有 _id 字样」同时为真，从不核对 add 里那个 _id 是不是
    // 真的来自该模板函数的调用（例如手写 `docType+':'+docId+':'+itemKey` 绕开函数、或干脆用别的变量，两条
    // 独立检查都仍然各自绿）。改为：①按模板结构（不硬编码函数名，函数改名不失效）定位确定性 id 生成函数并
    // 取其名；②对每处流水 add 提取 _id 字段实际绑定的表达式——简写 `{_id,...}`、显式变量 `_id: x`、或内联
    // 直调 `_id: fn(...)` 三种形态都认；③简写/显式变量形态下，在该 add 调用所在函数体内（粗粒度以最近的
    // `function` 关键字为作用域起点，避免跨函数误配同名变量）核对是否存在 `const/let <var> = <fn>(...)` 赋值
    // ——找不到就说明 add 用的 _id 不是那次调用产生的确定性值，幂等绑定关系并未真正成立。
    id: 'rw-scm-ledger-idempotent',
    roots: ['#2'],
    desc: '新线原料流水确定性幂等（SCM·根因#2·批K 引入·批S 修复两条独立正则拼出的假绑定：新增「_id 字段实际来自确定性生成函数调用」的绑定核验，不再只各自宽松匹配「有模板」+「有 _id 字样」）：rewrite/cloud/src/kit/scmStock.ts 写 stockLedger 必构造确定性 _id=`docType:docId:itemKey`（撞 id=并发方已写）·禁自动 id 双记账·禁绕开生成函数手写等价 _id',
    run() {
      const seam = 'rewrite/cloud/src/kit/scmStock.ts'
      // seam 缺失即红（批1 从被退役的旧副本移植回：守卫目标消失=显式退役，不静默绿）
      if (!existsSync(join(ROOT, seam))) return [`${seam} 缺失——生产线流水写入点（SCM 门1）·守卫目标消失须显式退役本守卫`]
      const bad = []
      const src = stripComments(readFileSync(join(ROOT, seam), 'utf8')) // 剥注释再匹配（E1/E10·批I 评审加固·stripComments 保长置空、下方索引数学不受影响）
      // 定位确定性 _id 生成函数并取其名（按「docType:docId:itemKey 三段模板」结构识别，不硬编码 ledgerIdOf——
      // 函数改名不失效；`const NAME = (…) => \`…\`` 或 `function NAME(…) {…}` 两种写法都认）
      const fnDeclM = src.match(/(?:const|function)\s+(\w+)\s*=?\s*\([^)]*\)\s*(?:=>\s*)?[{`][\s\S]{0,120}?\$\{[^}]*docType[^}]*\}:\$\{[^}]*docId[^}]*\}:\$\{/)
      if (!fnDeclM)
        bad.push(`${seam} 未见确定性流水 _id 构造函数（\`\${docType}:\${docId}:\${itemKey}\` 三段模板）——流水失幂等（根因#2）`)
      const fnName = fnDeclM ? fnDeclM[1] : null
      // 按 data 对象内是否含 itemKey: 字段识别真正的流水 add（不依赖变量名/字符距离——防 regex 假绿，见上注）
      const addRe = /\.add\(\s*\{\s*data:\s*\{([\s\S]{0,300}?)\}\s*\}\s*\)/g
      const adds = [...src.matchAll(addRe)].filter((m) => /itemKey\s*:/.test(m[1]))
      if (!adds.length) bad.push(`${seam} 未找到 stockLedger 流水 add({data:{itemKey:...}}) 调用——流水写入点代码形态已变、本守卫需同步（根因#2）`)
      // 粗粒度函数作用域边界：add 调用所在函数体起点＝其前最近一个 `function` 关键字位置——把「_id 绑定
      // 赋值」核验限定在同一函数内，不误配到别的函数里恰好同名的变量
      const funcBoundaryBefore = (index) => {
        const funcRe = /\bfunction\s+\w+/g
        let last = 0
        let fm
        while ((fm = funcRe.exec(src)) && fm.index < index) last = fm.index
        return last
      }
      for (const m of adds) {
        const inlineCall = fnName && new RegExp(`_id\\s*:\\s*${fnName}\\s*\\(`).test(m[1])
        if (inlineCall) continue // 内联直调确定性生成函数——绑定关系天然成立
        const shorthand = /(?:^|[,{])\s*_id\s*(?=[,}])/.test(m[1])
        const varMatch = m[1].match(/_id\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/)
        if (!shorthand && !varMatch) {
          bad.push(`${seam} stockLedger add 未带 _id 字段——自动 id=重放双记账（根因#2）`)
          continue
        }
        if (!fnName) continue // 上面已报「未见确定性 _id 构造函数」，此处不重复噪音
        const idVarName = shorthand ? '_id' : varMatch[1]
        const scoped = src.slice(funcBoundaryBefore(m.index), m.index)
        const boundRe = new RegExp(`(?:const|let)\\s+${idVarName}\\s*=\\s*${fnName}\\s*\\(`)
        if (!boundRe.test(scoped))
          bad.push(`${seam} stockLedger add 的 _id（变量 ${idVarName}）未见来自确定性生成函数 ${fnName}() 的同作用域赋值——_id 可能绕开确定性构造手写等价值，幂等绑定关系未真正成立（根因#2）`)
      }
      return bad
    },
  },
  {
    id: 'rw-mp-checkout-consts-synced',
    roots: ['#5'],
    desc: '结算常量镜像同步（根因#5·mp 包进不了 @ldrw/shared——开发者工具编译不出仓外引用，故 mp 落副本 + 本守卫焊死）：rewrite/mp/lib/checkoutConst.ts 的 COUPON/SHIP/CHECKOUT_ADDONS 必须与 rewrite/shared/src/checkout.ts 逐值一致',
    run() {
      const mpPath = join(ROOT, 'rewrite/mp/lib/checkoutConst.ts')
      const shPath = join(ROOT, 'rewrite/shared/src/checkout.ts')
      if (!existsSync(shPath)) return []
      if (!existsSync(mpPath)) return ['rewrite/mp/lib/checkoutConst.ts 缺失——结算常量副本未落（mp 无法引 @ldrw/shared·守卫需两份对账）']
      const bad = []
      const parse = (src) => {
        const num = (name) => {
          const m = src.match(new RegExp(`export const ${name} = ([0-9.]+)`))
          return m ? Number(m[1]) : NaN
        }
        const addons = [...src.matchAll(/\{ id: '([^']+)', name: '([^']+)', price: ([0-9.]+) \}/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}`)
        return { coupon: num('COUPON'), ship: num('SHIP'), addons: addons.join(';') }
      }
      const mp = parse(readFileSync(mpPath, 'utf8'))
      const sh = parse(readFileSync(shPath, 'utf8'))
      if (mp.coupon !== sh.coupon) bad.push(`结算常量漂移：COUPON mp=${mp.coupon} ≠ shared=${sh.coupon}（结算页展示价与云端定价不一致·下单必对不上账）`)
      if (mp.ship !== sh.ship) bad.push(`结算常量漂移：SHIP mp=${mp.ship} ≠ shared=${sh.ship}`)
      if (mp.addons !== sh.addons) bad.push('结算常量漂移：CHECKOUT_ADDONS mp 与 shared 不一致（搭配购展示与云端定价漂移）')
      return bad
    },
  },
  {
    id: 'rw-mp-order-labels-synced',
    roots: ['#5'],
    desc: '订单/售后状态标签码集合同步（根因#5·同 rw-mp-checkout-consts-synced 精神：mp 包进不了 @ldrw/shared，' +
      'mp 落客户向文案副本，本守卫只焊「状态码集合」不焊文案——admin/mp 措辞刻意不同是 UX 针对性、不是漂移，见 ' +
      'rewrite/shared/src/statusLabels.ts 头注）：rewrite/mp/lib/mapOrders.ts 的 STATUS_LABELS 与 ' +
      'rewrite/mp/lib/mapAftersales.ts 的 STATUS_LABELS 键集合必须分别与 shared ORDER_STATUS_LABEL_CUSTOMER / ' +
      'AFTERSALE_STATUS_LABEL_CUSTOMER 键集合一致——状态机新增状态若 mp 忘配标签，页面会悄悄显示原始状态码',
    run() {
      const shPath = join(ROOT, 'rewrite/shared/src/statusLabels.ts')
      const mpOrdersPath = join(ROOT, 'rewrite/mp/lib/mapOrders.ts')
      const mpAftersalesPath = join(ROOT, 'rewrite/mp/lib/mapAftersales.ts')
      if (!existsSync(shPath)) return []
      const bad = []
      const keysOf = (src, exportName) => {
        const m = src.match(new RegExp(`export const ${exportName}[^{]*{([^}]*)}`, 's'))
        if (!m) return null
        return [...m[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((x) => x[1]).sort()
      }
      const sh = readFileSync(shPath, 'utf8')
      const shOrderKeys = keysOf(sh, 'ORDER_STATUS_LABEL_CUSTOMER')
      const shAsKeys = keysOf(sh, 'AFTERSALE_STATUS_LABEL_CUSTOMER')
      if (existsSync(mpOrdersPath) && shOrderKeys) {
        const mpKeys = keysOf(readFileSync(mpOrdersPath, 'utf8'), 'STATUS_LABELS')
        if (mpKeys && mpKeys.join(',') !== shOrderKeys.join(','))
          bad.push(`订单状态标签码集合漂移：mp mapOrders.ts STATUS_LABELS=[${mpKeys.join(',')}] ≠ shared ORDER_STATUS_LABEL_CUSTOMER=[${shOrderKeys.join(',')}]（状态机新增/改名状态未同步到 mp）`)
      }
      if (existsSync(mpAftersalesPath) && shAsKeys) {
        const mpKeys = keysOf(readFileSync(mpAftersalesPath, 'utf8'), 'STATUS_LABELS')
        if (mpKeys && mpKeys.join(',') !== shAsKeys.join(','))
          bad.push(`售后状态标签码集合漂移：mp mapAftersales.ts STATUS_LABELS=[${mpKeys.join(',')}] ≠ shared AFTERSALE_STATUS_LABEL_CUSTOMER=[${shAsKeys.join(',')}]（状态机新增/改名状态未同步到 mp）`)
      }
      return bad
    },
  },
  {
    // 手抄常量补机器守卫（G6·根因#5：mp 进不了 @ldrw/shared，两处手抄常量此前无守卫——同族
    // checkoutConst/order-labels 都已有 rw-mp-*-synced，这两处是漏网）：
    // ① payFlow.ts PAID_BAD_STATUS 须与 shared order.ts buildBadStatus('paid') 输出逐字一致；
    //   admin Fulfill.vue 里另有第三处 'BAD_STATUS:' 前缀硬编码（mapShipErr），一并纳入核对面
    //   （admin/mp 分处不同前端、各自手抄同一个前缀，三处漂移任一处都会致「已发货判定」/「支付判定」误判）。
    // ② checkout.ts OUT_OF_STOCK_PREFIX 须与 shared errors.ts ERR.OUT_OF_STOCK 一致。
    id: 'rw-mp-payflow-consts-synced',
    roots: ['#5'],
    desc: '手抄常量三点核对面（根因#5·mp 进不了 @ldrw/shared，故手落副本）：① rewrite/mp/lib/payFlow.ts PAID_BAD_STATUS 与 rewrite/shared/src/order.ts buildBadStatus(\'paid\') 输出、及 rewrite/admin/src/pages/Fulfill.vue mapShipErr 里硬编码的 \'BAD_STATUS:\' 前缀三处一致；② rewrite/mp/lib/checkout.ts OUT_OF_STOCK_PREFIX 与 rewrite/shared/src/errors.ts ERR.OUT_OF_STOCK 一致——任一处漂移会致支付/发货/库存判定误判',
    run() {
      const bad = []
      const payFlowPath = join(ROOT, 'rewrite/mp/lib/payFlow.ts')
      const orderPath = join(ROOT, 'rewrite/shared/src/order.ts')
      const fulfillPath = join(ROOT, 'rewrite/admin/src/pages/Fulfill.vue')
      const checkoutPath = join(ROOT, 'rewrite/mp/lib/checkout.ts')
      const errorsPath = join(ROOT, 'rewrite/shared/src/errors.ts')
      if (!existsSync(orderPath) || !existsSync(errorsPath)) return [] // shared 未在（不适用场景）

      // ① BAD_STATUS 三点核对
      if (existsSync(payFlowPath)) {
        const payFlowSrc = readFileSync(payFlowPath, 'utf8')
        const orderSrc = readFileSync(orderPath, 'utf8')
        const mpM = payFlowSrc.match(/const PAID_BAD_STATUS = '([^']+)'/)
        const prefixM = orderSrc.match(/return '([^']+)' \+ status/)
        if (!mpM) bad.push('rewrite/mp/lib/payFlow.ts 未找到 PAID_BAD_STATUS 定义——手抄常量守卫需要它（G6）')
        else if (!prefixM) bad.push('rewrite/shared/src/order.ts buildBadStatus 实现形状变了——本守卫的取值正则找不到前缀字面量，先看是否漂移或需要更新守卫')
        else {
          const expected = prefixM[1] + 'paid'
          if (mpM[1] !== expected) bad.push(`手抄常量漂移：mp payFlow.ts PAID_BAD_STATUS='${mpM[1]}' ≠ shared buildBadStatus('paid')='${expected}'（并发已付幂等判定会失效）`)
          if (existsSync(fulfillPath)) {
            const fulfillSrc = readFileSync(fulfillPath, 'utf8')
            if (!fulfillSrc.includes(`'${prefixM[1]}'`)) bad.push(`手抄常量漂移：admin Fulfill.vue mapShipErr 未见与 shared 一致的 '${prefixM[1]}' 前缀字面量（发货态判定文案会对不上真实状态码）`)
          }
        }
      }

      // ② OUT_OF_STOCK 两点核对
      if (existsSync(checkoutPath)) {
        const checkoutSrc = readFileSync(checkoutPath, 'utf8')
        const errorsSrc = readFileSync(errorsPath, 'utf8')
        const mpM = checkoutSrc.match(/const OUT_OF_STOCK_PREFIX = '([^']+)'/)
        const shM = errorsSrc.match(/OUT_OF_STOCK:\s*'([^']+)'/)
        if (!mpM) bad.push('rewrite/mp/lib/checkout.ts 未找到 OUT_OF_STOCK_PREFIX 定义——手抄常量守卫需要它（G6）')
        else if (!shM) bad.push('rewrite/shared/src/errors.ts 未找到 ERR.OUT_OF_STOCK——手抄常量守卫需要它（G6）')
        else if (mpM[1] !== shM[1]) bad.push(`手抄常量漂移：mp checkout.ts OUT_OF_STOCK_PREFIX='${mpM[1]}' ≠ shared ERR.OUT_OF_STOCK='${shM[1]}'（结算页库存不足文案会失联）`)
      }
      return bad
    },
  },
  {
    id: 'rw-site-in-gates',
    roots: ['铁律'],
    desc: '内容站 SEO/GEO 基线在位（M4·GEO 基建=可爬可收录+AI 引擎可摘要的机器面）：astro.config 配 site 域名 + sitemap 集成；robots.txt 在且显式放行 AI 爬虫（GPTBot 等）；Base.astro 齐 og 三件+og:image/og:locale/twitter:card+WebSite 结构化卡；llms.txt 与 rss.xml 端点在；404 页 noindex；favicon.svg 与 og-cover.png 分享素材在；根 typecheck 覆盖 rewrite/site；教程 frontmatter 带 reviewed 标记（AI 起草未审稿不冒充定稿——写真机器可核）',
    run() {
      const base = join(ROOT, 'rewrite/site')
      if (!existsSync(base)) return []
      const bad = []
      const cfg = join(base, 'astro.config.mjs')
      if (!existsSync(cfg)) bad.push('rewrite/site/astro.config.mjs 缺失')
      else {
        const c = readFileSync(cfg, 'utf8')
        if (!/site:\s*'https:\/\/www\.luckyducky\.cn'/.test(c)) bad.push('astro.config 未配 site 域名——sitemap/canonical 出不了绝对地址（收录基建缺）')
        if (!/sitemap\(\)/.test(c)) bad.push('astro.config 未挂 sitemap 集成——搜索引擎无地图可爬')
      }
      const robotsPath = join(base, 'public/robots.txt')
      if (!existsSync(robotsPath)) bad.push('public/robots.txt 缺失——爬虫策略未声明')
      else if (!/GPTBot/.test(readFileSync(robotsPath, 'utf8')))
        bad.push('robots.txt 未显式放行 AI 引擎爬虫（GPTBot 等）——GEO 语料源定位要求对 AI 爬虫态度显式声明，不靠通配默许')
      const layout = join(base, 'src/layouts/Base.astro')
      if (existsSync(layout)) {
        const l = readFileSync(layout, 'utf8')
        for (const og of ['og:title', 'og:description', 'og:url', 'og:image', 'og:locale', 'twitter:card']) {
          if (!l.includes(og)) bad.push(`Base.astro 缺 ${og}——社交分享/引擎摘要卡不全（GEO 面）`)
        }
        if (!/websiteSchema/.test(l)) bad.push('Base.astro 未注入 WebSite 结构化卡（websiteSchema）——站点实体锚点缺失（GEO 面）')
      }
      // GEO 双端点：llms.txt（AI 引擎抓取入口·教程清单随内容集合同步）+ rss.xml（内容分发/收录信号）——
      // 都做成 Astro 端点而非静态文件，防新增教程后清单 stale。
      if (!existsSync(join(base, 'src/pages/llms.txt.ts'))) bad.push('src/pages/llms.txt.ts 缺失——GEO llms.txt 端点未建（AI 引擎抓取入口）')
      if (!existsSync(join(base, 'src/pages/rss.xml.ts'))) bad.push('src/pages/rss.xml.ts 缺失——RSS 端点未建（内容分发/收录信号）')
      const nf = join(base, 'src/pages/404.astro')
      if (existsSync(nf) && !/noindex/.test(readFileSync(nf, 'utf8'))) bad.push('404.astro 未标 noindex——错误页进索引稀释收录质量')
      if (!existsSync(join(base, 'public/favicon.svg'))) bad.push('public/favicon.svg 缺失——浏览器标签/收录结果无品牌图标')
      if (!existsSync(join(base, 'public/og-cover.png'))) bad.push('public/og-cover.png 缺失——og:image 指向不存在的分享图（分享卡开天窗）')
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      if (!/rewrite\/site/.test((pkg.scripts && pkg.scripts.typecheck) || ''))
        bad.push('package.json scripts.typecheck 未覆盖 rewrite/site——站点 TS（schema.ts 等 GEO 承重层）类型不过闸')
      const contentDir = join(base, 'src/content/tutorials')
      if (existsSync(contentDir)) {
        for (const f of readdirSync(contentDir)) {
          if (!f.endsWith('.md')) continue
          const src = readFileSync(join(contentDir, f), 'utf8')
          if (!/^reviewed:\s*(true|false)\s*$/m.test(src)) bad.push(`教程 ${f} frontmatter 缺 reviewed 标记——AI 起草稿与定稿无法区分（写真纪律）`)
        }
      }
      return bad
    },
  },
  {
    id: 'rw-agent-in-gates',
    roots: ['铁律'],
    desc: '新坐席台包必须被三道闸扫到（M3 批8·坐席台=在用人工客服唯一通道·零断档红线）：root typecheck 覆盖 rewrite/agent；轮询合并纯函数有行为测试；package.json 有 build 脚本',
    run() {
      const base = join(ROOT, 'rewrite/agent')
      if (!existsSync(base)) return []
      const bad = []
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      if (!/rewrite\/agent/.test(pkg.scripts?.typecheck || '')) bad.push('package.json scripts.typecheck 未覆盖 rewrite/agent——新坐席台类型不过闸')
      if (!existsSync(join(base, 'tests/desk.test.ts'))) bad.push('rewrite/agent/tests/desk.test.ts 缺失——轮询合并（不重气泡/游标只进不退）无行为测试')
      const apkg = join(base, 'package.json')
      if (!existsSync(apkg) || !JSON.parse(readFileSync(apkg, 'utf8')).scripts?.build) bad.push('rewrite/agent 缺 build 脚本——产物形态不在')
      return bad
    },
  },
  {
    id: 'rw-admin-ui-in-gates',
    roots: ['铁律'],
    desc: '新后台包必须被三道闸扫到（M3 批1）：root typecheck 覆盖 rewrite/admin；api 客户端有行为测试在位（会话/规整属钱链入口）；package.json 有 build 脚本（vite 产物形态在）',
    run() {
      const base = join(ROOT, 'rewrite/admin')
      if (!existsSync(base)) return []
      const bad = []
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      if (!/rewrite\/admin/.test(pkg.scripts?.typecheck || '')) bad.push('package.json scripts.typecheck 未覆盖 rewrite/admin——新后台类型不过闸')
      if (!existsSync(join(base, 'tests/client.test.ts'))) bad.push('rewrite/admin/tests/client.test.ts 缺失——api 客户端无行为测试（会话/错误规整是钱链入口）')
      const apkg = join(base, 'package.json')
      if (!existsSync(apkg) || !JSON.parse(readFileSync(apkg, 'utf8')).scripts?.build) bad.push('rewrite/admin 缺 build 脚本——产物形态不在')
      return bad
    },
  },
  {
    id: 'rw-mp-line-in-gates',
    roots: ['铁律'],
    desc: '新线小程序包必须被三道闸扫到（M2 批1·ADR §24 测试一等公民）：root typecheck 覆盖 rewrite/mp；app.json 每个注册页面四件套（.wxml/.ts/.json/.wxss）齐全（缺件=真机白屏或工具报错·构建过≠真机能用的结构半边）；tabBar.custom 时 custom-tab-bar 组件四件套在位',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      if (!/rewrite\/mp/.test(pkg.scripts?.typecheck || '')) bad.push('package.json scripts.typecheck 未覆盖 rewrite/mp——新线小程序类型不过闸')
      const appJsonPath = join(base, 'app.json')
      if (!existsSync(appJsonPath)) return [...bad, 'rewrite/mp/app.json 缺失']
      const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'))
      const units = (appJson.pages || []).map((p) => join(base, p))
      if (appJson.tabBar?.custom) units.push(join(base, 'custom-tab-bar/index'))
      for (const u of units) {
        for (const ext of ['.wxml', '.ts', '.json', '.wxss']) {
          if (!existsSync(u + ext)) bad.push(`rewrite/mp：${relative(base, u)}${ext} 缺失——注册了页面/组件但文件不全（真机白屏面）`)
        }
      }
      return bad
    },
  },
  {
    id: 'rw-openapi-perm-declared',
    roots: ['#12', '#8'],
    desc: '新线云调用权限随产物声明（移植 openapi-perm-declared·根因#12/#8·债#26）：rewrite/cloud 源每个 cloud.openapi.<ns>.<method> 调用须在 rewrite/cloud/build.mjs OPENAPI_PERMS 登记（据此产 config.json）——否则部署产物缺权限、云调用被微信拒',
    run() {
      const bad = []
      const srcRoot = join(ROOT, 'rewrite/cloud/src')
      if (!existsSync(srcRoot)) return bad
      const calls = new Set()
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.ts'))
            for (const m of readFileSync(p, 'utf8').matchAll(/\.openapi\.(\w+)\.(\w+)/g)) calls.add(`${m[1]}.${m[2]}`)
        }
      }
      walk(srcRoot)
      const buildMjs = join(ROOT, 'rewrite/cloud/build.mjs')
      if (!existsSync(buildMjs)) return ['rewrite/cloud/build.mjs 缺失——新线云函数无部署产物形态（M1 收口·根因#12）']
      const build = readFileSync(buildMjs, 'utf8')
      if (!/OPENAPI_PERMS/.test(build) || !/config\.json/.test(build))
        bad.push('rewrite/cloud/build.mjs 未见 OPENAPI_PERMS 登记或 config.json 产出——产物不带 openapi 权限声明（根因#12·债#26）')
      for (const c of calls)
        if (!build.includes(`'${c}'`) && !build.includes(`"${c}"`))
          bad.push(`新线云调用 cloud.openapi.${c} 未在 rewrite/cloud/build.mjs OPENAPI_PERMS 登记——产物 config.json 缺权限「${c}」（根因#12）`)
      return bad
    },
  },
  {
    id: 'rw-interface-catalog-sync',
    roots: ['正册'],
    desc: '新线接口正册同步（移植 interface-catalog-sync）：rewrite 每个云函数（export const main 单元）+ app action + adminApi action 须登记 docs/系统事实.md「重写线」节内（按节内文本核·不借旧线登记假绿）——杜绝「加接口忘登记」',
    run() {
      const base = join(ROOT, 'rewrite/cloud/src/functions')
      if (!existsSync(base)) return []
      const catPath = join(ROOT, 'docs/系统事实.md')
      if (!existsSync(catPath)) return ['docs/系统事实.md 缺失（接口权威登记册）']
      const cat = readFileSync(catPath, 'utf8')
      const sec = cat.split(/^## .*重写线.*$/m)[1]
      if (!sec) return ['docs/系统事实.md 缺「重写线」正册节——新线函数/action 无登记处（正册 P1）']
      const section = sec.split(/^## /m)[0]
      const has = (name) => section.includes('`' + name + '`')
      const bad = []
      // 云函数单元：顶层 dir 含 index.ts（且有 main）＝一函数；组目录下逐文件/子目录含 main 者＝一函数
      const isFn = (p) => readFileSync(p, 'utf8').includes('export const main')
      for (const e of readdirSync(base)) {
        const p = join(base, e)
        if (!statSync(p).isDirectory()) continue
        const idx = join(p, 'index.ts')
        if (existsSync(idx) && isFn(idx)) {
          if (!has(e)) bad.push(`新线云函数 ${e} 未登记 系统事实「重写线」节（正册 P1）`)
          continue
        }
        for (const c of readdirSync(p)) {
          const cp = join(p, c)
          let name = null
          if (statSync(cp).isDirectory()) {
            const ci = join(cp, 'index.ts')
            if (existsSync(ci) && isFn(ci)) name = c
          } else if (c.endsWith('.ts') && isFn(cp)) name = c.slice(0, -3)
          if (name && !has(name)) bad.push(`新线云函数 ${name} 未登记 系统事实「重写线」节（正册 P1）`)
        }
      }
      // app / adminApi action 查表键
      for (const [idxRel, extra] of [
        ['rewrite/cloud/src/functions/app/index.ts', []],
        ['rewrite/cloud/src/functions/adminApi/index.ts', ['ping', 'login', 'loginByWecomCode']],
      ]) {
        const ip = join(ROOT, idxRel)
        if (!existsSync(ip)) continue
        const m = readFileSync(ip, 'utf8').match(/const ACTIONS[^{]*\{([\s\S]*?)\n\}/)
        const keys = m ? [...m[1].matchAll(/^\s{2}(\w+)[:,]/gm)].map((x) => x[1]) : []
        for (const a of [...keys, ...extra])
          if (!has(a)) bad.push(`新线 action ${a} 未登记 系统事实「重写线」节（正册 P1）`)
      }
      return bad
    },
  },
  {
    // 页面内容 CMS 白名单净化（批A·5 页可编辑内容云读写链）——信任边界 fail-closed（根因#3 不信前端）：
    // adminApi 写侧每页独立净化 + 未知 page 拒；app 读侧同白名单 fail-closed。承 saveHomeContent/getContent 样板。
    // 函数体断言走 setupFnBody（顶层 export async function·非对象方法·methodBody 收尾启发式不适配）+ stripComments
    // 单源 helper（错题本 E1/E10：取真源须对剥注释后函数体匹配，防注释文本假触发/假放行）。
    id: 'rw-cloud-page-content-sanitized',
    roots: ['#3'],
    desc: '页面内容 CMS 白名单净化（批A·信任边界 fail-closed·根因#3 不信前端）：① adminApi actions/content.ts 有 savePageContent，其函数体（剥注释后·setupFnBody 单源 helper）经 PAGES 白名单 gate 未知 page → fail-closed（UNKNOWN_PAGE），且 5 页各有独立净化函数（sanitizeWelcome/sanitizeCatalogPlayer/sanitizeMePage/sanitizeAbout/sanitizeAgreementDoc 均须定义）；getPageContent 同 fail-closed ② app actions/catalog.ts getPageContent 有同 5 键白名单且未知 page fail-closed（BAD_ARGS）。反向自检：删 content.ts PAGES 任一键 / 删 catalog.ts 白名单键 / 抹 UNKNOWN_PAGE 拒 → 本守卫红',
    run() {
      const bad = []
      const PAGES = ['welcome', 'catalogPlayer', 'mePage', 'about', 'agreement']
      const adminPath = join(ROOT, 'rewrite/cloud/src/functions/adminApi/actions/content.ts')
      const appPath = join(ROOT, 'rewrite/cloud/src/functions/app/actions/catalog.ts')
      if (!existsSync(adminPath)) {
        bad.push('rewrite/cloud/src/functions/adminApi/actions/content.ts 缺失——页面内容 CMS 写侧无处（正册 P1）')
        return bad
      }
      const adminSrc = stripComments(readFileSync(adminPath, 'utf8')) // 剥注释单源 helper（错题本 E1/E10）：防注释假触发
      // ① 5 页独立净化函数须定义（每页白名单一函数·根因#3）
      for (const s of ['sanitizeWelcome', 'sanitizeCatalogPlayer', 'sanitizeMePage', 'sanitizeAbout', 'sanitizeAgreementDoc'])
        if (!new RegExp(`function\\s+${s}\\b`).test(adminSrc))
          bad.push(`content.ts 缺每页净化函数 ${s}——未净化即入库（根因#3 不信前端）`)
      // ② PAGES 白名单数组字面量含全部 5 键（对 const PAGES = [...] 内断言·不全文匹配·防 welcome 等键与无关字符串串味假绿）
      const pagesLit = (adminSrc.match(/const PAGES\s*=\s*\[([^\]]*)\]/) || [])[1] || ''
      if (!pagesLit) bad.push('content.ts 找不到 const PAGES 白名单数组——未知 page 无处 fail-closed（根因#3）')
      for (const p of PAGES)
        if (!new RegExp(`['"]${p}['"]`).test(pagesLit)) bad.push(`content.ts PAGES 白名单缺键「${p}」——该页无法保存或漏净化`)
      // ③ savePageContent 函数体经 PAGES gate + UNKNOWN_PAGE fail-closed
      const saveBody = setupFnBody(adminSrc, 'savePageContent')
      if (!saveBody) bad.push('content.ts 找不到 savePageContent 函数体——CMS 写侧缺失')
      else {
        if (!/PAGES\b/.test(saveBody)) bad.push('savePageContent 未经 PAGES 白名单 gate——未知 page 会被放行（信任边界·根因#3）')
        if (!/UNKNOWN_PAGE/.test(saveBody)) bad.push('savePageContent 缺 UNKNOWN_PAGE fail-closed 拒——未知 page 未 fail-closed（根因#3）')
      }
      const getBody = setupFnBody(adminSrc, 'getPageContent')
      if (!getBody) bad.push('content.ts 找不到 getPageContent 函数体——CMS 读回侧缺失')
      else if (!/UNKNOWN_PAGE/.test(getBody))
        bad.push('content.ts getPageContent 缺 UNKNOWN_PAGE fail-closed 拒未知 page（根因#3）')
      // ④ app 公开读侧同白名单 fail-closed（catalog.ts getPageContent）
      if (!existsSync(appPath)) {
        bad.push('rewrite/cloud/src/functions/app/actions/catalog.ts 缺失——公开读侧无处')
        return bad
      }
      const appSrc = stripComments(readFileSync(appPath, 'utf8'))
      if (!/getPageContent/.test(appSrc)) bad.push('app/catalog.ts 缺 getPageContent——公开读链未接（批A）')
      const appPagesLit = (appSrc.match(/const PAGE_KEYS\s*=\s*\[([^\]]*)\]/) || [])[1] || ''
      if (!appPagesLit) bad.push('app/catalog.ts 找不到 const PAGE_KEYS 白名单数组——公开读侧未知 page 无处 fail-closed（根因#3）')
      for (const p of PAGES)
        if (!new RegExp(`['"]${p}['"]`).test(appPagesLit))
          bad.push(`app/catalog.ts 白名单缺键「${p}」——公开读侧 fail-closed 白名单不全（根因#3）`)
      if (!/BAD_ARGS|UNKNOWN_PAGE/.test(appSrc)) bad.push('app/catalog.ts getPageContent 未 fail-closed 拒未知 page（根因#3）')
      return bad
    },
  },
  {
    // 五页 CMS 内容映射接线（批B·mp 五页文案 CMS 优先·硬编码降级为默认回退·守卫先红后绿）：把「硬编码文案
    // 变 mapper 默认值、CMS 拉不到/字段空→默认」这条不变量焊死——① golden 测试覆盖五 mapper 整档 null→默认
    // 回退（防误清空/空屏·黄金 §九 mp 侧）；② 五页面 ts 经 lib/mapPages 映射层 + lib/pageContent 会话缓存层
    // 取内容（不各自散拉、不绕 mapper 直写硬编码）。取内容方法体断言走 methodBody + stripComments 单源 helper
    // （错题本 E1/E10：对剥注释后的函数体匹配，防注释文本假触发/假放行）。roots 照 rw-mp-home-golden（#8 展示面
    // fail-soft·「构建过≠真机不空屏」那半边）。反向自检：删 golden 用例 / 某页绕过 mapper 直写文案 / 删缓存层
    // import → 本守卫红。
    id: 'rw-mp-page-content-golden',
    roots: ['#8'],
    desc: '五页 CMS 内容映射接线（rewrite/mp·批B·根因#8 展示面 fail-soft）：① golden 测试 rewrite/mp/tests/pages-map.test.ts 存在且覆盖五 mapper（mapWelcome/mapCatalogPlayer/mapMe/mapAbout/mapAgreement）整档 null→默认回退 ② 五页面（welcome/catalog/player/me/about/agreement）各经 lib/pageContent 缓存层 getPageContent + lib/mapPages 映射层取内容——对剥注释后的取内容方法体断言（methodBody+stripComments 单源 helper·E1/E10），防绕过 mapper 直写硬编码/删缓存层/删 golden 用例',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const MAPPERS = ['mapWelcome', 'mapCatalogPlayer', 'mapMe', 'mapAbout', 'mapAgreement']
      // ① golden 测试存在且覆盖五 mapper 整档 null→默认回退
      const testRel = 'rewrite/mp/tests/pages-map.test.ts'
      const testAbs = join(ROOT, testRel)
      if (!existsSync(testAbs)) {
        bad.push(`${testRel} 缺失——五 mapper 默认回退无 golden 钉行为（批B·根因#8）`)
      } else {
        const testSrc = readFileSync(testAbs, 'utf8')
        for (const m of MAPPERS) {
          if (!testSrc.includes(m)) bad.push(`${testRel} 未覆盖 ${m}——五 mapper 黄金不全（批B）`)
          if (!new RegExp(`${m}\\s*\\(\\s*null\\s*\\)`).test(testSrc))
            bad.push(`${testRel} 缺 ${m}(null) 整档回退用例——默认回退未钉（黄金 §九·防空屏）`)
        }
      }
      // ② 五页面经 mapPages 映射层 + pageContent 缓存层取内容（对剥注释函数体断言·E1/E10）
      const WIRES = [
        { file: 'pages/welcome/welcome.ts', method: 'loadPageContent', mapper: 'mapWelcome' },
        { file: 'pages/catalog/catalog.ts', method: 'loadPageContent', mapper: 'mapCatalogPlayer' },
        { file: 'pages/player/player.ts', method: 'loadPageContent', mapper: 'mapCatalogPlayer' },
        // me 直引拆分模块 lib/mapMe（非 mapPages）：tab 首屏页闭包不拖协议/隐私法务长文进字体 tier1
        // 子集（字体分层批·守卫 rw-mp-font-tier-subset-covers 盯闭包⊆子集），mapper 行为黄金不变。
        { file: 'pages/me/me.ts', method: 'refresh', mapper: 'mapMe', module: 'lib/mapMe' },
        { file: 'pages/about/about.ts', method: 'loadPageContent', mapper: 'mapAbout' },
        { file: 'pages/agreement/agreement.ts', method: 'loadPageContent', mapper: 'mapAgreement' },
      ]
      for (const w of WIRES) {
        const abs = join(base, w.file)
        if (!existsSync(abs)) {
          bad.push(`rewrite/mp/${w.file} 缺失——CMS 内容接线点位丢失（批B）`)
          continue
        }
        const src = stripComments(readFileSync(abs, 'utf8')) // 剥注释单源 helper（错题本 E1/E10）：防注释假触发/假放行
        const mapperModule = w.module || 'lib/mapPages'
        if (!new RegExp(`from\\s*['"][^'"]*${mapperModule}['"]`).test(src))
          bad.push(`rewrite/mp/${w.file} 未从 ${mapperModule} 引入映射层——文案未经 mapper 回退（批B·根因#8）`)
        if (!/from\s*['"][^'"]*lib\/pageContent['"]/.test(src))
          bad.push(`rewrite/mp/${w.file} 未从 lib/pageContent 引入会话缓存层——CMS 内容各自散拉（病根#15 精神·批B）`)
        const body = methodBody(src, w.method)
        if (!body) {
          bad.push(`rewrite/mp/${w.file} 找不到取内容方法 ${w.method}——CMS 接线缺失（批B）`)
          continue
        }
        if (!new RegExp(`${w.mapper}\\s*\\(`).test(body))
          bad.push(`rewrite/mp/${w.file} 方法 ${w.method} 未调用 ${w.mapper}(——绕过 mapper 直写硬编码（批B·根因#8 展示面 fail-soft）`)
        if (!/getPageContent\s*\(/.test(body))
          bad.push(`rewrite/mp/${w.file} 方法 ${w.method} 未经 getPageContent 缓存层取内容（批B·单源收口）`)
      }
      return bad
    },
  },
  {
    // 新线镜像 privacy-authorize-wired（R27㉒）+ consent 页（cs-data-share-consented 的 C 端半边）。
    // 原生形态：app.json __usePrivacyCheck__ + lib/privacyGate 挂 onNeedPrivacyAuthorization + app.ts 启动注册
    // + privacy-sheet 组件（agreePrivacyAuthorization 能力按钮）；涉隐私接口页扫描制——哪页调隐私接口哪页必挂
    // 弹窗（挂载可达性·债#25 教训：闸全局触发、弹窗挂不到就渲不出=授权链静默断）。consent 页写 dataConsent
    // （服务端为真值·本地只提示），me 页有入口（可达性）。
    id: 'rw-mp-privacy-gated',
    roots: ['R27'],
    desc: '新线隐私授权+数据共享同意已接（R27㉒·M5 前置闸1）：app.json __usePrivacyCheck__ + privacyGate 挂 onNeedPrivacyAuthorization + app.ts 注册 + privacy-sheet 组件（agreePrivacyAuthorization）+ 涉隐私接口页必挂弹窗（扫描制）+ consent 页写 dataConsent + me 入口',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      const rd = (rel) => (existsSync(join(base, rel)) ? readFileSync(join(base, rel), 'utf8') : null)
      const appJson = rd('app.json')
      if (appJson && !/"__usePrivacyCheck__"\s*:\s*true/.test(appJson))
        bad.push('rewrite/mp/app.json 缺 __usePrivacyCheck__:true——工具端不模拟隐私拦截·真机才炸（根因#8）')
      const gate = rd('lib/privacyGate.ts')
      if (!gate) bad.push('rewrite/mp/lib/privacyGate.ts 缺失——隐私授权闸未建（R27㉒）')
      else if (!gate.includes('onNeedPrivacyAuthorization'))
        bad.push('lib/privacyGate.ts 未挂 onNeedPrivacyAuthorization——隐私接口触发无人接')
      const appTs = rd('app.ts')
      // 核「调用」registerPrivacyGate() 而非名字出现（只剩 import 没调用=假绿·反向自检逼出）
      if (appTs && !appTs.includes('registerPrivacyGate()'))
        bad.push('rewrite/mp/app.ts 未调用 registerPrivacyGate()——闸建了没通电（App 启动须挂）')
      const sheet = rd('components/privacy-sheet/privacy-sheet.wxml')
      if (!sheet) bad.push('rewrite/mp/components/privacy-sheet/ 缺失——隐私授权弹窗未建')
      else {
        if (!sheet.includes('agreePrivacyAuthorization'))
          bad.push('privacy-sheet.wxml 缺 open-type=agreePrivacyAuthorization 能力按钮——同意点不生效')
        if (!sheet.includes('privacy-agree-btn')) bad.push('privacy-sheet.wxml 缺 privacy-agree-btn 按钮 id——resolve buttonId 对不上')
      }
      // 涉隐私接口页扫描：哪页调隐私接口，哪页 wxml 必挂 <privacy-sheet/>（+ json 注册组件）
      const PRIV = /open-type="chooseAvatar"|type="nickname"|wx\.(chooseImage|chooseMedia|getUserProfile|getClipboardData|getLocation|saveImageToPhotosAlbum)\b/
      const pagesDir = join(base, 'pages')
      if (existsSync(pagesDir))
        for (const p of readdirSync(pagesDir)) {
          const wxml = rd(`pages/${p}/${p}.wxml`)
          const ts = rd(`pages/${p}/${p}.ts`)
          if (!PRIV.test((wxml || '') + (ts || ''))) continue
          if (!wxml || !wxml.includes('<privacy-sheet'))
            bad.push(`pages/${p} 调涉隐私接口但 wxml 未挂 <privacy-sheet/>——闸触发弹窗渲不出·授权链静默断（债#25）`)
          const pj = rd(`pages/${p}/${p}.json`)
          if (!pj || !pj.includes('privacy-sheet')) bad.push(`pages/${p}/${p}.json 未注册 privacy-sheet 组件`)
        }
      // consent 页：注册 + 写 dataConsent（服务端真值）+ me 入口可达
      if (appJson && !appJson.includes('pages/consent/consent'))
        bad.push('app.json 未注册 pages/consent/consent——数据共享授权页缺位（隐私政策已承诺可撤回·M5 前置闸1）')
      const consentTs = rd('pages/consent/consent.ts')
      if (!consentTs) bad.push('rewrite/mp/pages/consent/consent.ts 缺失')
      else if (!consentTs.includes('dataConsent')) bad.push('consent 页未调 dataConsent——同意/撤回没写到服务端真值')
      const me = rd('pages/me/me.ts')
      if (me && consentTs && !me.includes('consent')) bad.push('me 页无 consent 入口——授权管理页不可达')
      return bad
    },
  },
  {
    // 帮助视频线不得走 VOD（根因#8「构建过≠真能用」+ #14 静默失败·决策§31 批2 自纠）：admin 的
    // uploadVideo 是**课程视频与帮助视频共用**的函数，批2 让它「VOD 配了就走 VOD」时漏了调用面——
    // 帮助视频播放侧 getHelpVideos 只认云存储 fileID（getTempUrls 批量换址·无 vodUrl 字段、无转码
    // 同步、无发布闸兜底），传进 VOD 拿纯数字 FileId 会换不到地址 → url:null → 求助面板视频全哑且
    // 无任何告警。机器闸与测试对此全绿（跨线影响静态测不出），故焊此结构守卫：走 VOD 必须显式
    // opt-in（allowVod），默认走云存储老路（fail-safe：新调用方默认安全）。
    id: 'rw-admin-help-video-stays-cos',
    roots: ['#8', '#14'],
    desc: 'admin 帮助视频线恒走云存储（决策§31 批2 自纠）：api/content.ts 的 uploadVideo 走 VOD 分支须受显式 allowVod 控制；Courses.vue（课程线）两处调用须传 allowVod、HelpVideos.vue（帮助线·播放侧只认云存储 fileID）不得传——共用函数无条件走 VOD 会让求助面板视频静默全哑',
    run() {
      const bad = []
      const strip = (p) => {
        const abs = join(ROOT, p)
        if (!existsSync(abs)) return null
        return stripComments(readFileSync(abs, 'utf8')).replace(/<!--[\s\S]*?-->/g, '')
      }
      const apiRel = 'rewrite/admin/src/api/content.ts'
      const api = strip(apiRel)
      if (!api) return [] // admin 未建时不红
      // 显式 span 切（不用 setupFnBody）：uploadVideo 的参数含回调 `(p: number) => void`，
      // 该 helper 的 `\([^)]*\)` 参数正则会在回调的右括号处断掉、匹配不到签名（本批实测）。
      // 带左括号定位（同文件另有 `uploadVideoVod`·裸前缀 indexOf 会先命中它、切错 span 假红）
      const start = api.indexOf('function uploadVideo(')
      const rest = start >= 0 ? api.slice(start) : ''
      const nextExport = rest.indexOf('\nexport ', 1)
      const body = nextExport > 0 ? rest.slice(0, nextExport) : rest
      if (!body) bad.push(`${apiRel} 找不到 uploadVideo——视频直传单点丢失`)
      else if (!body.includes('allowVod'))
        bad.push(`${apiRel} uploadVideo 走 VOD 未受显式 allowVod 控制——帮助视频线会被一并传进 VOD、播放侧换不到地址静默全哑（根因#8/#14·决策§31 批2 自纠）`)
      const help = strip('rewrite/admin/src/pages/HelpVideos.vue')
      if (help && help.includes('allowVod'))
        bad.push(`rewrite/admin/src/pages/HelpVideos.vue 出现 allowVod——帮助视频播放侧 getHelpVideos 只认云存储 fileID，走 VOD 即静默全哑（决策§31：帮助视频线恒不迁）`)
      const courses = strip('rewrite/admin/src/pages/Courses.vue')
      if (courses && !courses.includes('allowVod'))
        bad.push(`rewrite/admin/src/pages/Courses.vue 未传 allowVod——课程视频线会静默退回云存储老路（转码管线形同未接·决策§31 批2）`)
      return bad
    },
  },
  {
    // VOD 平台接缝单点（根因#12·决策§31 转码管线批1·镜像 flow-seam-via-kit 之于支付工作流）：与腾讯云
    // 点播的平台触点（Key 防盗链签名算法/服务端 API 域名）收口 kit/vod.ts 一处，平台规则单方变化只改
    // 这一点。同时焊死 getPlaybackUrl 新旧双线前缀分流：VOD FileId（纯数字）走 signVodPlayUrl 防盗链
    // 签名、cloud:// 老线走 getTempUrl 临时地址、转码未就绪走 vodUrl 判空——分流拆掉任意一半，存量
    // 课程或新转码课程之一必哑。
    id: 'rw-vod-seam-single',
    roots: ['#12'],
    desc: 'VOD 平台接缝单点（决策§31 批1）：kit/vod.ts 必须存在且为 rewrite/cloud/src 内唯一含 tencentcloudapi.com 字面量的文件；learning.ts getPlaybackUrl 段须含 isVodFileId + signVodPlayUrl + getTempUrl + vodUrl 四件套前缀分流——接缝散写/分流缺失即红',
    run() {
      const bad = []
      const kitRel = 'rewrite/cloud/src/kit/vod.ts'
      if (!existsSync(join(ROOT, kitRel)))
        return [`${kitRel} 不存在——VOD 平台接缝单点未建（根因#12·决策§31 转码管线批1）`]
      const walk = (d) => {
        const out = []
        for (const e of lsScan(join(ROOT, d))) {
          const rel = `${d}/${e}`
          if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel))
          else if (rel.endsWith('.ts')) out.push(rel)
        }
        return out
      }
      for (const rel of walk('rewrite/cloud/src')) {
        if (rel === kitRel) continue
        if (stripComments(readFileSync(join(ROOT, rel), 'utf8')).includes('tencentcloudapi.com'))
          bad.push(`${rel} 含腾讯云 API 域名字面量——VOD 平台触点必须收口 kit/vod.ts 单点（根因#12）`)
      }
      const lrel = 'rewrite/cloud/src/functions/app/actions/learning.ts'
      const lsrc = stripComments(readFileSync(join(ROOT, lrel), 'utf8'))
      const start = lsrc.indexOf('export const getPlaybackUrl')
      const end = lsrc.indexOf('export const', start + 1)
      const span = start >= 0 ? lsrc.slice(start, end > start ? end : undefined) : ''
      if (!span) bad.push(`${lrel} 找不到 getPlaybackUrl——播放地址签发单点丢失`)
      else
        for (const token of ['isVodFileId', 'signVodPlayUrl', 'getTempUrl', 'vodUrl'])
          if (!span.includes(token))
            bad.push(
              `${lrel} getPlaybackUrl 缺 ${token}——VOD/云存储双线前缀分流不完整（决策§31 批1：拆掉一半，存量或转码课程之一必哑）`
            )
      return bad
    },
  },
  {
    // 防盗链签名 fail-closed（病根#1 信任边界 + #14 失败可观测·决策§31 批1）：playKey 未配置时
    // signVodPlayUrl 必须告警（VOD_KEY_MISSING·配置洞可发现）并返回 null——绝不裸发未签名地址
    // （防盗链已开=裸地址必 403 坏体验；未开=付费内容裸奔，两头都不许发）。行为端由 rw-learning-golden
    // 测试实证（无 key → url:null + 告警行），本守卫焊死代码形状防「先发裸地址试试」的回潮。
    id: 'rw-vod-sign-fail-closed',
    roots: ['#1', '#14'],
    desc: 'VOD 防盗链签名 fail-closed（决策§31 批1）：kit/vod.ts signVodPlayUrl 须含 playKey 判空→alert(VOD_KEY_MISSING)→null 的 fail-closed 分支，且不得出现裸 return rawUrl（未签名地址下发即红）',
    run() {
      const rel = 'rewrite/cloud/src/kit/vod.ts'
      if (!existsSync(join(ROOT, rel))) return [] // 未建时由 rw-vod-seam-single 负责红——不重复报
      const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'))
      const body = setupFnBody(src, 'signVodPlayUrl')
      if (!body) return [`${rel} 找不到 signVodPlayUrl——防盗链签名单点丢失（决策§31 批1）`]
      const bad = []
      if (!body.includes('VOD_KEY_MISSING') || !body.includes('alert('))
        bad.push(`${rel} signVodPlayUrl 缺 playKey fail-closed 告警（VOD_KEY_MISSING）——密钥未配置将静默不可发现（病根#14）`)
      if (/return\s+rawUrl/.test(body))
        bad.push(`${rel} signVodPlayUrl 出现裸 return rawUrl——未签名地址下发（病根#1 fail-closed：宁可 null 不裸奔）`)
      return bad
    },
  },
  {
    // 重写线播放页切段取址防乱序覆盖（根因#8·把老线 player-playurl-stale-guarded 的不变量迁到活跃 rewrite 线）：
    // playSegment 可重入（快速连点下一段/点目录），await 取址后若不复核请求令牌就写 src，慢回的旧段地址会覆盖新段
    // ——视频播旧段但目录高亮/上下段按新段算，且下次 onEnded 跳错段、不自愈。守此不变量：playSegment await 后必复核 playToken。
    id: 'rw-mp-player-stale-guarded',
    roots: ['#8'],
    desc: '重写线播放页切段取址防乱序覆盖（根因#8·同老线 player-playurl-stale-guarded 迁到 rewrite）：pages/player/player.ts 的 playSegment 在 await 取址后须复核请求令牌 playToken 未变才 setData——防快速切段慢回的旧段地址覆盖新段播错段且不自愈',
    run() {
      const rel = 'rewrite/mp/pages/player/player.ts'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [] // 重写线未建时不红
      const src = readFileSync(abs, 'utf8')
      const body = methodBody(src, 'playSegment')
      if (!body) return [`${rel} 找不到 playSegment 方法——切段取址单点丢失（根因#8）`]
      const awaitAt = body.indexOf('await')
      const recheckAt = body.indexOf('!== this.playToken')
      if (awaitAt < 0 || recheckAt < 0 || recheckAt < awaitAt)
        return [`${rel} playSegment await 取址后未复核 playToken 再 setData——快速切段乱序回包播错段且不自愈（根因#8·同老线 player-playurl-stale-guarded）`]
      return []
    },
  },
  {
    // 播放缓冲失速可视化 + 播放失败可观测（课程链路审计 2026-07-17·根因#8/#14）：播放中缓冲区耗尽只发
    // bind:waiting 不发 error——不监听则用户只见画面冻结（无转圈无提示无恢复），易误判「小程序卡死」；
    // 播放失败（取址/媒体/失速三类）不上报则核心内容链的故障率对服务端永远不可见。守三件事：
    // ① wxml 挂 bind:waiting 且 ts 定义 onVideoWaiting（错题本 E2：事件绑定与方法定义是一对，抄一半真机报错）；
    // ② onVideoWaiting 起升级定时器（久等未恢复转 error 给重试入口），onUnload 清理 _bufTimer（timer 必清理）；
    // ③ player.ts 存在 video_error 上报接线（trackEvent 通道·云端桥 anomalies）。
    id: 'rw-mp-player-buffering-wired',
    roots: ['#8', '#14'],
    desc: '播放缓冲失速可视化+播放失败可观测（课程链路审计 2026-07-17）：player.wxml 须挂 bind:waiting="onVideoWaiting" 且 player.ts 定义 onVideoWaiting（E2 成对）、其内起升级 setTimeout、onUnload 清 _bufTimer；player.ts 须含 video_error 上报（trackEvent）——缓冲卡死零反馈/播放失败率服务端失明即红',
    run() {
      const base = join(ROOT, 'rewrite/mp/pages/player')
      const tsPath = join(base, 'player.ts')
      const wxmlPath = join(base, 'player.wxml')
      if (!existsSync(tsPath) || !existsSync(wxmlPath)) return [] // 播放页未建时不红
      const bad = []
      const wxml = readFileSync(wxmlPath, 'utf8')
      if (!wxml.includes('bind:waiting="onVideoWaiting"'))
        bad.push('player.wxml <video> 未挂 bind:waiting="onVideoWaiting"——缓冲卡顿零反馈（根因#8·课程链路审计 2026-07-17）')
      const src = stripComments(readFileSync(tsPath, 'utf8')) // 剥注释单源 helper（错题本 E1/E10）
      const waitBody = methodBody(src, 'onVideoWaiting')
      if (!waitBody) bad.push('player.ts 找不到 onVideoWaiting 方法——wxml 绑定挂空（错题本 E2 成对纪律）')
      else if (!waitBody.includes('setTimeout'))
        bad.push('player.ts onVideoWaiting 未起失速升级定时器——缓冲无限期挂着无恢复出口（根因#14）')
      const unloadBody = methodBody(src, 'onUnload')
      if (!unloadBody || !unloadBody.includes('_bufTimer'))
        bad.push('player.ts onUnload 未清理 _bufTimer——离页后定时器仍会醒来（timer 必清理·CLAUDE §7）')
      if (!src.includes("'video_error'"))
        bad.push('player.ts 无 video_error 上报接线——播放失败率对服务端不可见（根因#14·课程链路审计 2026-07-17）')
      return bad
    },
  },
  {
    // 段落播完不自动切换（P4 通栏重播·播放器重设计战役 批B·设计拍板）：旧行为 onEnded 里自动
    // playSegment(next) 切下一段——新设计要求段落播完停在完成态，给用户看「重播本段」通栏按钮自己选，
    // 不替用户做主。守此不变量：onEnded 不许再出现 playSegment( 调用（自动切段回潮即红）且须落 segDone；
    // onReplay 须真 seek(0) 从头重来；wxml 须有重播长条的 tap 绑定，否则 ts 有功能界面点不到。
    // （原「投屏观看模式连续播」模式分叉声明已删——投屏 2026-07-12 全线取缔·R40 退役·决策§28。）
    id: 'rw-mp-player-no-autonext',
    roots: ['R38'],
    desc: '播放器重设计战役批B：段落播完不自动切换（P4 通栏重播·设计拍板 2026-07-11）——player.ts 的 onEnded 方法体不得含 playSegment( 调用（自动切段回潮即红）且须含 segDone；onReplay 方法体须存在且含 seek(0；player.wxml 须有 bind:tap="onReplay"（重播长条入口）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      const tsPath = join(base, 'pages/player/player.ts')
      if (!existsSync(tsPath)) return [] // 播放页未建时不红
      const bad = []
      const src = stripComments(readFileSync(tsPath, 'utf8')) // 剥注释单源 helper（错题本 E1）：防注释文本假触发/假放行
      const endedBody = methodBody(src, 'onEnded')
      if (!endedBody) {
        bad.push('player.ts 找不到 onEnded 方法体——段落播完检测单点丢失')
      } else {
        if (/playSegment\s*\(/.test(endedBody))
          bad.push('player.ts 的 onEnded 方法体内仍含 playSegment( 调用——自动切段回潮（设计拍板：段落播完不自动切换，须停在完成态给用户自己选）')
        if (!/segDone/.test(endedBody)) bad.push('player.ts 的 onEnded 方法体内未见 segDone——播完完成态未落地')
      }
      const replayBody = methodBody(src, 'onReplay')
      if (!replayBody) bad.push('player.ts 找不到 onReplay 方法体——重播入口单点丢失')
      else if (!/seek\s*\(\s*0/.test(replayBody)) bad.push('player.ts 的 onReplay 方法体内未见 seek(0——重播未真正跳回段首')
      const wxmlPath = join(base, 'pages/player/player.wxml')
      if (existsSync(wxmlPath)) {
        const wxml = readFileSync(wxmlPath, 'utf8')
        if (!/bind:tap\s*=\s*"onReplay"/.test(wxml))
          bad.push('player.wxml 找不到 bind:tap="onReplay"——重播长条按钮入口缺失（ts 有方法但界面点不到）')
      }
      return bad
    },
  },
  {
    // 延时自动返回坞的生命周期清理（病根#5 样板复制即漂移·根因#8 真机才炸）：多页把「提交成功 toast + setTimeout(navigateBack)」
    // 这段坞复制来复制去，漏了清理——用户在延时窗口内手动返回（原生返回箭头/手势），页已出栈但 mp 的 setTimeout 绑 JS VM 不随
    // navigateBack 取消，孤儿定时器到点再 navigateBack 多弹一层。守此不变量：凡 .ts 既有 setTimeout 又有 navigateBack（＝延时返回坞），
    // 必有 onUnload + clearTimeout 清定时器。伴生纪律「成功导航分支不复位 busy（防延时窗口内二次提交）」机器难判，靠人（见 CLAUDE §6 副作用）。
    // 扩面（2026-07-09 批5·bug sweep Round2）：同类坑第二刀——onUnload 清了定时器，但「赋值定时器那次调用」的回包
    // 若在退页之后才落地（如 review/profile-edit/feedback/checkout 的提交/保存 await 期间用户手动退页），迟到回包仍会
    // 对已经退出的页面弹 toast/再 navigateBack（多弹一层的兄弟问题·同根因#8）。统一不变量扩到全部 backTimer 具名坞页：
    // ① onUnload 须置 this.unloaded = true（与既有 clearTimeout 同处）；② 每个 `backTimer = setTimeout` 赋值点所在
    // 方法体内、赋值之前须有 this.unloaded 早退检查。不做「是否在 await 之后」的复杂静态分析——统一简单不变量。
    id: 'rw-mp-navback-timer-cleaned',
    roots: ['#5', '#8'],
    desc: 'mp 延时自动返回坞生命周期清理（病根#5 样板漂移·根因#8）：凡 rewrite/mp 页 .ts 既 setTimeout 又 navigateBack（延时自动返回）须 onUnload + clearTimeout 清定时器；具名 backTimer 坞另须 onUnload 置 this.unloaded=true + 每处 backTimer=setTimeout 赋值须有 this.unloaded 早退检查且位于「赋值点前最后一个 await 之后、赋值之前」（无前置 await 的同步路径为赋值前任意位置·批6 收紧：检查早于 await＝迟到回包窗口失守）——否则用户在延时窗口内手动返回/退页→孤儿定时器再 navigateBack 多弹页，或迟到回包对已退页再 toast/navigateBack（工具端不暴露·真机才炸）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      const pagesDir = join(base, 'pages')
      if (!existsSync(pagesDir)) return []
      // 枚举源码里全部 2 空格缩进的顶层方法名（Page({...}) 对象方法书写惯例·`^\s{2}` 锚定行首恰好两空格，
      // 更深缩进的嵌套回调（如 success: async (res) => {}）不会误命中）——配 methodBody 取各方法体范围，
      // 定位某个 backTimer 赋值点具体落在哪个方法体内。
      const topLevelMethodNames = (src) => {
        const names = []
        const re = /^ {2}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/gm
        let mm
        while ((mm = re.exec(src))) names.push(mm[1])
        return names
      }
      for (const p of readdirSync(pagesDir)) {
        const tsPath = join(pagesDir, p, `${p}.ts`)
        if (!existsSync(tsPath)) continue
        const src = stripComments(readFileSync(tsPath, 'utf8')) // 剥注释单源 helper（错题本 E1）：防注释文本假触发/假放行
        // 延时返回坞：既 setTimeout 又 navigateBack（延时自动返回·同步 navigateBack 或纯定时器不算）
        if (!/setTimeout\s*\(/.test(src) || !/navigateBack/.test(src)) continue
        if (!/onUnload\s*\(/.test(src) || !/clearTimeout\s*\(/.test(src)) {
          bad.push(`pages/${p}/${p}.ts 有 setTimeout+navigateBack 延时返回但缺 onUnload+clearTimeout——延时窗口内手动返回→孤儿定时器再 navigateBack 多弹页（病根#5·根因#8）`)
          continue
        }
        if (!/backTimer\s*=\s*setTimeout\s*\(/.test(src)) continue // 无具名 backTimer 坞（如仅裸 setTimeout）：扩面不变量不适用，上面第一半已够
        const onUnloadBody = methodBody(src, 'onUnload')
        if (!/this\.unloaded\s*=\s*true/.test(onUnloadBody))
          bad.push(`pages/${p}/${p}.ts 的 onUnload 未置 this.unloaded=true——backTimer 坞迟到回包判退失据（病根#5 扩面·根因#8）`)
        const names = topLevelMethodNames(src)
        const asgnRe = /backTimer\s*=\s*setTimeout\s*\(/g
        let am
        while ((am = asgnRe.exec(src))) {
          const asgnAt = am.index
          let owner = null
          for (const name of names) {
            const body = methodBody(src, name)
            if (!body) continue
            const bodyStart = src.indexOf(body)
            if (bodyStart >= 0 && asgnAt >= bodyStart && asgnAt < bodyStart + body.length) {
              owner = { name, body, bodyStart }
              break
            }
          }
          if (!owner) continue // 找不到所属方法体（收尾启发式失配）——不误报，交由上面 onUnload 检查兜底
          const relAsgnAt = asgnAt - owner.bodyStart
          // 判据文本位置须≠控制流位置（Round3 item4·猎手构造样例证实假阴）：检查写在「赋值前任意位置」不够——若赋值点前
          // 有 await，迟到回包的判退检查必须落在「该 await 之后、赋值之前」才对控制流真正生效（写在 await 之前的检查，
          // 在 await 恢复执行时早已跑过，拦不住迟到回包）。取赋值点前文最后一个 await 的位置作区间起点；无 await（同步路径，
          // 如 checkout 空车分支）保持原判据（赋值前任意位置皆可，因赋值前无异步让出点、检查天然生效）。
          let lastAwaitAt = -1
          const awaitRe = /\bawait\b/g
          let awm
          while ((awm = awaitRe.exec(owner.body))) {
            if (awm.index >= relAsgnAt) break
            lastAwaitAt = awm.index
          }
          const checkRe = /this\.unloaded\s*\)\s*return/g
          let checkOk = false
          let cm
          while ((cm = checkRe.exec(owner.body))) {
            if (cm.index >= relAsgnAt) break
            if (cm.index > lastAwaitAt) {
              checkOk = true
              break
            }
          }
          if (!checkOk)
            bad.push(`pages/${p}/${p}.ts 方法 ${owner.name} 里 backTimer=setTimeout 赋值前缺 this.unloaded 早退检查（须落在最后一个 await 之后、赋值之前）——迟到回包会对已退页误 navigateBack/toast（病根#5 扩面·根因#8）`)
        }
      }
      return bad
    },
  },
  {
    // await 恢复点后执行导航/支付副作用却无 this.unloaded 复核（病根#5 样板复制即漂移·根因#8 真机才炸）：本战役
    // 第 5+ 次同类（checkout 批A 已修 onSubmit/startPay·本批 order-list/order/welcome 再修 4 处）——按元模式满三条
    // 同类须收敛成机器守卫。点名制清单（非 span 推断·错题本 E8 提醒的边界绕过风险在此不适用）：某方法体内首个
    // await 之后须出现 this.unloaded 复核；不做精细逐 await 静态分析，多 await 方法只要求存在复核即可（勿过度精细，
    // 同批规格纪律，精细版见 rw-mp-navback-timer-cleaned 的 backTimer 专项）。
    id: 'rw-mp-await-side-effect-unloaded-recheck',
    roots: ['#5', '#8'],
    desc: 'mp await 恢复点后导航/支付副作用须先复核 this.unloaded（病根#5 样板复制即漂移·根因#8 真机才炸）：点名清单——checkout.ts{onSubmit,startPay}、order-list.ts{onPay,onConfirm,onCancel}、order.ts{onPay,onAfterSale,onConfirm,onCancel}、welcome.ts{onEnter,activate}、consent.ts{submit}——各方法体内首个 await 之后须出现 this.unloaded 复核（indexOf(\'await\') < search(/this\\?\\.unloaded/)，判据认 this.unloaded 与 this?.unloaded 两种等价写法·I4 健壮化，多 await 方法只要求存在复核即可不做逐 await 精细判），否则用户在 await 期间退出页面，迟到回包仍对已退页 toast/reload/redirectTo/拉起支付授权框（真机才炸，工具端不暴露）',
    run() {
      const targets = [
        { file: 'rewrite/mp/pages/checkout/checkout.ts', methods: ['onSubmit', 'startPay'] },
        { file: 'rewrite/mp/pages/order-list/order-list.ts', methods: ['onPay', 'onConfirm', 'onCancel'] },
        { file: 'rewrite/mp/pages/order/order.ts', methods: ['onPay', 'onAfterSale', 'onConfirm', 'onCancel'] },
        { file: 'rewrite/mp/pages/welcome/welcome.ts', methods: ['onEnter', 'activate'] },
        { file: 'rewrite/mp/pages/consent/consent.ts', methods: ['submit'] },
      ]
      const bad = []
      for (const t of targets) {
        const abs = join(ROOT, t.file)
        if (!existsSync(abs)) continue // 重写线未建时不红
        const src = stripComments(readFileSync(abs, 'utf8')) // 剥注释单源 helper（错题本 E1）：防注释文本假触发/假放行
        for (const name of t.methods) {
          const body = methodBody(src, name)
          if (!body) {
            bad.push(`${t.file} 找不到 ${name} 方法——await 恢复点复核点名清单点名方法丢失（根因#8）`)
            continue
          }
          const awaitAt = body.indexOf('await')
          const checkAt = body.search(/this\??\.unloaded/) // I4：健壮化——`this?.unloaded` 等可选链写法语义等价，纯字面量 indexOf 会假红
          if (awaitAt < 0 || checkAt < 0 || checkAt < awaitAt)
            bad.push(`${t.file} 方法 ${name} 里 await 恢复点后缺 this.unloaded 复核——用户退页后迟到回包仍对已退页导航/toast/拉起支付（病根#5·根因#8）`)
        }
      }
      return bad
    },
  },
  {
    id: 'rw-mp-address-region-picker',
    roots: ['#8'],
    desc: 'mp 地址地区用原生省市区级联 picker（非自由文本·根因#8·C 类竖切）：rewrite/mp/pages/address-edit/address-edit.wxml 的「所在地区」须用 <picker mode="region">、不得回退自由文本 <input data-field="region">——自由文本丢省市区级联约束、易入脏地址（真机才暴露收货问题）',
    run() {
      const f = 'rewrite/mp/pages/address-edit/address-edit.wxml'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return []
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (!/mode="region"/.test(src)) bad.push(`${f} 未用 <picker mode="region">——地区选择器回退自由文本（丢省市区级联·根因#8）`)
      if (/data-field="region"/.test(src)) bad.push(`${f}「所在地区」仍是自由文本 <input data-field="region">——须换原生省市区 picker`)
      return bad
    },
  },
  {
    // 播放页竖屏沉浸全屏 + 帮助(客服)入口（M2 批·根因#8 真机能力面 + 病根#5 样板复制即漂移）：
    // 竖屏沉浸播放器须自绘导航（原生标题栏与自绘黑条控制条会重叠打架）；关闭原生 controls 才不会跟自绘
    // 底条打架；进度条为自绘 seek 条，须两段式绑定（onSeekStart/onSeekMove 拖动中只改显示不 seek·
    // onSeekEnd 松手才真 seek，见播放器重设计战役批C），否则 timeupdate 会在拖动中把手指顶回去；
    // 客服入口须单源、不许在别处内联。（原 id rw-mp-player-immersive-casting；投屏断言随投屏全线取缔
    // 删除——2026-07-12 拍板·决策§28，防回潮见 rw-mp-no-casting。）
    id: 'rw-mp-player-immersive',
    roots: ['#8', '#5'],
    desc: '播放页竖屏沉浸全屏 + 帮助(客服)入口：player.json 须 navigationStyle:custom；player.wxml 的 <video> 须 controls="{{false}}" + 求助入口节点（bind:tap=onHelp）+ 自绘 seek 条 WXS 化两段式绑定（批5·根因#15：60Hz touchmove 每帧 setData 双向过桥＝掉帧源，拖动几何移入渲染层 WXS 闭环）——外置 <wxs src="./seek.wxs" module="sk">（内联 <wxs> 里的 < 会被 wxml-well-formed 咬）+ 绑定钉 touchstart={{sk.onStart}}/touchmove={{sk.onMove}}/touchend={{sk.onEnd}} + change:cfg={{sk.onCfg}} 下发几何（rect/durSec/marks）；seek.wxs 的 onMove 函数体内不得出现 .seek(/onSeekCommit（两段式：WXS 拖动中只改显示、绝不提交·setupFnBody 取真源）、player.ts 的 onSeekCommit 方法体内须出现 .seek(（松手才由逻辑层真 seek）+ _resumeAt 赋值 + .play(（seek 只是发起、平台不保证落住：源不支持 Range 时 seek 会触发重载→位置回 0 且播放停摆→没有 timeupdate→进度条永久冻在松手位置，2026-07-20 用户反馈现象；故须记目标秒交 onVideoMeta 兜底拉回 + 补推 play）；客服入口须单源在 rewrite/mp/utils/customerService.ts（rewrite/mp 内 wx.openCustomerServiceChat 只此一处）。段落进度条须落胶囊下方（2026-07-13 反馈）：player.ts 须取 getMenuButtonBoundingClientRect、.lp-segstrip 须动态 top（不硬编码贴屏顶）；视频框须贴合素材比例去左右黑边（2026-07-13 反馈）：主 <video>（controls={{false}}）须 bind:loadedmetadata=onVideoMeta + player.ts 有 onVideoMeta 方法（体内真写 videoRatio）+ .lp-video-box 播放态须动态 padding-top（不写死 168%）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const jsonPath = join(base, 'pages/player/player.json')
      if (!existsSync(jsonPath)) return [] // 播放页未建时不红（早期批次）
      const bad = []
      const json = JSON.parse(readFileSync(jsonPath, 'utf8'))
      if (json.navigationStyle !== 'custom')
        bad.push('rewrite/mp/pages/player/player.json 缺 navigationStyle:custom——竖屏沉浸播放页须自绘导航栏，留原生标题栏会跟自绘黑条控制条重叠打架（设计定案）')

      const wxmlPath = join(base, 'pages/player/player.wxml')
      const wxml = existsSync(wxmlPath) ? readFileSync(wxmlPath, 'utf8') : ''
      if (!wxml) bad.push('rewrite/mp/pages/player/player.wxml 缺失')
      if (wxml && !/controls\s*=\s*"\{\{\s*false\s*\}\}"/.test(wxml))
        bad.push('player.wxml 的 <video> 未关闭原生 controls="{{false}}"——自绘控制条会跟原生控件重叠打架（设计定案）')
      if (wxml && !/bind:?tap\s*=\s*"onHelp"/.test(wxml)) bad.push('player.wxml 找不到求助入口节点（bind:tap=onHelp）——客服入口占中央求助钮位缺失（设计定案）')
      // 自绘 seek 拖动几何 WXS 化（批5·根因#15：60Hz touchmove 每帧 5 字段 setData 双向过桥＝跟手延迟/掉帧源）——
      // 拖动位置在渲染层 WXS 闭环，wxml 绑定改钉 {{sk.*}}；外置 <wxs src="./seek.wxs">（内联 <wxs> 里的 < 比较会被
      // wxml-well-formed 栈式扫误咬红，必须外置文件）。旧 onSeekStart/onSeekMove/onSeekEnd 字面绑定随之退役。
      if (wxml && !/<wxs\s+[^>]*src\s*=\s*"\.\/seek\.wxs"/.test(wxml))
        bad.push('player.wxml 未见 <wxs src="./seek.wxs" ...>——自绘 seek 拖动几何未 WXS 化（60Hz 每帧过桥回潮·根因#15）')
      if (wxml && !/bind:?touchstart\s*=\s*"\{\{\s*sk\.onStart\s*\}\}"/.test(wxml))
        bad.push('player.wxml 的自绘 seek 条未见 bind:touchstart="{{sk.onStart}}"——WXS 两段式拖动缺起点绑定')
      if (wxml && !/catch:?touchmove\s*=\s*"\{\{\s*sk\.onMove\s*\}\}"/.test(wxml))
        bad.push('player.wxml 的自绘 seek 条未见 catch:touchmove="{{sk.onMove}}"——拖动几何未走 WXS 渲染层（60Hz 每帧过桥回潮·根因#15），且未 catch 会让 touchmove 透传（真机滚动/穿透风险）')
      if (wxml && !/bind:?touchend\s*=\s*"\{\{\s*sk\.onEnd\s*\}\}"/.test(wxml))
        bad.push('player.wxml 的自绘 seek 条未见 bind:touchend="{{sk.onEnd}}"——松手提交绑定缺失')
      if (wxml && !/change:cfg\s*=\s*"\{\{\s*sk\.onCfg\s*\}\}"/.test(wxml))
        bad.push('player.wxml 的自绘 seek 条未见 change:cfg="{{sk.onCfg}}"——逻辑层几何（rect/durSec/marks）无法下发 WXS（渲染层无数据无从算秒/磁吸）')

      // 段落进度条落胶囊下方（2026-07-13 反馈·Bug D1）：.lp-segstrip 节点须带动态 top（内联 style top:{{...}}），
      // 不许回退到 wxss 硬编码 top（那会相对全屏 .lp-stage 顶贴屏顶·撞状态栏/胶囊）。
      if (wxml) {
        // 词边界匹配：容加修饰类（"lp-segstrip lp-segstrip--slim"），\b 防误配 lp-segstrip-foo
        const segTag = wxml.match(/<view[^>]*class="[^"]*\blp-segstrip\b[^"]*"[^>]*>/)
        if (!segTag) bad.push('player.wxml 找不到 .lp-segstrip 节点——段落进度条浮层缺失')
        // top 前只许属性串起点或 ;/空白分隔——裸 [^"]*top: 会被 padding-top:/margin-top: 的插值子串假绿
        else if (!/style="(?:[^"]*[;\s])?top:\s*\{\{/.test(segTag[0]))
          bad.push('player.wxml 的 .lp-segstrip 未见动态 top（style="top: {{...}}"）——须按胶囊底边动态避让（getMenuButtonBoundingClientRect），硬编码贴屏顶会撞状态栏/胶囊（2026-07-13 反馈）')
      }
      // 视频框贴合素材比例去左右黑边（2026-07-13 反馈·Bug D2）：主 <video>（controls="{{false}}" 那只·帮助
      // 视频走原生 controls 不带 {{false}}）须 bind:loadedmetadata="onVideoMeta" 拿真实宽高——全文级子串匹配
      // 会在绑定错位到帮助视频时假绿，须锚在主视频开标签内测。
      if (wxml) {
        const mainVideo = wxml.match(/<video[^>]*controls\s*=\s*"\{\{\s*false\s*\}\}"[^>]*>/)
        if (!mainVideo) bad.push('player.wxml 找不到主 <video>（controls="{{false}}"）——loadedmetadata 断言无法执行')
        else if (!/bind:?loadedmetadata\s*=\s*"onVideoMeta"/.test(mainVideo[0]))
          bad.push('player.wxml 的主 <video> 未见 bind:loadedmetadata="onVideoMeta"——播放框无法贴合素材真实比例，竖版素材会留左右黑边（2026-07-13 反馈）')
      }
      if (wxml) {
        // 播放态视频框（非 lp-state 状态框）须动态 padding-top 撑比例。序鲁棒 [^>]*：class 前插属性不逃逸；
        // 精确闭引号 class="lp-video-box" 刻意排除状态框 class="lp-video-box lp-state"（勿抄 segTag 的词边界改法）。
        // 匹配不到必须报错（fail-closed）——静默跳过＝守卫真空，wxss 默认 168% 重新独裁而 check 全绿。
        const playBox = wxml.match(/<view[^>]*class="lp-video-box"[^>]*>/)
        if (!playBox) bad.push('player.wxml 找不到播放态 .lp-video-box 节点（class 恰为 "lp-video-box"）——视频框比例断言无法执行')
        else if (!/style="(?:[^"]*[;\s])?padding-top:\s*\{\{/.test(playBox[0]))
          bad.push('player.wxml 播放态 .lp-video-box 未见动态 padding-top（style="padding-top: {{videoRatio}}%"）——须按素材真实比例撑框去黑边（2026-07-13 反馈）')
      }

      const tsPath = join(base, 'pages/player/player.ts')
      const ts = existsSync(tsPath) ? readFileSync(tsPath, 'utf8') : ''
      if (wxml && ts) {
        // catchtouchmove="X" 引用的处理函数必须在 .ts 里真实存在——否则锁背景滚动的声称落空（wxml 抄了半边、
        // ts 忘了另半边：曾经的漏洞，抽屉遮罩/抽屉本体两处 catchtouchmove="noop" 而 player.ts 无 noop 方法）。
        const handlers = new Set([...wxml.matchAll(/catch:?touchmove\s*=\s*"([\w$]+)"/g)].map((m) => m[1]))
        for (const h of handlers) {
          if (!new RegExp(`\\b${h}\\s*\\(`).test(ts))
            bad.push(`player.wxml 的 catchtouchmove="${h}" 在 player.ts 里找不到对应方法——锁背景滚动的处理函数缺失（真机会报 handler 不存在告警）`)
        }
      }
      if (ts) {
        // 自绘 seek 两段式语义 WXS 化（批5·根因#15）：拖动几何移入 seek.wxs 渲染层闭环——WXS onMove 只改显示、
        // 绝不提交 seek（.seek(/onSeekCommit 出现即破坏两段式），松手才由逻辑层 onSeekCommit 真 seek。seek.wxs 是 ES5
        // 独立运行时进不了 tsc，用 setupFnBody（花括号配平·适配顶层 function 声明·methodBody 的两空格逗号收尾启发式
        // 对 WXS 顶层函数不适用）+ stripComments 取真源（错题本 E1/E10：对剥注释后的函数体判定，防注释假触发/假放行）。
        const wxsPath = join(base, 'pages/player/seek.wxs')
        const wxs = existsSync(wxsPath) ? readFileSync(wxsPath, 'utf8') : ''
        if (!wxs) bad.push('rewrite/mp/pages/player/seek.wxs 缺失——自绘 seek 拖动几何 WXS 化未落地（60Hz 过桥回潮·根因#15）')
        else {
          const onMoveBody = setupFnBody(stripComments(wxs), 'onMove') // 已切自剥注释后的源·下方判定无需再剥
          if (!onMoveBody) bad.push('seek.wxs 找不到 onMove 函数体——WXS 拖动几何缺失')
          else {
            if (/onSeekCommit/.test(onMoveBody))
              bad.push('seek.wxs 的 onMove 函数体内出现 onSeekCommit——两段式语义破坏：WXS 拖动中绝不许提交 seek（松手才提交）')
            if (/\.seek\s*\(/.test(onMoveBody))
              bad.push('seek.wxs 的 onMove 函数体内出现 .seek(——WXS 内不得直接 seek（两段式：拖动中只改显示）')
          }
        }
        // WXS 回桥载荷形状（2026-07-20 真机日志逮出·根因#8「按同类 API 的形状想当然」）：
        // `ownerInstance.callMethod(name, args)` 把 args **直接**当方法的第一个实参传入——它不是 wxml 事件
        // 对象，没有 `.detail`。原先两个回桥方法都按事件形状写 `e.detail`，恒得 undefined → 秒数恒取兜底 0：
        // 松手 seek(0) 把视频拨回开头、拖动文案恒 0:00、逐秒判重恒「同一秒」故一次不震——三个用户报的现象
        // 同一个因。故两个回桥方法禁裸读 .detail，一律经 wxsArgs() 单源取载荷（该 helper 兼容两种形状，
        // 将来若改回 wxml 直绑也不会再漂）。
        for (const fn of ['onSeekTick', 'onSeekCommit']) {
          const body = stripComments(methodBody(ts, fn))
          if (body && /\.detail\b/.test(body))
            bad.push(`player.ts 的 ${fn} 方法体内裸读 .detail——WXS callMethod 直传参数、没有 .detail（读到恒 undefined→秒数恒 0→松手把视频拨回开头且不震动·2026-07-20 实测），载荷一律经 wxsArgs() 取`)
          if (body && !/wxsArgs\s*</.test(body) && !/wxsArgs\s*\(/.test(body))
            bad.push(`player.ts 的 ${fn} 方法体内未见 wxsArgs(——WXS 回桥载荷须经该单源 helper 取值（直接读参数形状会随平台/绑定方式漂·2026-07-20 栽过）`)
        }

        const seekCommitBody = methodBody(ts, 'onSeekCommit')
        if (!seekCommitBody) bad.push('player.ts 找不到 onSeekCommit 方法体——WXS 松手提交的逻辑层落点缺失（松手真 seek）')
        else {
          const commit = stripComments(seekCommitBody)
          if (!/\.seek\s*\(/.test(commit)) bad.push('player.ts 的 onSeekCommit 方法体内未见 .seek(——松手应真正 seek 到位')
          // seek 后补一次 play（幂等·与 playSegment 的 autoplay 停摆兜底同型）：拖动落位后播放若停摆在首帧，
          // 没人补推就一直停着，而播放一停就没有 timeupdate、进度条随之不再更新。
          // 断言必须钉「非暂停态补推」这一条路径本身，不能只查 .play( 出现过——segDone 分支另有一处
          // ctx.play()（播完态拖动＝回看），删掉常规路径的补推后 .play( 仍在场、宽断言照样绿（错题本 E17
          // 同型：一个方法体内有两处同名调用时，存在性断言测不出删了哪一处）。
          if (!/!this\.data\.paused\s*\)[^\n]*\.play\s*\(/.test(commit))
            bad.push('player.ts 的 onSeekCommit 方法体内未见「非暂停态补推 play」（形如 if (!this.data.paused) ctx.play()）——seek 触发重载会让播放停摆在首帧，无人补推则进度条永久冻在松手位置（2026-07-20 反馈现象·根因#8）')
        }

        // 量轨须有重试路径（2026-07-20 用户反馈第二轮：拖动完全无反应且无震动）。病理：_seekRect 只在
        // playSegment 的 state:'playing' 回调里量一次（`if (!this._seekRect)`），而 setData 回调触发时
        // .lp-seek 常常尚未完成布局提交 → boundingClientRect 回 width:0 → 代码正确地拒绝缓存坏值，却
        // 没有任何重量路径：_seekRect 永久为 null → buildSeekCfg 恒回 null → seekCfg 永不下发 → seek.wxs
        // 的 st.rect 恒 null → onStart 直接 return。表现＝拖动彻底无反应（无位移/无回桥/无震动/无 seek），
        // 且只有换段才可能碰运气量到。故量轨必须在播放推进中重试到量得为止（onTimeUpdate 是天然节拍，
        // 无需另起定时器）。根因#8：布局时序在真机/模拟器各不相同，静态测不出、只有跑起来才现形。
        const timeUpdateBody = methodBody(ts, 'onTimeUpdate')
        if (!timeUpdateBody) bad.push('player.ts 找不到 onTimeUpdate 方法体——进度推进落点缺失')
        else if (!/measureSeekRect\s*\(/.test(stripComments(timeUpdateBody)))
          bad.push('player.ts 的 onTimeUpdate 方法体内未见 measureSeekRect(——量轨无重试路径：首次量到 width:0（布局未提交）后 _seekRect 永久为 null，seekCfg 永不下发，拖动彻底失效且无震动（2026-07-20 反馈现象·根因#8）')

        // 段落进度条落胶囊下方（2026-07-13 反馈·Bug D1）：须取原生胶囊底边为动态 top 的可靠源。
        if (!/getMenuButtonBoundingClientRect\s*\(/.test(stripComments(ts)))
          bad.push('player.ts 未调用 getMenuButtonBoundingClientRect——段落进度条无法按胶囊底边动态避让（逐机型胶囊位不同·statusBarHeight 近似不可靠·2026-07-13 反馈）')
        // 视频框贴合素材比例（2026-07-13 反馈·Bug D2）：loadedmetadata 回调须存在且真写 videoRatio——
        // 只查存在性会被掏空的方法体假绿（与 seek 断言同款「剥注释后查方法体语义」写法）。
        const videoMetaBody = methodBody(ts, 'onVideoMeta')
        if (!videoMetaBody)
          bad.push('player.ts 找不到 onVideoMeta 方法体——<video> loadedmetadata 回调缺失，播放框无法据素材真实宽高撑比例去左右黑边（2026-07-13 反馈）')
        else if (!/videoRatio/.test(stripComments(videoMetaBody)))
          bad.push('player.ts 的 onVideoMeta 方法体内未见 videoRatio 写入——回调存在但不撑比例（空壳），播放框贴合素材比例功能失效')
      }

      const csPath = join(base, 'utils/customerService.ts')
      if (!existsSync(csPath)) bad.push('rewrite/mp/utils/customerService.ts 缺失——客服入口无单源（病根#5 样板复制即漂移）')
      else {
        const offenders = []
        const pagesDir = join(base, 'pages')
        const walkForCS = (d) => {
          for (const e of lsScan(d)) {
            const p = join(d, e)
            if (statSync(p).isDirectory()) walkForCS(p)
            else if (/\.(ts|wxml)$/.test(e) && /openCustomerServiceChat/.test(readFileSync(p, 'utf8'))) offenders.push(relative(base, p))
          }
        }
        if (existsSync(pagesDir)) walkForCS(pagesDir)
        if (offenders.length)
          bad.push(`rewrite/mp 内 wx.openCustomerServiceChat 不该在 pages 下内联调用（${offenders.join(', ')}）——客服入口须收口 utils/customerService.ts 单源（病根#5）`)
      }
      return bad
    },
  },
  {
    // 投屏全线取缔·防回潮（用户拍板 2026-07-12·决策§28·R39/R40 随之退役）：播放页投屏主路径
    // （show-casting-button + casting 事件）与备路径（onCast/startCasting 特性检测）及全部入口/样式/文案
    // 已整体拆除。回潮通道真实存在——未合并的投屏终态分支（PR #7 worktree-cast-landscape）或旧样板复制
    // 都可能把投屏带回来，故守「rewrite/mp 源内投屏 token 零出现」。日后若用户重启投屏需求：先改需求清单
    // 再退役本守卫（删与加对等，见 refactor-batch step 4），不许绕。
    id: 'rw-mp-no-casting',
    roots: ['R34'],
    desc: '投屏全线取缔防回潮（2026-07-12 拍板·决策§28）：rewrite/mp 全部源文件（ts/wxml/wxss/json/md/wxs）不得出现 投屏/casting 任一 token（含 startCasting/show-casting-button/casting 事件绑定）——旧分支合并或样板复制把投屏带回来当场红；重启投屏须先改需求清单并退役本守卫。批5 起扩扫 .wxs（渲染层 WXS 亦是投屏回潮盲区，堵之）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      const re = /投屏|casting/i
      const walk = (d) => {
        for (const e of lsScan(d)) {
          if (e === 'node_modules') continue
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (/\.(ts|wxml|wxss|json|md|wxs)$/.test(e) && re.test(readFileSync(p, 'utf8')))
            bad.push(`${relative(ROOT, p)} 含投屏 token（投屏/casting）——投屏已全线取缔（决策§28），不得回潮`)
        }
      }
      walk(base)
      return bad
    },
  },
  {
    // 登录零资料采集防回潮（R1·规格§四-1·决策§3）：登录半屏 components/login-sheet 是「真·一键登录」——
    // 微信静默 openid 直接登录、登录环节不采集头像昵称/手机号（微信 2022-10 废 getUserProfile；chooseAvatar/
    // type=nickname 官方要求主动点击、无法自动带出；索手机号违运营规范）。资料改后续「编辑资料」页补。
    // 守此不变量：login-sheet.wxml 须存在且不得出现 chooseAvatar / getPhoneNumber / type="nickname" 采集标记——
    // 样板复制或「顺手把头像昵称加回登录」当场红（同 rw-mp-no-casting 决策锁范式）。
    id: 'rw-mp-login-no-profile-collect',
    roots: ['R1'],
    desc: '登录零资料采集防回潮（R1·真·一键登录）：rewrite/mp/components/login-sheet/login-sheet.wxml 须存在且不得含 open-type="chooseAvatar" / open-type="getPhoneNumber" / type="nickname"——登录环节静默 openid 直登、不采头像昵称手机号（微信已废 getUserProfile·chooseAvatar/nickname 无法自动带出·索手机号违规），资料改「编辑资料」补',
    run() {
      const p = join(ROOT, 'rewrite/mp/components/login-sheet/login-sheet.wxml')
      if (!existsSync(p)) return ['rewrite/mp/components/login-sheet/login-sheet.wxml 缺失——登录半屏未落地（R1）']
      const src = readFileSync(p, 'utf8')
      const bad = []
      if (/open-type\s*=\s*["']chooseAvatar["']/.test(src))
        bad.push('login-sheet.wxml 含 chooseAvatar——登录环节不采集头像（真·一键登录·资料改「编辑资料」页补）')
      if (/open-type\s*=\s*["']getPhoneNumber["']/.test(src))
        bad.push('login-sheet.wxml 含 getPhoneNumber——登录不采手机号（违微信运营规范·R1「不采手机号」）')
      if (/type\s*=\s*["']nickname["']/.test(src))
        bad.push('login-sheet.wxml 含 type="nickname"——登录环节不采集昵称（真·一键登录）')
      return bad
    },
  },
  {
    // 公开目录读上界（病根#7 规模·容量审计 2026-07-12）：getProducts/getCourses 是全站最热公开读
    // （每个新会话必调），裸 .get() 命中云开发服务端默认 100 条**静默截断**——商品/课程破百后排序靠后
    // 的整批消失且无报错无告警（仓内自证：adminApi/lib.ts:92、kit/inventory.ts 注释同一病根）。守此
    // 不变量：两条查询链必须带显式 .limit(（口径同 learning.ts 已有 .limit(200) 先例）。
    id: 'rw-app-catalog-reads-bounded',
    roots: ['#7'],
    desc: '公开目录读上界（病根#7）：app/actions/catalog.ts 的 getProducts 与 learning.ts 的 getCourses 查询链（collection→…→get）须含显式 .limit(——裸 .get() 服务端默认 100 条静默截断，目录破百即无声丢货',
    run() {
      const bad = []
      const chains = [
        { file: 'rewrite/cloud/src/functions/app/actions/catalog.ts', head: '.collection(COLLECTIONS.products)', what: 'getProducts 商品目录' },
        { file: 'rewrite/cloud/src/functions/app/actions/learning.ts', head: '.collection(COLLECTIONS.courses)', what: 'getCourses 课程目录' },
      ]
      for (const c of chains) {
        const p = join(ROOT, c.file)
        if (!existsSync(p)) continue
        const src = stripComments(readFileSync(p, 'utf8'))
        let idx = src.indexOf(c.head)
        let found = false
        while (idx !== -1) {
          const end = src.indexOf('.get()', idx)
          if (end === -1) break
          const chain = src.slice(idx, end)
          // 只核带 orderBy 的列表读（doc()/count() 等单读形态不在此列）
          if (/\.orderBy\(/.test(chain)) {
            found = true
            if (!/\.limit\(/.test(chain)) bad.push(`${c.file} 的 ${c.what}查询链无显式 .limit(——服务端默认 100 条静默截断（病根#7）`)
          }
          idx = src.indexOf(c.head, end)
        }
        if (!found) bad.push(`${c.file} 找不到 ${c.what}查询链（${c.head}→orderBy→get）——守卫定位失效，代码形态变了须同步改判据`)
      }
      return bad
    },
  },
  {
    // 列表瘦身只签 cover（批1·病根#7 规模 + #15 加载链路冗余）：列表卡片只用 cover，图册 images[] 是详情页
    // 才需要的——列表若连 images 一起签，是 N 商品 × M 图的临时址签发（规模杀手）+ 白下发一大坨列表用不到的
    // 字段。故 getProducts 只签 cover、瘦身删掉 images 字段（`delete out.images`·唯一放行的 images 引用），
    // 任何 images 的签发/下发（id 收集 `p.images` / 赋值 `out.images =`）即红；图册收窄进详情页专属
    // getProductDetail（须在场且含 images 换址补齐画廊）。函数体截取走内联箭头体花括号配对（不新增顶层 fn·防扰
    // guard-strip-single-source span·E8）+ stripComments 单源 helper（错题本 E1）。反向自检：把 images 换址塞回
    // getProducts（`out.images = out.images.map(...)`）→ 本守卫红。
    id: 'rw-catalog-list-cover-only',
    roots: ['#7', '#15'],
    desc: '列表瘦身只签 cover（病根#7 规模 + #15 加载链路冗余）：app/actions/catalog.ts 的 getProducts 函数体（剥注释后）除 `delete out.images` 瘦身外不得出现 images——列表 N 商品×M 图签发是规模杀手，图册 images[] 收窄进详情页专属 getProductDetail（须在场且含 images 换址补齐画廊）。反向自检：把 images 换址（out.images = ...）塞回 getProducts → 红',
    run() {
      const p = join(ROOT, 'rewrite/cloud/src/functions/app/actions/catalog.ts')
      if (!existsSync(p)) return ['rewrite/cloud/src/functions/app/actions/catalog.ts 缺失（getProducts 正册·批1）']
      const src = stripComments(readFileSync(p, 'utf8')) // 剥注释单源 helper（E1）：对真源匹配·防注释假触发/放行
      const bad = []
      // 箭头函数体截取（内联·从声明起找首个 { 花括号配对到平衡·返回含声明整段；找不到/不配平返回 null）
      const arrowBody = (decl) => {
        const s = src.indexOf(decl)
        if (s === -1) return null
        const b = src.indexOf('{', s)
        if (b === -1) return null
        let depth = 0
        for (let i = b; i < src.length; i++) {
          if (src[i] === '{') depth++
          else if (src[i] === '}' && --depth === 0) return src.slice(s, i + 1)
        }
        return null
      }
      const gp = arrowBody('export const getProducts')
      if (gp === null) return ['catalog.ts 找不到/截不出 export const getProducts 函数体——守卫定位失效，重构别改这个声明形态']
      if (!gp.includes('.collection(COLLECTIONS.products)'))
        bad.push('getProducts 函数体丢了 .collection(COLLECTIONS.products) 链头——守卫定位失效（rw-app-catalog-reads-bounded 也靠它·别改名）')
      // 放行瘦身用的 `delete <var>.images`（唯一允许的 images 引用），其余 images（签发/下发）即红
      const gpClean = gp.replace(/delete\s+\w+\.images\b/g, '')
      if (/\bimages\b/.test(gpClean))
        bad.push('getProducts 函数体出现 images 签发/下发（delete 瘦身除外）——列表须只签 cover（病根#7 规模·图册收窄进 getProductDetail）')
      const gd = arrowBody('export const getProductDetail')
      if (gd === null) bad.push('catalog.ts 缺 export const getProductDetail——列表瘦身后详情页图册无处补齐（病根#15）')
      else if (!/\bimages\b/.test(gd))
        bad.push('getProductDetail 函数体未见 images 换址——详情页完整图册须由它补齐（病根#15）')
      return bad
    },
  },
  {
    // 图像处理接缝单点（批1·根因#12 平台规则外部风险）：数据万象（CI）的 imageMogr2 处理参数拼接收口在
    // kit/storage.ts withImageProc 一处——控制台开通/参数格式变化只改这里 + 环境变量 LD_IMAGE_PROC。别处出现
    // imageMogr2 字面量即红（同 flow-seam-single 形状·参数散落=平台规则改动面失控）。
    id: 'rw-image-proc-seam-single',
    roots: ['#12'],
    desc: '图像处理接缝单点（根因#12 平台规则外部风险）：数据万象 imageMogr2 处理参数拼接全库仅 rewrite/cloud/src/kit/storage.ts 一处（withImageProc）——控制台开通/参数格式变化改一处；别处出现 imageMogr2 字面量即红（同 flow-seam-single 形状）',
    run() {
      const root = join(ROOT, 'rewrite/cloud/src')
      if (!existsSync(root)) return []
      const allowed = 'rewrite/cloud/src/kit/storage.ts'
      const hits = []
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const fp = join(d, e)
          if (statSync(fp).isDirectory()) walk(fp)
          else if (e.endsWith('.ts') && readFileSync(fp, 'utf8').includes('imageMogr2'))
            hits.push(relative(ROOT, fp).replace(/\\/g, '/'))
        }
      }
      walk(root)
      const out = []
      for (const h of hits) if (h !== allowed) out.push(`${h} 出现 imageMogr2——图像处理接缝须收口 kit/storage.ts 单点（根因#12）`)
      if (!hits.includes(allowed)) out.push(`${allowed} 应为 imageMogr2 图像处理参数唯一出现点（withImageProc），未见——接缝单点缺失`)
      return out
    },
  },
  {
    // mp「失败伪装成空态」家族收口（根因#14 失败静默化·韧性审计+深审台账 2026-07-12 同源命中）：
    // 列表/详情页网络失败若与「真的没有数据」渲染同一空态（暂无订单/还没有评价/输入激活码/订单不存在），
    // 弱网用户会把网络抖动误读成数据消失（付费用户看到课程清空被引导输码=客诉级）。detail.ts 的
    // loadFailed/missing 分治是仓内已验范式（bug sweep R1 #3），本守卫把范式钉到全部同类页：
    // ① 五页（order-list/reviews/my-courses/aftersales/order）ts+wxml 须有 loadFailed 态与 onRetryLoad 重试入口；
    // ② catalog 走 state 机，须有 'failed' 态（getCourseByIdDetailed 区分网络失败/查无）；
    // ③ player 取址 fetcher 须区分 FETCH_FAIL（网络/服务失败→error 态可重试）与素材未剪（空串→empty 态）。
    id: 'rw-mp-list-loadfailed-state',
    roots: ['#14'],
    desc: 'mp 失败≠空态（根因#14）：order-list/reviews/my-courses/aftersales/order 五页 ts+wxml 须有 loadFailed+onRetryLoad；catalog.ts 须有 failed 态且 lib/courses 有 getCourseByIdDetailed；取址 fetcher（lib/playbackCache.ts·批3 迁出播放页）须分流 FETCH_FAIL——网络失败伪装成「暂无/不存在/整理中」即红',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      for (const p of ['order-list', 'reviews', 'my-courses', 'aftersales', 'order']) {
        const ts = join(base, `pages/${p}/${p}.ts`)
        const wxml = join(base, `pages/${p}/${p}.wxml`)
        if (!existsSync(ts)) continue
        if (!/loadFailed/.test(stripComments(readFileSync(ts, 'utf8')))) bad.push(`pages/${p}/${p}.ts 无 loadFailed 态——网络失败与真空态混同（根因#14·detail.ts 范式未铺开）`)
        if (existsSync(wxml)) {
          const w = readFileSync(wxml, 'utf8')
          if (!/loadFailed/.test(w)) bad.push(`pages/${p}/${p}.wxml 无 loadFailed 节点——失败态没有界面出口`)
          if (!/bind:?tap\s*=\s*"onRetryLoad"/.test(w)) bad.push(`pages/${p}/${p}.wxml 无 onRetryLoad 重试入口——失败态成死胡同`)
        }
      }
      const cat = join(base, 'pages/catalog/catalog.ts')
      if (existsSync(cat) && !/'failed'/.test(stripComments(readFileSync(cat, 'utf8'))))
        bad.push("pages/catalog/catalog.ts 无 'failed' 态——课程目录网络失败仍伪装成「课程不存在」")
      const lib = join(base, 'lib/courses.ts')
      if (existsSync(lib) && !/getCourseByIdDetailed/.test(readFileSync(lib, 'utf8')))
        bad.push('lib/courses.ts 无 getCourseByIdDetailed——课程读取「网络失败」与「查无此课」在 lib 层就丢失区分度')
      // 取址 fetcher 已迁 lib/playbackCache.ts（批3 跨页取址预热·守卫 rw-mp-player-prefetch-cache）：FETCH_FAIL
      // 分流随 fetcher 迁到单例文件，断言目标随之移；player.ts 消费端仍按「非 NOT_ENTITLED 即 error」分流（无需字面量）。
      const fetcherHome = join(base, 'lib/playbackCache.ts')
      if (existsSync(fetcherHome) && !/FETCH_FAIL/.test(stripComments(readFileSync(fetcherHome, 'utf8'))))
        bad.push('lib/playbackCache.ts 取址 fetcher 无 FETCH_FAIL 分流——取址网络失败仍伪装成「视频还在整理中」且无重试（根因#14）')
      return bad
    },
  },
  {
    // 品牌启动 splash 必须有界自动消失（根因#8「构建过≠真机能用」的 UI 陷死变体）：冷启动盖在首页上的
    // 品牌开屏，撤场＝**min-hold 保底停留 + 数据就绪 race + 硬上限兜底**（2026-07-18 丝滑战役批2 拍板升级·
    // 前身 PR #34「纯计时器固定停留、不挂钩数据」有意识推翻）——过 min-hold 后父级 ready 即淡出、数据永不
    // 就绪则 HARD_CAP_MS 无条件撤场。风险＝有人把 setTimeout/triggerEvent 删了、home 侧忘把 done 收口成
    // showSplash=false、或只留 ready-race 却砍掉硬上限（弱网/云未部署数据永不就绪→splash 永久盖死首页），
    // 都是 build 全绿、真机才陷死（正是 #8）。故钉四点：① 组件 .ts 有 setTimeout 驱动的 triggerEvent('done')；
    // ② home.wxml 挂 <brand-splash bind:done>；③ home.ts 的 done 回调把 showSplash 置 false；④ 组件有
    // HARD_CAP_MS 硬上限常量并接线到 setTimeout（数据永不就绪也无条件撤场）。反向自检＝删组件里 HARD_CAP_MS
    // 的 setTimeout 接线行（→断言④红）。撤下 splash 请同删本守卫。
    id: 'rw-mp-splash-auto-dismiss',
    roots: ['#8'],
    desc: '品牌启动 splash 有界自动消失（根因#8 build 绿·真机陷死·撤场＝min-hold+数据就绪 race+硬上限）：brand-splash.ts 须有 setTimeout 驱动的 triggerEvent(\'done\') 且有 HARD_CAP_MS 硬上限常量接线 setTimeout（数据永不就绪也无条件撤场）；home.wxml 须挂 <brand-splash bind:done>（经 ready 传数据就绪）；home.ts 须在回调置 showSplash=false——防计时器/回调/硬上限一断即永久盖死首页',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return [] // 重写线未建时不红
      const bad = []
      const compRel = 'rewrite/mp/components/brand-splash/brand-splash.ts'
      const comp = join(ROOT, compRel)
      if (!existsSync(comp)) {
        bad.push(`${compRel} 缺失——品牌启动 splash 组件不在（若已撤下 splash，请同删本守卫·治「守一个不存在的东西」）`)
        return bad
      }
      const src = stripComments(readFileSync(comp, 'utf8'))
      if (!/setTimeout\s*\(/.test(src) || !/triggerEvent\(\s*['"]done['"]/.test(src))
        bad.push(`${compRel} 未见 setTimeout 驱动的 triggerEvent('done')——splash 须计时器有界自撤，否则一断即永久盖死首页（根因#8 build 绿·真机陷死）`)
      // 断言④（批2 升级）：HARD_CAP_MS 硬上限须声明且接线到 setTimeout——只留 ready-race 的话，数据永不就绪
      // （弱网/云未部署）时 splash 会永久盖死首页（根因#8）；硬上限＝数据不就绪也无条件撤场的兜底。
      // HARD_CAP_MS 改名须同步本判据（组件内注释亦有此提示）。setTimeout(...,HARD_CAP_MS) 走非贪婪跨回调体匹配。
      if (!/HARD_CAP_MS\s*=/.test(src))
        bad.push(`${compRel} 未见 HARD_CAP_MS 常量——splash 缺「数据永不就绪」的硬上限兜底（根因#8·只留 ready-race 会永久盖死首页）`)
      else if (!/setTimeout\([\s\S]*?,\s*HARD_CAP_MS\s*\)/.test(src))
        bad.push(`${compRel} HARD_CAP_MS 未接线到 setTimeout——硬上限没有真正驱动撤场（根因#8·数据不就绪即永久盖死首页）`)
      const homeWxmlRel = 'rewrite/mp/pages/home/home.wxml'
      const homeTsRel = 'rewrite/mp/pages/home/home.ts'
      const wxml = existsSync(join(ROOT, homeWxmlRel)) ? readFileSync(join(ROOT, homeWxmlRel), 'utf8') : ''
      const ts = existsSync(join(ROOT, homeTsRel)) ? stripComments(readFileSync(join(ROOT, homeTsRel), 'utf8')) : ''
      if (!/brand-splash/.test(wxml) || !/bind:done\s*=/.test(wxml))
        bad.push(`${homeWxmlRel} 未挂 <brand-splash bind:done>——splash 的 done 事件没有收口出口（根因#8）`)
      if (!/showSplash\s*:\s*false/.test(ts))
        bad.push(`${homeTsRel} done 回调未见 setData showSplash=false——splash 发了 done 也没人撤（根因#8）`)
      return bad
    },
  },
  {
    // tab 栈底页误触退出提醒（决策§30·2026-07-14 16-agent 研究定论·根因#8/#10 翻烧饼变体）：tabBar 三页
    // （home/cart/me）是页面栈底，安卓实体返回键＝直接退出小程序，误触即丢会话。唯一可行机制＝隐形
    // <page-container> 武装拦第一次返回 →「再按一次退出」（拦返回看「本页有无武装容器」、与栈深无关）。
    // wx.enableAlertBeforeUnload 对本用途**判废**（双死因：它是 page-return-only 语义 + 本 app
    // navigationStyle:custom 藏掉了它要挂的原生返回按钮 → 栈底页永远不弹·仓内 2026-06-14 真机存档为证）。
    // 仓史三次翻烧饼皆因 devtools 里 page-container 显示不工作（只真机生效·根因#10）造成假阴性，故焊死：
    // ① 三页 wxml 各有 <page-container> 且绑 bindbeforeleave（武装态由 ts 驱动）；
    // ② 三页 wxml 有纵向 <scroll-view scroll-y>——武装的 page-container 给 Page 注入 position:fixed 冻结
    //    页面级滚动（overlay=false 不解此锁），内容不套 scroll-view 则真机整页滚不动（build 全绿·正是 #8）；
    // ③ 三页 ts 接线 utils/exitGuard 三件套（arm/beforeleave/release·病根#5 单源·release 缺失即定时器泄漏）；
    // ④ rewrite/mp 源内（tests 除外）不得回潮 enableAlertBeforeUnload——判废机制，防旧分支合并/样板复制带回；
    // ⑤ 三页 json 不得开 enablePullDownRefresh——页面级下拉在 position:fixed 下失效，须改 scroll-view
    //    refresher-enabled（否则真机下拉刷新静默消失·又一个 build 绿真机死的 #8）。
    // 日后若用户要撤掉退出提醒：先改决策§30 再退役本守卫（删与加对等，见 refactor-batch step 4），不许绕。
    id: 'rw-mp-tabbar-exit-guard',
    roots: ['#8', '#10'],
    desc: 'tab 栈底页误触退出提醒焊死（决策§30·根因#8/#10）：home/cart/me 三页 wxml 须各有绑 bindbeforeleave 的 <page-container> + 纵向 <scroll-view scroll-y>（武装态注入 position:fixed 冻结页面滚动·不套即真机死锁），ts 须接线 utils/exitGuard 三件套（armExitGuard/onExitGuardBeforeLeave/releaseExitGuard），json 不得开 enablePullDownRefresh（fixed 下失效·须走 refresher-enabled）；rewrite/mp 源内不得回潮已判废的 wx.enableAlertBeforeUnload',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return [] // 重写线未建时不红
      const bad = []
      for (const name of ['home', 'cart', 'me']) {
        const wxmlRel = `rewrite/mp/pages/${name}/${name}.wxml`
        const tsRel = `rewrite/mp/pages/${name}/${name}.ts`
        const jsonRel = `rewrite/mp/pages/${name}/${name}.json`
        if (!existsSync(join(ROOT, wxmlRel)) || !existsSync(join(ROOT, tsRel))) {
          bad.push(`${wxmlRel} / ${tsRel} 缺失——tabBar 三页是退出提醒作用面（若 tabBar 结构已变，请同步本守卫）`)
          continue
        }
        const wxml = readFileSync(join(ROOT, wxmlRel), 'utf8')
        const ts = stripComments(readFileSync(join(ROOT, tsRel), 'utf8'))
        if (!/<page-container[\s\S]*?bindbeforeleave\s*=/.test(wxml))
          bad.push(`${wxmlRel} 未见带 bindbeforeleave 的 <page-container>——tab 栈底页误触退出提醒的唯一可行机制（决策§30·enableAlertBeforeUnload 已判废）`)
        if (!/<scroll-view[^>]*scroll-y/.test(wxml))
          bad.push(`${wxmlRel} 未见纵向 <scroll-view scroll-y>——武装的 page-container 注入 position:fixed 冻结页面级滚动，内容不套 scroll-view 则真机整页滚不动（根因#8 build 绿·真机死锁）`)
        // 剥掉 import 语句再断言「调用/定义」形式：否则删了调用点、光留 import 也算绿（反向自检 2026-07-18 实测
        // 漏过·同 E8「断言太宽松被绕过」）。三者都以 `名(` 出现：前两个是调用，onExitGuardBeforeLeave 是页面方法
        // 定义（wxml bindbeforeleave 绑的目标·真正的消费入口，实现体内调的是 consumeExitGuard 别名）。
        const tsBody = ts.replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
        for (const fn of ['armExitGuard', 'onExitGuardBeforeLeave', 'releaseExitGuard'])
          if (!tsBody.includes(`${fn}(`))
            bad.push(`${tsRel} 未接线 utils/exitGuard 的 ${fn}(——武装/消费/清理三件套缺一即提醒失效或定时器泄漏（病根#5 单源）`)
        if (existsSync(join(ROOT, jsonRel)) && /"enablePullDownRefresh"\s*:\s*true/.test(readFileSync(join(ROOT, jsonRel), 'utf8')))
          bad.push(`${jsonRel} 开着 enablePullDownRefresh——页面级下拉在 page-container 注入的 position:fixed 下静默失效，须改 <scroll-view refresher-enabled>（根因#8）`)
        // 迁到 refresher 的连带闭环（pull-refresh-stops ③ 在新线的翻版·因退出提醒才被迫迁，故守在这条）：
        // 开了 refresher-enabled 就必须绑 bindrefresherrefresh + refresher-triggered，且收起动作走 finally
        // ——回调/受控位漏一个即下拉圈永远转下去、再也刷不动，且只有真机看得见（根因#8）。
        if (/refresher-enabled/.test(wxml)) {
          for (const attr of ['bindrefresherrefresh', 'refresher-triggered'])
            if (!new RegExp(attr).test(wxml))
              bad.push(`${wxmlRel} 用了 refresher-enabled 却未绑 ${attr}——下拉圈会转个不停、再也刷不动（根因#8 真机才暴露）`)
          if (!/finally\s*\{[^}]*refreshing\s*:\s*false/.test(ts))
            bad.push(`${tsRel} 下拉刷新的收起动作不在 finally 里——reload 抛异常即下拉圈永远转下去（根因#8·同 pull-refresh-stops ③）`)
        }
      }
      // ④ 判废机制防回潮：扫 rewrite/mp 全部 .ts（剥注释·tests 除外——测试要按名断言「不得出现」）
      const walk = (d) => {
        for (const e of lsScan(d)) {
          if (e === 'node_modules' || e === 'tests') continue
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (/\.ts$/.test(e) && /enableAlertBeforeUnload/.test(stripComments(readFileSync(p, 'utf8'))))
            bad.push(`${relative(ROOT, p)} 含 wx.enableAlertBeforeUnload——该 API 对 tab 栈底页永远不弹（决策§30 判废·双死因见守卫注释），退出提醒须走 <page-container>`)
        }
      }
      walk(base)
      return bad
    },
  },
  {
    // 电商漏斗埋点 + 强制更新 + 冷启动耗时（R41·上线前必埋钩子，运营与增长规划①「上线前必埋钩子——后补极贵」）：
    // mp 全仓曾零 getUpdateManager 接线（推支付类 hotfix 时老版本用户更新不下去）、电商主漏斗「浏览→加购→
    // 下单→支付」零埋点、冷启动耗时线上零数据——trackEvent 管道早已通用（服务端 type 自由字符串·零改动），
    // 缺的只是接线。触点表驱动（同 rw-mp-customer-service-wired/rw-mp-home-quick-add-real 范式）钉住七个
    // 漏斗触点各自真调对应 type/page；强更五段（getUpdateManager/onCheckForUpdate/onUpdateReady/
    // applyUpdate/onUpdateFailed）与 app.ts 两处接线（markLaunch/checkForUpdate）单独钉；冷启动
    // markLaunch/reportColdStart 单独钉。checkout.ts onSubmit 出现两条表项是刻意的（同一方法内两次不同
    // 调用，各自独立断言，不是共用一次判定）。
    id: 'rw-mp-funnel-tracked',
    roots: ['R41'],
    desc: '电商漏斗埋点+强制更新+冷启动耗时接线（R41）：home/detail/cart/checkout/paysuccess 七个 trackEvent 触点须真调对应 type/page；app.ts onLaunch 须调 markLaunch()+checkForUpdate()；utils/appUpdate.ts 须接线 wx.getUpdateManager 五段（getUpdateManager/onCheckForUpdate/onUpdateReady/applyUpdate/onUpdateFailed）；lib/coldStart.ts 须含 cold_start 上报，home.ts onReady() 须调 reportColdStart()',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      // ① 触点表驱动：七个漏斗埋点各自方法体须真调 trackEvent('type','page',…)
      const FUNNEL_TOUCHPOINTS = [
        { file: 'pages/home/home.ts', method: 'onAddProduct', type: 'add_to_cart', page: 'home' },
        { file: 'pages/detail/detail.ts', method: 'loadProduct', type: 'view_product', page: 'detail' },
        { file: 'pages/detail/detail.ts', method: 'onAddCart', type: 'add_to_cart', page: 'detail' },
        { file: 'pages/cart/cart.ts', method: 'onCheckout', type: 'checkout_start', page: 'cart' },
        { file: 'pages/checkout/checkout.ts', method: 'onSubmit', type: 'order_submit', page: 'checkout' },
        { file: 'pages/checkout/checkout.ts', method: 'onSubmit', type: 'order_success', page: 'checkout' },
        { file: 'pages/paysuccess/paysuccess.ts', method: 'onLoad', type: 'pay_success_view', page: 'paysuccess' },
      ]
      for (const tp of FUNNEL_TOUCHPOINTS) {
        const abs = join(base, tp.file)
        if (!existsSync(abs)) {
          bad.push(`${tp.file} 缺失（电商漏斗埋点触点·R41）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        const body = methodBody(src, tp.method)
        if (!body) {
          bad.push(`${tp.file} 找不到 ${tp.method}() 方法体——电商漏斗埋点触点单点丢失（R41）`)
          continue
        }
        const re = new RegExp(`trackEvent\\(\\s*['"]${tp.type}['"]\\s*,\\s*['"]${tp.page}['"]`)
        if (!re.test(stripComments(body)))
          bad.push(`${tp.file} 的 ${tp.method}() 未调 trackEvent('${tp.type}','${tp.page}',…)——电商漏斗埋点缺失（R41）`)
      }
      // ② 强更接线：app.ts onLaunch 须调 markLaunch()+checkForUpdate()；utils/appUpdate.ts 须接线五段
      const appPath = join(base, 'app.ts')
      if (!existsSync(appPath)) {
        bad.push('app.ts 缺失（强更/冷启动接线·R41）')
      } else {
        const appBody = methodBody(readFileSync(appPath, 'utf8'), 'onLaunch')
        if (!appBody) {
          bad.push('app.ts 找不到 onLaunch() 方法体——强更/冷启动接线单点丢失（R41）')
        } else {
          const appBodyClean = stripComments(appBody)
          if (!/markLaunch\s*\(/.test(appBodyClean)) bad.push('app.ts 的 onLaunch() 未调 markLaunch()——冷启动计时起点缺失（R41）')
          if (!/checkForUpdate\s*\(/.test(appBodyClean)) bad.push('app.ts 的 onLaunch() 未调 checkForUpdate()——强制更新未接线（R41）')
        }
      }
      const updPath = join(base, 'utils/appUpdate.ts')
      if (!existsSync(updPath)) {
        bad.push('utils/appUpdate.ts 缺失——强制更新未实现（R41）')
      } else {
        const updSrc = stripComments(readFileSync(updPath, 'utf8'))
        for (const name of ['getUpdateManager', 'onCheckForUpdate', 'onUpdateReady', 'applyUpdate', 'onUpdateFailed'])
          if (!new RegExp(name + '\\s*\\(').test(updSrc)) bad.push(`utils/appUpdate.ts 未见 ${name}(——强更事件链缺一环（R41）`)
      }
      // ③ 冷启动：lib/coldStart.ts 须含 cold_start 上报，home.ts onReady() 须调 reportColdStart()
      const coldPath = join(base, 'lib/coldStart.ts')
      if (!existsSync(coldPath)) {
        bad.push('lib/coldStart.ts 缺失——冷启动耗时上报未实现（R41）')
      } else if (!/trackEvent\(\s*['"]cold_start['"]/.test(stripComments(readFileSync(coldPath, 'utf8')))) {
        bad.push("lib/coldStart.ts 未见 trackEvent('cold_start',…)——冷启动耗时未上报（R41）")
      }
      const homePath = join(base, 'pages/home/home.ts')
      if (!existsSync(homePath)) {
        bad.push('pages/home/home.ts 缺失（冷启动上报挂点·R41）')
      } else {
        const readyBody = methodBody(readFileSync(homePath, 'utf8'), 'onReady')
        if (!readyBody) bad.push('pages/home/home.ts 找不到 onReady() 方法体——冷启动上报挂点缺失（R41）')
        else if (!/reportColdStart\s*\(/.test(stripComments(readyBody)))
          bad.push('pages/home/home.ts 的 onReady() 未调 reportColdStart()——冷启动耗时未上报（R41）')
      }
      return bad
    },
  },
  {
    // 品牌字体分层子集覆盖（字体分层批·根因#8「构建过≠真机能用」的文案漂移变体）：mp 上屏文案随迭代
    // 只增不减，而字体子集是离线构建产物（源 OTF 84MB 不入仓）——新增文案若带来子集外新字，build 照常
    // 全绿、真机该字静默掉回系统字体（单字版 FOUT 永不结束）。守两条包含关系（推导逻辑与构建脚本共用
    // 单源 scripts/lib/brand-font-charset.mjs·病根#5 不各写各的）：
    // ① 推导 tier1（tab 首屏闭包+seed 标题）⊆ 已提交 assets/brand-fonts/tier1.txt——顺带机器锁
    //    「me.ts 直引 lib/mapMe、不得把 mapPages 法务长文拖回首屏闭包」（拖回即 tier1 溢出咬红）；
    // ② 推导三层并集 ⊆ 三个 txt 并集——任何上屏字必有层，不许静默无家。
    // 红了怎么修：BRAND_FONT_SRC=<源OTF目录> node scripts/build-brand-font.mjs 重建（txt 与 6 个 woff
    // 一起换，脚本不允许只改 txt 不建 woff），提交产物并把 woff 重新部署到托管 /fonts/（README 部署节）。
    id: 'rw-mp-font-tier-subset-covers',
    roots: ['#8'],
    desc: '品牌字体分层子集覆盖上屏字（字体分层批·根因#8）：deriveTierCharsets 推导 tier1 ⊆ assets/brand-fonts/tier1.txt 且三层并集 ⊆ 三 txt 并集——新增文案带来子集外新字即红（真机该字静默掉系统字体）；红了跑 BRAND_FONT_SRC=<源OTF> node scripts/build-brand-font.mjs 重建 + 重新部署托管 /fonts/',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return [] // 重写线未建时不红
      const bad = []
      const dir = join(ROOT, 'assets/brand-fonts')
      const readSet = (f) => (existsSync(join(dir, f)) ? new Set([...readFileSync(join(dir, f), 'utf8')]) : null)
      const t1 = readSet('tier1.txt')
      const t2 = readSet('tier2.txt')
      const t3 = readSet('tier3.txt')
      if (!t1 || !t2 || !t3) {
        bad.push('assets/brand-fonts/tier{1,2,3}.txt 缺失——分层子集字符集未提交（BRAND_FONT_SRC=<源OTF> node scripts/build-brand-font.mjs 重建后提交）')
        return bad
      }
      const derived = deriveTierCharsets(ROOT)
      const miss1 = [...derived.tier1].filter((c) => !t1.has(c))
      if (miss1.length)
        bad.push(`tab 首屏上屏字有 ${miss1.length} 个不在 tier1 子集（${miss1.slice(0, 12).join('')}${miss1.length > 12 ? '…' : ''}）——真机将掉系统字体；跑 BRAND_FONT_SRC=<源OTF> node scripts/build-brand-font.mjs 重建并重新部署 /fonts/`)
      const union = new Set([...t1, ...t2, ...t3])
      const missAll = [...derived.tier1, ...derived.tier2].filter((c) => !union.has(c))
      if (missAll.length)
        bad.push(`上屏字有 ${missAll.length} 个不在任何层子集（${missAll.slice(0, 12).join('')}${missAll.length > 12 ? '…' : ''}）——新增文案带来子集外新字；跑 BRAND_FONT_SRC=<源OTF> node scripts/build-brand-font.mjs 重建并重新部署 /fonts/`)
      return bad
    },
  },
  {
    // mp 分发前置（SEO/GEO·决策§29·R29 rewrite 线承接）：旧线 detail-share-wired 只扫 packages/，
    // rewrite/mp 曾整线零转发钩子（README 记账债）。守三件：① 公开页 home/detail 双钩子
    // （onShareAppMessage+onShareTimeline）在——没有钩子的页微信默认禁转发，公开页禁转发=分发面自断；
    // ② detail 分享路径必须带 ?id=（否则收到的人打开空详情）；③ sitemap.json 不得整站 disallow *
    // 兜头关（须至少 allow home）——搜一搜收录是分发面的机器半边。私有页（交易/学习/隐私）刻意不加
    // 钩子＝默认不可转发，正是想要的行为，不在守卫面内。
    id: 'rw-mp-share-wired',
    roots: ['R29'],
    desc: 'mp 分发前置（决策§29）：home.ts/detail.ts 须有 onShareAppMessage+onShareTimeline；detail 分享路径须带 pages/detail/detail?id=；sitemap.json 须至少 allow pages/home/home（不得整站 disallow 兜头关）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      for (const p of ['home', 'detail']) {
        const f = join(base, `pages/${p}/${p}.ts`)
        if (!existsSync(f)) continue
        const src = stripComments(readFileSync(f, 'utf8'))
        for (const hook of ['onShareAppMessage', 'onShareTimeline']) {
          if (!new RegExp(`${hook}\\s*\\(`).test(src)) bad.push(`pages/${p}/${p}.ts 缺 ${hook}——公开页无转发钩子＝微信默认禁转发（分发面自断·决策§29）`)
        }
        if (p === 'detail' && !/pages\/detail\/detail\?id=/.test(src))
          bad.push('detail.ts 分享路径未带 pages/detail/detail?id=——收到分享的人打开的是空详情')
      }
      const smPath = join(base, 'sitemap.json')
      if (existsSync(smPath)) {
        const rules = (JSON.parse(readFileSync(smPath, 'utf8')).rules || [])
        const allowsHome = rules.some((r) => r.action === 'allow' && r.page === 'pages/home/home')
        if (!allowsHome) bad.push('sitemap.json 未 allow pages/home/home——搜一搜收录兜头关（决策§29 已放开公开页，回关须先改决策）')
      }
      return bad
    },
  },
  {
    // 客服触点真实化（重写线 rewrite/mp·承旧线 customer-service-wired 所标病根 R18）：批A 建了
    // utils/customerService.ts 单源 helper，但 detail.ts 的 onService() 当场仍是假占位
    // wx.showToast('正在接入客服…')——旧线守卫早已判定这句假 Toast 绝迹，新线却原样重现（复制漂移同源）。
    // 触点表驱动（一张表+一条守卫范式，防新增触点各自为政）：批次C 触点扩面 2→4，收口 detail/onService、
    // player/onHelp、me/onKefu、aftersales/onKefu 四点（2026-07-08 用户拍板）。
    // 播放器重设计战役批D（2026-07-11）：player.ts 求助钮改拉起求助面板（onHelp 不再直连客服），真客服
    // 调用移入面板卡1 onHelpContact——触点表同批改写（onHelp→onHelpContact），wxml 上 bind:tap="onHelp"
    // 节点原样保留（rw-mp-player-immersive 钉的是节点存在，与方法体内调用什么无关）。
    id: 'rw-mp-customer-service-wired',
    roots: ['R18'],
    desc: '客服触点真实化（rewrite/mp）：① 全目录禁「正在接入客服」假 Toast 绝迹（同旧线 customer-service-wired 判定的假占位家族）② 触点表驱动——detail.ts 的 onService()、player.ts 的 onHelpContact()、me.ts 的 onKefu()、aftersales.ts 的 onKefu() 方法体须真调 openCustomerService()，防触点各自散接/漏接',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      // 断言A：全目录假 Toast 绝迹
      const walkAll = (d) => {
        const out = []
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) out.push(...walkAll(p))
          else out.push(p)
        }
        return out
      }
      for (const f of walkAll(base)) {
        if (!/\.(ts|wxml)$/.test(f)) continue
        if (readFileSync(f, 'utf8').includes('正在接入客服'))
          bad.push(`${relative(base, f)} 仍有「正在接入客服」假 Toast——客服触点未真接通（R18 复制漂移同源）`)
      }
      // 断言B：触点表驱动——每个触点方法体内须真调 openCustomerService()
      const TOUCHPOINTS = [
        { file: 'pages/detail/detail.ts', method: 'onService' },
        { file: 'pages/player/player.ts', method: 'onHelpContact' },
        { file: 'pages/me/me.ts', method: 'onKefu' },
        { file: 'pages/aftersales/aftersales.ts', method: 'onKefu' },
      ]
      for (const tp of TOUCHPOINTS) {
        const abs = join(base, tp.file)
        if (!existsSync(abs)) {
          bad.push(`${tp.file} 缺失（客服触点·R18）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        const body = methodBody(src, tp.method)
        if (!body) {
          bad.push(`${tp.file} 找不到 ${tp.method}() 方法体——客服触点单点丢失（R18）`)
          continue
        }
        // 剥离注释再测试（防「真调用换成注释引用+假 Toast」假咬合——同本文件其它「非注释」守卫防御写法，如 1151 行）
        if (!/openCustomerService\s*\(/.test(stripComments(body)))
          bad.push(`${tp.file} 的 ${tp.method}() 未调 openCustomerService()——客服触点未真接通（R18）`)
      }
      return bad
    },
  },
  {
    // 首页「+」真加购（病根#6 假反馈泄漏家族·同 home-card-add-real 判定精神·2026-07-08 用户拍板改真加购）：
    // rewrite/mp home.ts 曾把 onAddProduct 接成 ping('已收藏 '+name) 假反馈——点了不进购物车。
    // 守卫锁 onAddProduct 真调 decideQuickAdd()（决策纯函数，见 lib/quickAdd.ts）+ 真调 cart.add()，
    // 且全目录禁「已收藏」假 toast 绝迹（剥注释防「真调用换成注释引用+假 toast」假咬合）。
    id: 'rw-mp-home-quick-add-real',
    roots: ['R29'],
    desc: '首页「+」加购真做事（rewrite/mp）：① 全目录禁「已收藏」假 Toast 绝迹 ② home.ts 的 onAddProduct() 方法体须真调 decideQuickAdd() 与 cart.add()，防加购按钮接成收藏占位（病根#6）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      const walkAll = (d) => {
        const out = []
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) out.push(...walkAll(p))
          else out.push(p)
        }
        return out
      }
      for (const f of walkAll(base)) {
        if (!/\.(ts|wxml)$/.test(f)) continue
        if (readFileSync(f, 'utf8').includes('已收藏'))
          bad.push(`${relative(base, f)} 仍有「已收藏」假 Toast——首页加购按钮未真接通（R29·病根#6）`)
      }
      const abs = join(base, 'pages/home/home.ts')
      if (!existsSync(abs)) {
        bad.push('pages/home/home.ts 缺失（首页加购触点·R29）')
        return bad
      }
      const src = readFileSync(abs, 'utf8')
      const body = methodBody(src, 'onAddProduct')
      if (!body) {
        bad.push('pages/home/home.ts 找不到 onAddProduct() 方法体——首页加购触点单点丢失（R29）')
        return bad
      }
      // 剥离注释再测试（防「真调用换成注释引用+假 Toast」假咬合——同 rw-mp-customer-service-wired 写法）
      const bodyNoComments = stripComments(body)
      if (!/decideQuickAdd\s*\(/.test(bodyNoComments))
        bad.push('pages/home/home.ts 的 onAddProduct() 未调 decideQuickAdd()——加购决策未走单源纯函数（R29）')
      if (!/cart\.add\s*\(/.test(bodyNoComments))
        bad.push('pages/home/home.ts 的 onAddProduct() 未调 cart.add()——加购按钮没真加购物车（R29·病根#6）')
      return bad
    },
  },
  {
    id: 'oldline-frozen',
    roots: ['铁律'],
    desc: '重写期旧线冻结（ADR §23 切换策略）：packages/ 五包在本仓是参照基线、字节级冻结——逐文件摘要须与 scripts/oldline-freeze.json 清单一致（防误改旧线以为生效：重写改动只进 rewrite/，线上止血走 next 仓）；确需有意识同步旧线时 node scripts/freeze-oldline.mjs 刷新清单并在提交信息写明缘由',
    run() {
      const manifest = 'scripts/oldline-freeze.json'
      const abs = join(ROOT, manifest)
      if (!existsSync(abs)) return [`${manifest} 缺失——旧线冻结清单未建（node scripts/freeze-oldline.mjs 生成）`]
      const expected = JSON.parse(readFileSync(abs, 'utf8')).files || {}
      const actual = oldlineDigest(ROOT)
      const changed = []
      const added = []
      const removed = []
      for (const [p, h] of Object.entries(actual)) {
        if (!(p in expected)) added.push(p)
        else if (expected[p] !== h) changed.push(p)
      }
      for (const p of Object.keys(expected)) if (!(p in actual)) removed.push(p)
      if (!changed.length && !added.length && !removed.length) return []
      const fmt = (label, arr) =>
        arr.length ? `${label} ${arr.length} 处：${arr.slice(0, 8).join('、')}${arr.length > 8 ? '…' : ''}` : ''
      const detail = [fmt('改动', changed), fmt('新增', added), fmt('删除', removed)].filter(Boolean).join('；')
      return [
        `packages/ 旧线已冻结（重写改动进 rewrite/、止血走 next 仓）——检测到 ${detail}。确属有意识同步：node scripts/freeze-oldline.mjs 刷新清单并在提交信息写明缘由`,
      ]
    },
  },
  {
    id: 'check-report-in-gates',
    roots: ['正册'],
    desc: '体检面板是守卫注册表的派生视图（防手抄清单漂移·病根#11 同款）：生成器在位且从 check-structure/check-conventions 两注册表 import（禁手抄守卫清单）、package.json 挂 report 脚本、派生性行为测试在位、产物目录 reports/ 不入库',
    run() {
      const bad = []
      const gen = 'scripts/check-report.mjs'
      const genAbs = join(ROOT, gen)
      if (!existsSync(genAbs)) return [`${gen} 缺失——体检面板生成器未建（npm run report 的载体）`]
      const src = readFileSync(genAbs, 'utf8')
      if (!/from\s+'\.\/check-structure\.mjs'/.test(src) || !/from\s+'\.\/check-conventions\.mjs'/.test(src))
        bad.push(`${gen} 未从两守卫注册表 import——面板必须单源派生，不许手抄守卫清单`)
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
      if (!/check-report\.mjs/.test(String(pkg.scripts?.report || '')))
        bad.push('package.json 缺 report 脚本（npm run report → 体检面板）')
      if (!existsSync(join(ROOT, 'tests/scripts/checkReport.test.js')))
        bad.push('tests/scripts/checkReport.test.js 缺失——面板派生性行为测试（守卫 check-report-derived）')
      if (!/^reports\/$/m.test(readFileSync(join(ROOT, '.gitignore'), 'utf8')))
        bad.push('.gitignore 缺 reports/ ——体检面板产物不入库')
      return bad
    },
  },
  {
    // 控制台调色板单源（design/console.pen 落地·M3 UI 批1）：旧台 #c0392b 散写 36 处即
    // 病根#5「样板复制即漂移」在色值上的病征——色值一旦散写，换皮＝全仓 sed 碰运气。
    id: 'rw-admin-theme-single-source',
    roots: ['#5'],
    desc: '控制台调色板单源（design/console.pen 落地批1·病根#5 样板复制即漂移）：rewrite/admin/src 除 styles/ 外禁裸 hex 色值（纯黑白 #fff/#000 中性放行·注释行与 structure-ok 豁免），颜色一律 var(--ld-*)；styles/tokens.css 为唯一调色板定义地——换皮只改 token 文件',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/admin/src')
      if (!existsSync(base)) return bad
      const NEUTRAL = new Set(['#fff', '#ffffff', '#000', '#000000'])
      const scan = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) {
            if (e === 'styles') continue
            scan(p)
          } else if (/\.(vue|ts|css)$/.test(e)) {
            const lines = readFileSync(p, 'utf8').split('\n')
            lines.forEach((line, i) => {
              if (/^(\/\/|\/\*|\*|<!--)/.test(line.trim())) return
              if (line.includes('structure-ok') || (i > 0 && lines[i - 1].includes('structure-ok'))) return
              const hits = (line.match(/#[0-9a-fA-F]{3,8}\b/g) || []).filter(
                (h) => !NEUTRAL.has(h.toLowerCase())
              )
              if (hits.length)
                bad.push(
                  `${relative(ROOT, p)}:${i + 1} 裸 hex ${hits.join(' ')}——颜色走 var(--ld-*)，调色板单源 rewrite/admin/src/styles/tokens.css（#5）`
                )
            })
          }
        }
      }
      scan(base)
      return bad
    },
  },
  {
    // 控制台药丸主按钮单源（design/console.pen 落地·收敛 UI 批1·病根#5 样板复制即漂移）：
    // 换皮期 23 页各手搓填充主按钮（.btn-primary/.act/.search-btn/.range-btn/.btn-run…），
    // 底色在 --ld-purple-ink↔--ld-brand 间漂移（Inspect 曾用 brand·余用 purple-ink）——同 theme-single-source
    // 的色值漂移，只是发生在按钮结构上。药丸填充主按钮样式此后单源在 components/ui/Button.vue，页面用 <UiButton>。
    // 本守卫扫 pages/（组件不在扫描面＝唯一合法处），命中「同规则块 border-radius:999px + 填充(purple-ink|brand)
    // + 白字 + cursor:pointer」即页面手搓药丸主按钮。圆角矩形整宽 CTA（radius≠999px·.confirm/.approve-btn）
    // 是另一原语、不在此列；刻意例外块内加 structure-ok（如 Cards 的 primary↔ghost 切换钮待 ghost 变体批）。
    id: 'rw-admin-btn-single-source',
    roots: ['#5'],
    desc: '控制台药丸主按钮单源（design/console.pen·收敛 UI 批1·病根#5 样板复制即漂移）：rewrite/admin/src/pages/*.vue 禁在 <style> 手搓填充药丸主按钮（同规则块 border-radius:999px + background:var(--ld-purple-ink|--ld-brand) + color:#fff/white + cursor:pointer）——样式单源在 components/ui/Button.vue，页面用 <UiButton>；圆角矩形整宽 CTA（radius≠999px）属另一原语不在此列，刻意例外块内加 structure-ok',
    run() {
      const bad = []
      const dir = join(ROOT, 'rewrite/admin/src/pages')
      if (!existsSync(dir)) return bad
      for (const f of lsScan(dir)) {
        if (!f.endsWith('.vue')) continue
        const css = readFileSync(join(dir, f), 'utf8')
        for (const seg of css.split('}')) {
          const bi = seg.lastIndexOf('{')
          if (bi < 0) continue
          const body = seg.slice(bi + 1)
          if (body.includes('structure-ok')) continue
          const fill = /background:\s*var\(--ld-(?:purple-ink|brand)\)/.test(body)
          const white = /color:\s*(?:#fff\b|#ffffff\b|white\b)/.test(body)
          const ptr = /cursor:\s*pointer/.test(body)
          const pill = /border-radius:\s*999px/.test(body)
          if (fill && white && ptr && pill) {
            const sel = seg.slice(0, bi).split('\n').pop().trim()
            bad.push(
              `rewrite/admin/src/pages/${f} 手搓药丸主按钮「${sel}」——填充主按钮走 <UiButton>（样式单源 components/ui/Button.vue·病根#5）`
            )
          }
        }
      }
      return bad
    },
  },
  {
    // 抽屉壳层 CSS 单源（批2 refactor·病根#5 样板复制即漂移）：Orders/Batches/Refunds 三页抽屉段
    // 并非整段一致（.drawer 本体宽度 420/400px、.drawer-oid/.drawer-bid 各页专属字段、.drawer-close
    // 圆角/disabled 态仅 Orders 有，均刻意保留页内），但 .drawer-mask / .drawer-head / .drawer-title /
    // @keyframes slidein 四块三页逐字节一致——同 .ld-thead 全局先例收敛进 styles/console.css 单源，
    // 三页删除这四块定义。本守卫逐块钉住不许再在页面 <style> 裸写这四块任一选择器/规则定义（防复辟，
    // 病根#5「样板复制即漂移」——只守其中一块会漏另外三块被裸写回页面的回归），同时
    // 反向核 console.css 必须四块齐全（防两头皆无假绿）。
    id: 'rw-admin-drawer-single-source',
    roots: ['#5'],
    desc: '抽屉壳层 CSS 单源（批2 refactor·病根#5）：rewrite/admin/src/pages/*.vue 不得出现 `.drawer-mask`/`.drawer-head`/`.drawer-title`/`@keyframes slidein` 任一选择器/规则定义（公共段单源 styles/console.css，各页 .drawer 尺寸差异等页面特有段仍留页内不动）；且 styles/console.css 须四块齐全（防两头皆无假绿）',
    run() {
      const bad = []
      const patterns = [
        [/\.drawer-mask\s*\{/, '.drawer-mask'],
        [/\.drawer-head\s*\{/, '.drawer-head'],
        [/\.drawer-title\s*\{/, '.drawer-title'],
        [/@keyframes\s+slidein\s*\{/, '@keyframes slidein'],
      ]
      const dir = join(ROOT, 'rewrite/admin/src/pages')
      if (existsSync(dir)) {
        for (const f of lsScan(dir)) {
          if (!f.endsWith('.vue')) continue
          const src = readFileSync(join(dir, f), 'utf8')
          for (const [re, label] of patterns) {
            if (re.test(src))
              bad.push(`rewrite/admin/src/pages/${f} 仍裸写 ${label} 选择器/规则定义——抽屉壳层公共段单源在 styles/console.css（病根#5）`)
          }
        }
      }
      const cssPath = join(ROOT, 'rewrite/admin/src/styles/console.css')
      const css = existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : ''
      for (const [re, label] of patterns) {
        if (!re.test(css))
          bad.push(`rewrite/admin/src/styles/console.css 缺 ${label} 定义——抽屉壳层公共段单源应在此（防两头皆无假绿）`)
      }
      return bad
    },
  },
  {
    // 危险 armed 态随数据刷新必须复位（批3 规格 bug sweep Round1·根因#8「构建过≠真能用」）：两步确认/
    // 危险动作的「已武装」态（confirmKey/confirmId/clearConfirmId/publishConfirm/runConfirm/pubConfirm…）
    // 若在 load()/reload() 类刷新函数里不复位，切标签/切课/切单/翻页/动作后自动刷新会让旧武装态残留在
    // 新数据上——重进同一行位/同一按钮位一击直发，不经二次确认（迭代I 曾出同款 P1 误删/误发）。本守卫钉
    // 住：文件内每个顶层 `const <名> = ref(...)` 声明（<名> 匹配 /confirm/i）的 armed ref，都必须被本
    // 文件内每个顶层 load*/reload* 函数体重置赋值 `<名>.value =`（=== / !== 比较不算复位）。方法体截取
    // 走 setupFnBody（花括号配对计数·不复用 methodBody——其逗号收尾启发式对 <script setup> 裸函数错抓，
    // 预审已证伪）；无 armed ref 的文件不检查（如 Fulfill.loadPrinted/ScmMaterials.loadLedger）。
    id: 'rw-admin-armed-reset-on-load',
    roots: ['#8'],
    desc: '危险 armed 态随数据刷新必须复位（批3 规格·根因#8）：rewrite/admin/src/pages/*.vue 内每个 armed ref（顶层 const <名>=ref(...)·名匹配 /confirm/i）须被本文件内每个顶层 load*/reload* 函数体重置赋值 <名>.value=（=== / !== 比较不算复位）——防切课/切单/切筛选/翻页后旧武装态残留、重进同一行位一击直发（迭代I 曾出同款 P1 误删/误发）',
    run() {
      const bad = []
      const dir = join(ROOT, 'rewrite/admin/src/pages')
      if (!existsSync(dir)) return bad
      for (const f of lsScan(dir)) {
        if (!f.endsWith('.vue')) continue
        const src = stripComments(readFileSync(join(dir, f), 'utf8'))
        const scriptMatch = src.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)
        if (!scriptMatch) continue
        const script = scriptMatch[1]
        const armedNames = [...script.matchAll(/^(?:export\s+)?const\s+(\w+)\s*=\s*ref(?:<[^>]*>)?\(/gm)]
          .map((m) => m[1])
          .filter((n) => /confirm/i.test(n))
        if (!armedNames.length) continue // 无 armed ref 的文件不检查
        const fnNames = [...script.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+((?:load|reload)\w*)\s*\(/gm)].map((m) => m[1])
        for (const fn of fnNames) {
          const body = setupFnBody(script, fn)
          if (!body) {
            bad.push(`rewrite/admin/src/pages/${f} 刷新函数 ${fn}() 花括号配对失败（setupFnBody 取不到函数体，源码可能损坏或声明形态超出识别范围）`)
            continue
          }
          for (const name of armedNames) {
            const resetRe = new RegExp('\\b' + name + '\\.value\\s*=(?!=)')
            if (!resetRe.test(body)) {
              bad.push(`rewrite/admin/src/pages/${f} 刷新函数 ${fn}() 未复位 armed ref「${name}」——切课/切单/切筛选/翻页后旧武装态残留、重进同一行位一击直发（P1·批3 规格）`)
            }
          }
        }
      }
      return bad
    },
  },
  {
    // 冒烟层接线（批次D·根因#8「构建过≠真机能用」的机器半边）：scripts/mp-smoke.cjs 存在且照抄
    // visual-check.cjs 已验证过的坑（connect→systemInfo 探活、disconnect 收尾而非 close）；
    // package.json 接线 smoke:mp；rewrite/mp/app.ts 有 onError/onUnhandledRejection 探针
    // （冒烟脚本 evaluate 读取取证「无新增未捕获异常」）。方法体检查走 methodBody/stripComments
    // 单源 helper，不裸写正则（执行者错题本 E1：裸写正则会咬到注释假绿）。
    id: 'mp-smoke-wired',
    roots: ['#8'],
    desc: '冒烟层接线（批次D·根因#8）：scripts/mp-smoke.cjs 存在且含 connect→systemInfo 探活与 disconnect 收尾模式；package.json scripts.smoke:mp 接线；rewrite/mp/app.ts 的 App({}) 含 onError 与 onUnhandledRejection 方法体（探针取证 + 真机排查·根因#14）——方法体检查须走 methodBody/stripComments 单源 helper（错题本 E1）',
    run() {
      const bad = []
      const smokePath = join(ROOT, 'scripts/mp-smoke.cjs')
      if (!existsSync(smokePath)) {
        bad.push('scripts/mp-smoke.cjs 缺失——冒烟层未接线（批次D·根因#8）')
      } else {
        const src = stripComments(readFileSync(smokePath, 'utf8'))
        if (!/\bconnect\s*\(/.test(src) || !/systemInfo\s*\(/.test(src))
          bad.push('scripts/mp-smoke.cjs 未见 connect→systemInfo 探活模式——照抄 visual-check.cjs 已验证过的僵尸端口坑防护（靠人:#10）')
        if (!/disconnect\s*\(/.test(src))
          bad.push('scripts/mp-smoke.cjs 未见 disconnect 收尾——close 会留 9420 僵尸监听（照抄 visual-check.cjs 坑史）')
      }
      const pkgPath = join(ROOT, 'package.json')
      const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {}
      if (pkg.scripts?.['smoke:mp'] !== 'node scripts/mp-smoke.cjs')
        bad.push('package.json scripts["smoke:mp"] 未接线到 node scripts/mp-smoke.cjs')
      const appTsPath = join(ROOT, 'rewrite/mp/app.ts')
      if (!existsSync(appTsPath)) {
        bad.push('rewrite/mp/app.ts 缺失——冒烟层错误探针无处挂（批次D）')
      } else {
        const appTs = readFileSync(appTsPath, 'utf8')
        for (const m of ['onError', 'onUnhandledRejection']) {
          const body = methodBody(appTs, m)
          if (!body) {
            bad.push(`rewrite/mp/app.ts 的 App({}) 找不到 ${m} 方法体——冒烟层错误探针缺失（批次D·根因#8/#14）`)
            continue
          }
          // 生产可观测半边（工业级完善批6·根因#14）：探针只进内存数组是开发期取证，真实用户设备上
          // 无人读取——全局兜底必须同时经 reportClientError（trackEvent 落云端 events）让线上崩溃可见。
          if (!/reportClientError\s*\(/.test(stripComments(body)))
            bad.push(`rewrite/mp/app.ts 的 ${m} 未调 reportClientError——全局错误只进内存数组，生产端不可观测（根因#14）`)
        }
        if (!/trackEvent\s*\(\s*'client_error'/.test(stripComments(appTs)))
          bad.push("rewrite/mp/app.ts 无 trackEvent('client_error') 上报出口——reportClientError 名存实亡（根因#14）")
      }
      return bad
    },
  },
  {
    // 加载提速·目录缓存单源（批A·病根#15 加载链路冗余云调用·2026-07-09 加载审计+实测）：单次
    // wx.cloud.callFunction 往返实测 0.7-1.4s，跨页共享的静态目录数据（商品/课程）本该像 lib/catalog.ts
    // 已立的缓存范式（模块级 let cache + prime + miss 兜底重拉）那样单源收口，此前 detail.ts/cart.ts 绕过
    // lib/catalog.ts 直调 api/catalog 的 getProducts，player.ts/me.ts/my-courses.ts 各自重拉 api/learning
    // 的 getCourses 无缓存——每处冗余调用多付一次真实往返。同批已改到绿：lib/courses.ts 新立（同款缓存
    // 范式），home/detail/cart/player/me/my-courses 六页接入缓存、不再直连 api 层；本守卫钉「页面层不得
    // 绕过 lib 缓存直取」这一不变量（三种绕过手法都咬：具名 import / callApp 字面量）防止复发；
    // stripComments 先剥注释防「同款字符串只是注释提及」误咬（防假红，非错题本 E1 场景但同精神）。
    id: 'rw-mp-catalog-cache-single-source',
    roots: ['#15'],
    desc: '目录数据会话缓存单源（rewrite/mp·病根#15）：页面层禁绕过 lib 缓存直取商品/课程列表——禁 import 语句从 api/catalog 引入 getProducts、从 api/learning 引入 getCourses，禁 callApp(\'getProducts\')/callApp(\'getCourses\') 字面量出现在 api 层以外；商品缓存单源 lib/catalog.ts、课程缓存单源 lib/courses.ts（及 api/**、tests/** 本体豁免）',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      const EXCLUDE_FILES = new Set(['lib/catalog.ts', 'lib/courses.ts'])
      const walk = (d, relDir) => {
        const out = []
        for (const e of lsScan(d)) {
          if (relDir === '' && (e === 'api' || e === 'tests')) continue
          const p = join(d, e)
          if (statSync(p).isDirectory()) out.push(...walk(p, relDir + e + '/'))
          else out.push(p)
        }
        return out
      }
      for (const f of walk(base, '')) {
        if (!f.endsWith('.ts')) continue
        const rel = relative(base, f)
        if (EXCLUDE_FILES.has(rel)) continue
        const src = stripComments(readFileSync(f, 'utf8'))
        const importsProducts = /import\s*\{[^}]*\bgetProducts\b[^}]*\}\s*from\s*['"][^'"]*api\/catalog['"]/.test(src)
        const importsCourses = /import\s*\{[^}]*\bgetCourses\b[^}]*\}\s*from\s*['"][^'"]*api\/learning['"]/.test(src)
        const rawCall = /callApp\s*\(\s*['"](?:getProducts|getCourses)['"]\s*\)/.test(src)
        if (importsProducts || importsCourses || rawCall)
          bad.push(`${rel} 绕过缓存直取商品/课程列表——目录数据会话缓存单源（病根#15，商品走 lib/catalog.ts、课程走 lib/courses.ts）`)
      }
      return bad
    },
  },
  {
    // 加载提速·内容图 lazy-load 接线（批B·病根#15 图片面·2026-07-09）：全仓 wxml 零 lazy-load，
    // 折叠线以下/列表内的内容图（CMS 图、买家秀晒图、推荐位、订单缩略图）进页即与首屏抢并发下载带宽。
    // 接线表驱动（同 rw-mp-customer-service-wired 范式）：逐点位钉「class 定位的 <image> 标签」必须
    // 同时带 lazy-load 且仍绑定期望的 src 表达式——点位消失（被删/改名）与 src 漂移（换绑别的字段而
    // 表未同步）都判红，防「删图/改绑」假绿；lazy-load 缺席（未接线）判红。
    // 刻意排除（不进表，各有明确理由）：① 首屏 hero（home.wxml:5 ld-hero-photo）——首屏图不该延迟；
    // ② 横向 scroll-view 内的图（home.wxml 商品轨 ld-prod-media-img / 买家秀轨 ld-review-media-img；
    // detail.wxml swiper 画廊）——lazy-load 在 scroll-x 容器内不生效（真机验证过的坑）；
    // ③ 图标/静态资源（/static/icons/*.svg、logo）——非内容图，不吃带宽大头；
    // ④ detail 图册 swiper-item（detail.wxml:7 pdp-hero）——另立 current±1 窗口渲染收口，不与本守卫重叠。
    id: 'rw-mp-image-lazy-wired',
    roots: ['#15'],
    desc: '内容图 lazy-load 接线（rewrite/mp·病根#15 图片面）：接线表列出的每个内容图点位（home 特写图/拆门槛图/收尾图、reviews 晒图、detail 推荐位、order/order-list 缩略图）须带 lazy-load 且仍绑定期望 src 表达式，防未接线/被删改假绿',
    run() {
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return []
      const bad = []
      // 定位形如 <image ... class="cls" ... /> 的完整标签文本（从 class 属性向前找最近 <image、
      // 向后找最近 />，兼容属性任意顺序与多行书写——同 methodBody 的「找边界」精神，未引入新范式）。
      const findImageTagByClass = (src, cls) => {
        const clsIdx = src.indexOf(`class="${cls}"`)
        if (clsIdx === -1) return null
        const tagStart = src.lastIndexOf('<image', clsIdx)
        const tagEnd = src.indexOf('/>', clsIdx)
        if (tagStart === -1 || tagEnd === -1) return null
        return src.slice(tagStart, tagEnd + 2)
      }
      const POINTS = [
        { file: 'pages/home/home.wxml', cls: 'ld-feature-img', srcExpr: '{{content.feature.img}}', label: '首页特写图' },
        { file: 'pages/home/home.wxml', cls: 'ld-panel-media-img', srcExpr: '{{item.img}}', label: '首页拆门槛图' },
        { file: 'pages/home/home.wxml', cls: 'ld-closing-img', srcExpr: '{{content.closing.img}}', label: '首页收尾图' },
        { file: 'pages/reviews/reviews.wxml', cls: 'ld-rv-photo', srcExpr: '{{ph}}', label: '评价页晒图' },
        { file: 'pages/detail/detail.wxml', cls: 'pdp-rec-img', srcExpr: '{{item.cover}}', label: '详情页推荐位图' },
        { file: 'pages/order/order.wxml', cls: 'co-item-img', srcExpr: '{{item.cover}}', label: '订单详情缩略图' },
        { file: 'pages/order-list/order-list.wxml', cls: 'coolist-img', srcExpr: '{{line.cover}}', label: '订单列表缩略图' },
      ]
      for (const pt of POINTS) {
        const abs = join(base, pt.file)
        if (!existsSync(abs)) {
          bad.push(`${pt.file} 缺失——${pt.label}点位无处可查（病根#15）`)
          continue
        }
        const src = readFileSync(abs, 'utf8')
        const tag = findImageTagByClass(src, pt.cls)
        if (!tag) {
          bad.push(`${pt.file} 找不到 class="${pt.cls}" 的 <image> 标签——${pt.label}点位消失（被删/改名，表未同步，病根#15）`)
          continue
        }
        if (!tag.includes(`src="${pt.srcExpr}"`)) {
          bad.push(`${pt.file} 的 ${pt.cls} 图不再绑定 ${pt.srcExpr}——${pt.label}点位漂移（表未同步，病根#15）`)
          continue
        }
        if (!/\blazy-load\b/.test(tag))
          bad.push(`${pt.file} 的 ${pt.cls}（${pt.label}）未接 lazy-load——折叠线以下内容图与首屏抢并发下载带宽（病根#15）`)
      }
      return bad
    },
  },
  // —— 以下 3 条为旧线（packages/）repoCheck 的 rewrite/ 镜像（批1·治理重心搬到活代码线）——
  {
    id: 'rw-flow-seam-single',
    roots: ['#12'],
    desc: '平台接缝单点（根因#12 平台规则外部风险）镜像：cloudbase_module 工作流调用 rewrite/cloud/src 内仅 kit/flow.ts 一处（callFlow），平台规则变化改动面最小',
    run() {
      const root = join(ROOT, 'rewrite/cloud/src')
      if (!existsSync(root)) return []
      const allowed = 'rewrite/cloud/src/kit/flow.ts'
      const hits = []
      const walkDir = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (e === 'node_modules' || e === 'dist') continue
          if (statSync(p).isDirectory()) walkDir(p)
          else if (e.endsWith('.ts') && readFileSync(p, 'utf8').includes("'cloudbase_module'")) hits.push(relative(ROOT, p))
        }
      }
      walkDir(root)
      const out = []
      for (const h of hits) if (h !== allowed) out.push(`${h} 直调 cloudbase_module——接缝须收口 kit callFlow 单点（根因#12·rewrite 镜像）`)
      if (!hits.includes(allowed)) out.push(`${allowed} 应为 cloudbase_module 唯一调用点（callFlow），未见——接缝单点缺失（rewrite 镜像）`)
      return out
    },
  },
  {
    id: 'rw-cloud-domain-grouped',
    roots: ['T2'],
    desc: 'T2 域分组镜像：rewrite/cloud/src/functions 顶层不得有裸 .ts（函数须放进域子目录 adminApi/app/callbacks/cs/ops/timers）',
    run() {
      const dir = join(ROOT, 'rewrite/cloud/src/functions')
      if (!existsSync(dir)) return []
      const bad = []
      for (const entry of lsScan(dir)) {
        if (statSync(join(dir, entry)).isFile() && entry.endsWith('.ts')) {
          bad.push(`rewrite/cloud/src/functions/${entry} 在顶层——函数须放进域子目录（adminApi/app/callbacks/cs/ops/timers，T2·rewrite 镜像）`)
        }
      }
      return bad
    },
  },
  {
    // 钱链可观测告警接入（根因#14/#4）镜像：rewrite 钱链/SCM 动作类失败禁静默 console.error，
    // 一律经 kit/observe 的 alert()/notifyAlert() 单出口留痕（控制台 [LD_ALERT] 抓取）。
    // 剥注释单源（错题本 E1/E10）：console.error 检测须对 stripComments() 剥注释后的正文匹配，
    // 防真调用挪进注释仍误判命中、或护栏代码被注释掉断言仍绿。
    id: 'rw-moneychain-alert-wired',
    roots: ['#14', '#4'],
    desc: '钱链可观测告警接入（rewrite 镜像·病根#14/#4）：payCallback/refundCallback 须经 alert()/notifyAlert() 打 [LD_ALERT] 标记；钱链/SCM 动作类文件（refunds/orders/scmAssembly/scmPurchase/scmOutwork/scmMaterials + 两回调）剥注释后禁裸 console.error(——失败留痕走 kit observe 单出口，刻意静默须行内注明；kit/observe.ts 须导出 alert',
    run() {
      const bad = []
      const cbDir = 'rewrite/cloud/src/functions/callbacks'
      for (const f of ['payCallback.ts', 'refundCallback.ts']) {
        const rel = `${cbDir}/${f}`
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) {
          bad.push(`${rel} 缺失（钱链回调，根因#14）`)
          continue
        }
        if (!/\b(notifyAlert|alert)\(/.test(stripComments(readFileSync(abs, 'utf8'))))
          bad.push(`${rel} 未用 alert()/notifyAlert() 打钱链告警标记——静默语义失败无信号（根因#14 可观测·rewrite 镜像）`)
      }
      const moneyChainFiles = [
        'rewrite/cloud/src/functions/adminApi/actions/refunds.ts',
        'rewrite/cloud/src/functions/adminApi/actions/orders.ts',
        'rewrite/cloud/src/functions/adminApi/actions/scmAssembly.ts',
        'rewrite/cloud/src/functions/adminApi/actions/scmPurchase.ts',
        'rewrite/cloud/src/functions/adminApi/actions/scmOutwork.ts',
        'rewrite/cloud/src/functions/adminApi/actions/scmMaterials.ts',
        `${cbDir}/payCallback.ts`,
        `${cbDir}/refundCallback.ts`,
      ]
      for (const rel of moneyChainFiles) {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) continue // 部分 SCM 动作文件可能尚未落地，存在才查
        const strippedLines = stripComments(readFileSync(abs, 'utf8')).split('\n')
        strippedLines.forEach((line, i) => {
          if (/\bconsole\.error\s*\(/.test(line))
            bad.push(`${rel}:${i + 1} 剥注释后仍裸用 console.error(——动作类失败须经 kit observe.alert/notifyAlert 单出口留痕，禁静默吞（根因#14·rewrite 镜像）`)
        })
      }
      const obs = join(ROOT, 'rewrite/cloud/src/kit/observe.ts')
      if (!existsSync(obs) || !/export function alert/.test(readFileSync(obs, 'utf8')))
        bad.push('rewrite/cloud/src/kit/observe.ts 未导出 alert——钱链告警标记缺失（根因#14·rewrite 镜像）')
      return bad
    },
  },
  {
    // agent 是 admin client 的「同构小副本」（批3 规格·根因#5 同款坏味道在副本复发）：调色板/形状 token
    // 若字面量各抄一份，后续改主题只改 admin 侧的 tokens.css 会漏改 agent 侧的 App.vue :root，两处悄悄漂移
    // 没人发现。本守卫钉住同名 --ld-* 必须同值——admin tokens.css 里的纯别名（如 `--ld-purple: var(--ld-brand)`）
    // 解一层再比（agent 侧写的是字面量，不是 var() 引用，直接比较别名字符串必假红）。agent 允许只声明 admin 的
    // 子集（agent 用不到 admin 全部 token），但交集内每一个都必须同值；交集 <5 视为解析失败即红（防 :root 块
    // 结构改动后正则悄悄匹配不到、返回空 bad 假绿）。
    id: 'rw-agent-tokens-synced',
    roots: ['#5'],
    desc: 'agent/admin 同构副本 token 同步（批3 规格·病根#5）：rewrite/agent/src/App.vue `:root` 块内全部 `--ld-*` 与 rewrite/admin/src/styles/tokens.css 同名变量比对（admin 侧纯 var(--x) 别名解一层再比），同名必同值；同名交集 <5 视为解析失败即红（防结构改动假绿）',
    run() {
      const bad = []
      const parseRootVars = (src) => {
        const m = src.match(/:root\s*\{([\s\S]*?)\}/)
        if (!m) return null
        const map = {}
        for (const vm of m[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) map[vm[1]] = vm[2].trim()
        return map
      }
      const resolveVal = (map, name, depth = 0) => {
        const raw = map[name]
        if (raw === undefined || depth > 5) return raw
        const am = raw.match(/^var\(\s*--([\w-]+)\s*(?:,[^)]*)?\)$/)
        return am && map[am[1]] !== undefined ? resolveVal(map, am[1], depth + 1) : raw
      }
      const agentPath = join(ROOT, 'rewrite/agent/src/App.vue')
      const adminPath = join(ROOT, 'rewrite/admin/src/styles/tokens.css')
      if (!existsSync(agentPath) || !existsSync(adminPath)) {
        bad.push('rw-agent-tokens-synced：rewrite/agent/src/App.vue 或 rewrite/admin/src/styles/tokens.css 缺失——同步比对无法进行')
        return bad
      }
      const agentMap = parseRootVars(readFileSync(agentPath, 'utf8'))
      const adminMap = parseRootVars(readFileSync(adminPath, 'utf8'))
      if (!agentMap || !adminMap) {
        bad.push('rw-agent-tokens-synced：`:root { }` 块解析失败（App.vue 或 tokens.css 结构改动导致正则匹配不到，防假绿即红）')
        return bad
      }
      const sharedNames = Object.keys(agentMap).filter((n) => adminMap[n] !== undefined)
      if (sharedNames.length < 5) {
        bad.push(`rw-agent-tokens-synced：同名 --ld-* 交集仅 ${sharedNames.length} 个（<5 视为解析失败，防结构改动假绿）`)
        return bad
      }
      for (const name of sharedNames) {
        const agentVal = agentMap[name]
        const adminVal = resolveVal(adminMap, name)
        if (agentVal !== adminVal)
          bad.push(`rw-agent-tokens-synced：--${name} agent=${agentVal} ≠ admin=${adminVal}（同构副本同名须同值·病根#5，以 admin tokens.css 为准改 agent 侧）`)
      }
      return bad
    },
  },
  {
    // 批6（承重批·钱/权限）：admin 口令哈希从「sha256 无盐」升级为「salt+scrypt」，防库泄露离线彩虹表
    // 还原（根因#3 信任边界·根因#13 认证端点防爆破——频控只挡在线爆破，挡不住离线还原）。本守卫钉住
    // lib.ts 剥注释后（stripComments·E1/E10）确实含 scryptSync 与 keySalt 字样——纯字符串在场性检查，
    // 行为语义（legacy 无缝迁移/盐感知比对单源 keyMatches）由 app-admin1/app-admin6 测试锁。
    id: 'rw-admin-key-kdf',
    roots: ['#13', '#3'],
    desc: 'admin 口令加盐 KDF（批6·根因#13 认证端点防爆破/根因#3 信任边界）：adminApi/lib.ts 剥注释后须含 scryptSync（口令 KDF）与 keySalt（每账号随机盐字段），防 sha256 无盐口令库泄露被离线彩虹表还原；legacy 存量账号无感迁移语义由测试锁',
    run() {
      const bad = []
      const rel = 'rewrite/cloud/src/functions/adminApi/lib.ts'
      const abs = join(ROOT, rel)
      if (!existsSync(abs)) return [`${rel} 缺失`]
      const src = stripComments(readFileSync(abs, 'utf8'))
      if (!/scryptSync\s*\(/.test(src)) bad.push(`${rel} 未见 scryptSync(——口令哈希仍可能是无盐 sha256（根因#13 离线彩虹表风险）`)
      if (!/keySalt/.test(src)) bad.push(`${rel} 未见 keySalt 字段——口令未加盐（根因#13）`)
      return bad
    },
  },
  {
    // 播放器重设计战役批B 实录（2026-07-11）：helpbtn <view 开标签漏写 >，conventions/structure/typecheck/lint/test
    // 五道机器网全绿放行——WXML 语法损坏连微信编译器都过不了，但本仓机器闸对「标签配平」完全免疫（此前从未有
    // 守卫盯过 wxml 的标签语法本身，只盯属性/事件绑定字面量）。人工评审逮到后，批C 把这类缺陷机器化：轻量
    // 配平扫描（非完整 XML parser，够咬住「漏写 >／漏闭合标签」这族缺陷即可，勿过度工程——真实 XML 边角情形
    // 如 CDATA/命名空间/DOCTYPE 一律不认，wxml 语料里也不会出现）。
    id: 'rw-mp-wxml-well-formed',
    roots: ['#8'],
    desc: 'wxml 标签配平（播放器重设计战役批B 痛史：helpbtn <view 漏 > 五道机器网全绿放行，人工评审逮到）：扫 rewrite/mp/**/*.wxml（含 components/custom-tab-bar），剥 <!-- --> 注释后逐标签扫（属性引号内的 </> 字符跳过，防 wx:if="{{a<b}}" 类表达式误判），栈式配平开/闭标签（自闭合 /> 不入栈）——标签未找到终止的 >（漏写 > 或被下一个标签打断）、闭合标签与栈顶不符、文件末尾栈非空，均视为损坏即红；轻量配平非完整 XML parser，够咬住这族缺陷即可',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return bad
      const files = []
      const walk = (d) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walk(p)
          else if (e.endsWith('.wxml')) files.push(p)
        }
      }
      walk(base)
      for (const abs of files) {
        const rel = relative(ROOT, abs)
        const raw = readFileSync(abs, 'utf8')
        // 剥注释（保留换行数，行号仍对应原文件）：同 stripComments 的块注释处理手法（错题本 E1 同源思路）
        const src = raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
        const lineAt = (pos) => src.slice(0, pos).split('\n').length
        const stack = [] // { name, line }
        const n = src.length
        let i = 0
        while (i < n) {
          const lt = src.indexOf('<', i)
          if (lt < 0) break
          let j = lt + 1
          const closing = src[j] === '/'
          if (closing) j++
          const nameStart = j
          while (j < n && /[\w-]/.test(src[j])) j++
          const tagName = src.slice(nameStart, j)
          if (!tagName) {
            i = lt + 1 // 非标签的裸 '<'（如未加空格的表达式字面量），跳过一个字符继续扫
            continue
          }
          // 引号感知地扫到该标签自己的终止 '>'；扫描途中若遇到新的非引号内 '<'，说明当前标签根本没写 >
          let k = j
          let quote = null
          let selfClose = false
          let brokenAt = -1
          while (k < n) {
            const ch = src[k]
            if (quote) {
              if (ch === quote) quote = null
              k++
              continue
            }
            if (ch === '"' || ch === "'") {
              quote = ch
              k++
              continue
            }
            if (ch === '<') {
              brokenAt = k
              break
            }
            if (ch === '>') {
              selfClose = src[k - 1] === '/'
              break
            }
            k++
          }
          if (brokenAt >= 0 || k >= n) {
            bad.push(`${rel}:${lineAt(lt)} <${closing ? '/' : ''}${tagName}...> 未找到闭合 >（漏写 > 或标签被打断）——WXML 损坏，微信编译器过不了`)
            i = brokenAt >= 0 ? brokenAt : n // 从打断处继续扫，不吞掉后续真实标签；EOF 情形直接结束本文件
            continue
          }
          if (closing) {
            const top = stack[stack.length - 1]
            if (!top || top.name !== tagName)
              bad.push(`${rel}:${lineAt(lt)} 闭合标签 </${tagName}> 与栈顶${top ? `<${top.name}>（第 ${top.line} 行）` : '（空栈）'}不符——标签未正确闭合`)
            else stack.pop()
          } else if (!selfClose) {
            stack.push({ name: tagName, line: lineAt(lt) })
          }
          i = k + 1
        }
        for (const s of stack) bad.push(`${rel}:${s.line} <${s.name}> 未闭合（文件末尾栈非空）`)
      }
      return bad
    },
  },
  {
    // 批 B7（治病根#14 client-error 通道 web 半边）：admin/agent 两端 main.ts 此前零错误捕获——线上报错无声无痕。
    // 断言面＝源码文本扫描（不跑运行时，window.onerror/unhandledrejection 的真实 DOM 事件挂接交给 golden 测试，
    // node 环境无 window 全局测不了这层，见 rewrite/admin|agent/tests/errorReporter.test.ts 头注）。
    id: 'rw-web-error-reporter-wired',
    roots: ['#14'],
    desc: 'admin/agent 前端错误上报接线三件套（批 B7·治病根#14 client-error 通道 web 半边）：main.ts 须调用 installErrorReporter(；lib/errorReporter.ts 须同时含 window.onerror / unhandledrejection / errorHandler 三件套捕获 + hasSession( 会话闸判断（不许裸打未鉴权请求）+ reportClientError（真打到约定的服务端 action 名）——任一缺失分别报出具体文件+具体缺项',
    run() {
      const bad = []
      const pairs = [
        ['admin', 'rewrite/admin/src/main.ts', 'rewrite/admin/src/lib/errorReporter.ts'],
        ['agent', 'rewrite/agent/src/main.ts', 'rewrite/agent/src/lib/errorReporter.ts'],
      ]
      for (const [name, mainRel, libRel] of pairs) {
        const mainAbs = join(ROOT, mainRel)
        if (!existsSync(mainAbs)) {
          bad.push(`${mainRel} 缺失（${name} 端入口文件不存在）`)
        } else if (!/installErrorReporter\s*\(/.test(stripComments(readFileSync(mainAbs, 'utf8')))) {
          bad.push(`${mainRel} 未调用 installErrorReporter(——${name} 端错误上报器未装线`)
        }
        const libAbs = join(ROOT, libRel)
        if (!existsSync(libAbs)) {
          bad.push(`${libRel} 缺失（${name} 端错误上报器未建）`)
          continue
        }
        const libSrc = stripComments(readFileSync(libAbs, 'utf8'))
        if (!/window\.onerror/.test(libSrc)) bad.push(`${libRel} 未见 window.onerror 挂接`)
        if (!/unhandledrejection/.test(libSrc)) bad.push(`${libRel} 未见 unhandledrejection 挂接`)
        if (!/errorHandler/.test(libSrc)) bad.push(`${libRel} 未见 errorHandler 接管（Vue app.config.errorHandler）`)
        if (!/hasSession\s*\(/.test(libSrc)) bad.push(`${libRel} 未见 hasSession( 会话闸判断——不许裸打未鉴权请求`)
        if (!/reportClientError/.test(libSrc)) bad.push(`${libRel} 未见 reportClientError——未打到约定的服务端 action 名`)
      }
      return bad
    },
  },
]

// ============== 逐文件规则（fileRules）==============
// 形状：{ id, inScope(absPath)->bool, test(line, {file, lines, i})->msg|null }
// 按主张追加（B3 起：禁 #ifdef 多端回退、禁 api 运行时引 data/…）。
export const fileRules = [
  {
    // T2 域分组（根因账本 #5）：云函数业务代码禁裸用 cloud.init()/getWXContext()，
    // 身份/初始化一律经 kit（withOpenId/getDb/isServerCall）。kit 自身与类型声明放行。
    id: 'kit-only-cloud-primitives',
    roots: ['T2', '#5'],
    inScope: (abs) => abs.includes('/packages/cloud/src/functions/') && abs.endsWith('.ts'),
    test: (line) =>
      /\bcloud\.init\s*\(/.test(line) || /\bgetWXContext\s*\(/.test(line)
        ? '云函数业务代码禁裸用 cloud.init()/getWXContext()——经 kit（withOpenId/getDb/isServerCall）收编样板，防 28 份样板重生（T2/根因5）'
        : null,
  },
  {
    // 平台接缝收口（根因账本 #12）：触发工作流禁裸用 cloudbase_module——经 kit.callFlow 单点，
    // 平台规则变更时改动面最小。kit 自身放行（不在 functions 域）。
    id: 'flow-seam-via-kit',
    roots: ['#12'],
    inScope: (abs) => abs.includes('/packages/cloud/src/functions/') && abs.endsWith('.ts'),
    test: (line) =>
      /cloudbase_module/.test(line)
        ? '触发工作流禁裸用 cloudbase_module——经 kit.callFlow 单点收口（根因#12 平台接缝最小化）'
        : null,
  },
  {
    // 金额接 Fen 轨（根因账本 #4）：云函数里「元↔分」换算禁裸 *100 / /100——一律经 shared
    // toFen/asFen/fenToYuan（asFen 对非整数分抛错＝脏数据 tripwire；Fen 品牌类型随之咬到本函数）。
    // 病史：退款链（applyRefund/refundCallback/adminApi refunds）曾全手工 Math.round(*100) 绕过
    // 类型守卫——「守卫存在却覆盖有洞」（round-2 体检挖出，2026-06-14）。非金额的百分比 / 时间
    // 换算（getReviews 占比、*1000 毫秒）行内加 structure-ok。
    id: 'money-via-fen',
    roots: ['#4'],
    inScope: (abs) => abs.includes('/packages/cloud/src/functions/') && abs.endsWith('.ts'),
    test: (line) =>
      /(\*|\/)\s*100\b/.test(line)
        ? '金额「元↔分」换算禁裸 *100 / /100——经 shared toFen/asFen/fenToYuan（根因#4 Fen 接钱链，类型守卫才咬得到退款链）；非金额换算行内加 structure-ok'
        : null,
  },
  {
    // T1 砍多端（根因账本 #6）：api 层禁 import @/data/——api 只对接云（callCloud），
    // 不引样例数据＝不可能再造本地假数据回退。比正则抓 res===null 干净。
    id: 'api-cloud-only',
    roots: ['T1', '#6'],
    inScope: (abs) => abs.includes('/packages/miniapp/src/api/') && abs.endsWith('.js'),
    test: (line) =>
      /\bfrom\s+['"]@\/data\//.test(line) || /\brequire\(\s*['"]@\/data\//.test(line)
        ? 'api 层禁 import @/data/——api 只对接云，不引样例数据＝不可能再造本地假数据回退（T1/根因6）'
        : null,
  },
  {
    // T4 按链内聚（CLAUDE §8 依赖方向）：pages→store/api→utils，data/utils 是叶。禁反向 import。
    id: 'dep-direction',
    roots: ['T4'],
    inScope: (abs) =>
      /\/packages\/miniapp\/src\/(utils|data|api|store)\//.test(abs) && /\.(js|vue)$/.test(abs),
    test: (line, ctx) => {
      const f = ctx.file
      const layer = f.includes('/utils/')
        ? 'utils'
        : f.includes('/data/')
          ? 'data'
          : f.includes('/api/')
            ? 'api'
            : 'store'
      const banned = {
        utils: ['store', 'api', 'pages', 'components', 'data'],
        data: ['store', 'api', 'pages', 'components'],
        api: ['store', 'pages', 'components'],
        store: ['pages', 'components'],
      }[layer]
      const m = line.match(/from\s+['"]@\/(\w+)\//)
      return m && banned.includes(m[1])
        ? `依赖方向反转：${layer} 层禁 import @/${m[1]}/（pages→store/api→utils，data/utils 是叶；CLAUDE §8/T4）`
        : null
    },
  },
  // —— 以下 4 条为旧线（packages/）5 条守卫的 rewrite/ 镜像（批1·治理重心搬到活代码线）——
  // 旧线守卫扫描面锁死 packages/ 路径，对唯一在迭代的 rewrite/ 空转；本批不改旧条（继续守 packages/
  // 冻结基线），另立新条落地到 rewrite/。SRC_DIRS 已扩到含 'rewrite'（见下方 A.0），否则新条也是装饰。
  {
    // T2 域分组（根因账本 #5）镜像：rewrite/cloud 云函数业务代码禁裸用 cloud.init()/getWXContext()。
    id: 'rw-kit-only-cloud-primitives',
    roots: ['T2', '#5'],
    inScope: (abs) => abs.includes('/rewrite/cloud/src/functions/') && abs.endsWith('.ts'),
    test: (line) =>
      /\bcloud\.init\s*\(/.test(line) || /\bgetWXContext\s*\(/.test(line)
        ? '云函数业务代码禁裸用 cloud.init()/getWXContext()——经 kit（withOpenId/getDb/isServerCall）收编样板，防样板重生（T2/根因5·rewrite 镜像）'
        : null,
  },
  {
    // 平台接缝收口（根因账本 #12）镜像：触发工作流禁裸用 cloudbase_module——经 kit.callFlow 单点。
    id: 'rw-flow-seam-via-kit',
    roots: ['#12'],
    inScope: (abs) => abs.includes('/rewrite/cloud/src/functions/') && abs.endsWith('.ts'),
    test: (line) =>
      /cloudbase_module/.test(line)
        ? '触发工作流禁裸用 cloudbase_module——经 kit.callFlow 单点收口（根因#12 平台接缝最小化·rewrite 镜像）'
        : null,
  },
  {
    // 金额接 Fen 轨（根因账本 #4）镜像：云函数里「元↔分」换算禁裸 *100 / /100。非金额百分比/毫秒
    // 换算行内加 structure-ok（如 reviews.ts 星级占比 pct()）。
    id: 'rw-money-via-fen',
    roots: ['#4'],
    inScope: (abs) => abs.includes('/rewrite/cloud/src/functions/') && abs.endsWith('.ts'),
    test: (line) =>
      /(\*|\/)\s*100\b/.test(line)
        ? '金额「元↔分」换算禁裸 *100 / /100——经 shared toFen/asFen/fenToYuan（根因#4 Fen 接钱链·rewrite 镜像）；非金额换算行内加 structure-ok'
        : null,
  },
  {
    // T1 微信原生单源（根因账本 #6）镜像：mp 端禁裸 wx.request——核心交易流程只走云函数
    // （callCloud），不再造第二条 HTTP 直连路径。wx.requestPayment 是微信支付原生能力，不误中。
    id: 'rw-mp-cloud-only',
    roots: ['T1'],
    inScope: (abs) => abs.includes('/rewrite/mp/') && !abs.includes('/rewrite/mp/tests/') && abs.endsWith('.ts'),
    test: (line) =>
      /\bwx\.request\s*\(/.test(line)
        ? 'mp 端禁裸 wx.request()——H5/App 不连核心交易流程，微信原生单源经云函数 callCloud（T1·rewrite 镜像）'
        : null,
  },
  {
    // T4 按链内聚·活线镜像（盲区体检批2·病根#16 ② × Phase3 批I 合并融合）：旧 dep-direction 的 inScope
    // 锁死冻结 packages/miniapp——CLAUDE 四大架构主张之一在唯一迭代的活线上零执行。两条线（盲区体检批2 /
    // Phase3 批I）曾各自独立补活线镜像，合流时融合为一条严格强于两者的版本：
    //   · 骨架取盲区体检版——mp 分层表驱动（pages/components/custom-tab-bar → lib → api → utils 叶·出度 0，
    //     见 rewrite/mp/README §分层）+ rewrite/cloud kit 禁反向 import functions/ + tests 目录排除；
    //   · 加固取 Phase3 批I 版——探测正则并入 CommonJS `require('…')`（mp tsconfig module=CommonJS、无
    //     ESLint 兜底，只认 from 会留等价绕过口·E16 翻版）与反引号模板字面量（动态 import(`../lib/${x}`)
    //     的依赖前缀在插值前已定型、按前缀判仍正确）+ 先剥行尾注释（E1：注释里提路径不算）+ 扫描面补
    //     admin src/lib|api（禁引 ../pages/、../shell/）与 agent src/lib（禁引页面级 .vue）。
    // 存量违例 0（两线各自侦察实测一致）——纯预防守卫，先红由反向自检证。
    id: 'rw-dep-direction',
    roots: ['T4', '#16'],
    inScope: (abs) =>
      ((/\/rewrite\/mp\/(lib|api|utils)\//.test(abs) && !abs.includes('/rewrite/mp/tests/')) ||
        /\/rewrite\/cloud\/src\/kit\//.test(abs) ||
        /\/rewrite\/admin\/src\/(lib|api)\//.test(abs) ||
        /\/rewrite\/agent\/src\/lib\//.test(abs)) &&
      abs.endsWith('.ts'),
    test: (line, ctx) => {
      const code = line.replace(/\/\/.*$/, '') // 剥行尾注释再匹配（E1：注释里提到路径不算）
      const m = code.match(/(?:from|import|require)\s*\(?\s*['"`]([^'"`]+)['"`]/)
      if (!m) return null
      const spec = m[1]
      const f = ctx.file.replace(/\\/g, '/')
      if (f.includes('/rewrite/cloud/src/kit/')) {
        return /(^|\.\.?\/)functions\//.test(spec)
          ? 'kit 禁 import functions/——kit 是原语层，反向引用=依赖方向反转（T4·活线）'
          : null
      }
      if (/\/rewrite\/admin\/src\/(lib|api)\//.test(f)) {
        return /\.\.\/pages\//.test(spec) || /\.\.\/shell\//.test(spec)
          ? `依赖方向反转：admin lib/api 禁 import ${spec}——数据/接口层不得依赖页面/外壳（T4·活线镜像）`
          : null
      }
      if (f.includes('/rewrite/agent/src/lib/')) {
        return /\.vue$/.test(spec) && /\b(Desk|Login|App)\b/.test(spec)
          ? `依赖方向反转：agent/lib 禁 import 页面级 .vue（${spec}）——lib 不得依赖页面组件（T4·活线镜像）`
          : null
      }
      if (!spec.startsWith('.')) return null
      const layer = f.includes('/rewrite/mp/lib/') ? 'lib' : f.includes('/rewrite/mp/api/') ? 'api' : 'utils'
      const target = spec.split('/').filter((x) => x && x !== '.' && x !== '..')[0]
      const banned = {
        utils: ['lib', 'api', 'pages', 'components', 'custom-tab-bar'],
        api: ['lib', 'pages', 'components', 'custom-tab-bar'],
        lib: ['pages', 'components', 'custom-tab-bar'],
      }[layer]
      return banned.includes(target)
        ? `依赖方向反转：${layer} 层禁 import ${target}/（pages→lib→api→utils·utils 是叶；T4·活线镜像）`
        : null
    },
  },
]

// ============== 类型层 + 行为测试守卫（typeAndTestGuards）==============
// 这些守卫没有独立的 JS 规则对象（活在 TS 编译期或 tests/），故在此声明 provenance，
// 供 guard-coverage 读取。mechanism：'ts'（编译期，reverseTest 为手动篡改说明）
// | 'test'（reverseTest 指向必须存在的测试文件，guard-coverage 校验其存在）。
export const typeAndTestGuards = [
  {
    id: 'fen-branded-type',
    mechanism: 'ts',
    roots: ['#4'],
    reverseTest: '浮点金额赋给 Fen → tsc 编译失败（packages/shared Fen 品牌类型；反向自检手动篡改）',
  },
  {
    id: 'rw-fen-branded-type',
    mechanism: 'ts',
    roots: ['#4'],
    reverseTest: '新线：浮点金额赋给 Fen → tsc 编译失败（rewrite/shared Fen 品牌类型；随 rw-line-in-gates 接入 typecheck 闸）',
  },
  {
    id: 'rw-flow-observable',
    mechanism: 'test',
    roots: ['#12', '#8', '#14'],
    reverseTest: 'rewrite/cloud/tests/flow.test.ts',
  },
  {
    id: 'order-status-union',
    mechanism: 'ts',
    roots: ['#2'],
    reverseTest: '写非法状态名 → tsc 编译失败（调用方用 ORDER_STATUS 常量联合）',
  },
  {
    id: 'transition-atomic-idempotent',
    mechanism: 'test',
    roots: ['#1', '#2'],
    reverseTest: 'tests/cloud/kit/transition.test.js',
  },
  {
    id: 'deterministic-id-concurrency',
    mechanism: 'test',
    roots: ['#1'],
    reverseTest: 'tests/cloud/userWrites.test.js',
  },
  // 进销存计量整数一致（SCM-0·根因#8 假数据入账）：物料 uom 只收 count|gram 且建档后锁死（改 uom→400 UOM_LOCKED）；
  // 单据行数量/调整 delta 必整数（克/件全链整数·镜像金额「分整数」纪律·浮点入账即拒）。reverseTest 锁此组合行为。
  { id: 'scm-uom-integer', mechanism: 'test', roots: ['#8'], reverseTest: 'tests/cloud/scmMaterials.test.js' },
  // 组装快照冻结 + 幂等（SCM-C·根因#2·同订单快照原则）：组装单执行时冻结 bomSnapshot/consumedLines——改模板后
  // 历史单不追新（重放旧单结果不变）；同 assemblyId 重放 409 不双扣（claim=确定性 _id）；料不足全单回滚（宁不动账勿错账）。
  { id: 'bom-snapshot-frozen', mechanism: 'test', roots: ['#2'], reverseTest: 'tests/cloud/scmAssembly.test.js' },
  // 发货核销流水（SCM-D·根因#2·「如实核销」蓝图定稿）：shipOrder 首次 paid→shipped 必落 ship 流水
  // （fg 行确定性 _id=ship:<orderId>:fg:<pid>__<spec>·只留痕不动账）；改单号/重试/批量不双记账。reverseTest 锁此行为。
  { id: 'ship-verify-ledger', mechanism: 'test', roots: ['#2'], reverseTest: 'tests/cloud/scmShipLedger.test.js' },
  // admin 频控全局/账户级兜底（审核 P1·根因#13）：per-IP 频控 key 取 x-forwarded-for（可伪造·轮换可绕 5 次锁），
  // 故叠加跨所有 IP 的全局失败计数——轮换伪造 header 的爆破累计达全局阈值仍锁。reverseTest 锁此组合行为。
  { id: 'admin-throttle-global-backstop', mechanism: 'test', roots: ['#13'], reverseTest: 'tests/cloud/adminThrottle.test.js' },
  // 钱/权限两条门面守卫的 reverseTest 改锚活线（盲区体检批2·病根#16 ⑥）：原指冻结旧线
  // tests/cloud/kit/*.test.js（import packages/cloud·仍随 vitest 跑、守冻结参照），但注册表的
  // 「证据」字段该指生产代码的等价测试——rewrite/cloud/tests 的 gate/notify 断言面等价
  // （withOpenId/withAdminGate fail-closed + defineNotifyCallback 见身份即拒伪造）。
  // 其余 25 条 test 型守卫仍指旧线测试，系统性重登记待拍板（见 待办与债 盲区体检节）。
  { id: 'gate-fail-closed', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/gate.test.ts' },
  { id: 'notify-forge-proof', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/notify.test.ts' },
  // 支付配置 fail-closed（根因#3 同款）：createOrder 缺/错 config/pay 时绝不伪造已付单——
  // mock 仅 env ALLOW_MOCK_PAY=1 放行，否则拒 PAY_CONFIG_MISSING（reverseTest 锁此行为）。
  { id: 'pay-config-fail-closed', mechanism: 'test', roots: ['#3'], reverseTest: 'tests/cloud/createOrder.test.js' },
  { id: 'fen-money-chain', mechanism: 'test', roots: ['#4'], reverseTest: 'tests/cloud/createOrder.test.js' },
  { id: 'paging-contract', mechanism: 'test', roots: ['#7'], reverseTest: 'tests/cloud/kit/paging.test.js' },
  // 发货上传 fail-soft（根因#12 + 合规债#26）：微信发货上传失败绝不反噬本地发货——shipOrder 仍翻 shipped、
  // 留痕 wxShipError、打 [LD_ALERT] sev=money 告警人工补录；上传成功留痕 wxShipUploaded。reverseTest 锁此行为。
  { id: 'shipping-upload-fail-soft', mechanism: 'test', roots: ['#12'], reverseTest: 'tests/cloud/shipOrder.test.js' },
  // 商品停售生效（债#12）：unpublishProduct 置 listed:false 后 getProducts 不再下发该商品（顾客端列表消失），
  // republishProduct 恢复；旧无 listed 字段的商品视为可售（兼容）。reverseTest 锁此端到端行为。
  { id: 'product-unpublish-effective', mechanism: 'test', roots: ['债#12'], reverseTest: 'tests/cloud/productListed.test.js' },
  // 停售商品挡交易入口（审核 P1·债#12 + 根因#3 信任边界 fail-closed）：软下架（listed:false）此前只挡 getProducts
  // 列表，createOrder 不校验——旧购物车/缓存/直调云函数仍能买已停售品。本守卫锁 createOrder 对 listed:false 主商品
  // fail-closed（UNLISTED_ITEM·不建单不扣库存），且 publishProduct 重新上架保留旧 listed（不隐式复活销售）。reverseTest 锁此组合行为。
  { id: 'createorder-rejects-unlisted', mechanism: 'test', roots: ['债#12', '#3'], reverseTest: 'tests/cloud/createOrder.test.js' },
  // 评价列表分页端到端（根因#7·债#13）：getReviews 列表 cursor 翻页（>limit 返 nextCursor·续页接上），
  // 汇总仅首页基于 bounded 样本返回（approx 标注）。reverseTest 锁此行为。
  { id: 'reviews-paged-effective', mechanism: 'test', roots: ['#7'], reverseTest: 'tests/cloud/getReviewsPaged.test.js' },
  // 评价汇总真全量精确（债#13 后半·根因#7 固定样本失真）：评分/计数/星级分布走 count()+aggregate(sum)·不封顶·approx 恒 false
  // （与 dashboard GMV 同范式·#18续）；标签仍近样本 top-5。reverseTest 灌 250 条（>200 样本上限）锁「不被截断」。
  { id: 'reviews-summary-exact', mechanism: 'test', roots: ['#7', '债#13'], reverseTest: 'tests/cloud/getReviewsSummaryExact.test.js' },
  // 用户反馈写库行为端到端（运营钩子①·待办#23）：submitFeedback 缺身份 fail-closed（NO_OPENID·根因#3）、
  // content 空/越长截断、category 白名单越界归 other、超 10 次/分 RATE_LIMITED（根因#13）。reverseTest 锁此行为。
  { id: 'feedback-throttled-gated', mechanism: 'test', roots: ['#13', '债#23'], reverseTest: 'tests/cloud/submitFeedback.test.js' },
  // 企微推送 fail-soft（债#23续·根因#13）：pushBotAlert 推送失败/网络异常/非企微 webhook 一律返回 ok:false
  // 而**绝不抛错**——可观测性不反噬主流程（钱链回调照常 ACK）。reverseTest 锁此行为。
  { id: 'bot-alert-fail-soft', mechanism: 'test', roots: ['#13', '债#23'], reverseTest: 'tests/cloud/kit/botpush.test.js' },
  // 下单库存预留 + 回补端到端（库存#1·根因#1/#2 防超卖）：createOrder 缺货拒单(OUT_OF_STOCK)、预留扣减记 reserved；
  // 超时关单回补且幂等；乐观 CAS 抢最后一件只一个赢；不限量(无文档)放行。reverseTest 锁此行为。
  { id: 'order-reserves-stock', mechanism: 'test', roots: ['#1', '#2'], reverseTest: 'tests/cloud/inventory.test.js' },
  // 关单回补后晚到回调复活前重抢库存（审核 P0·根因#1/#2 防超卖）：closed 单库存已在关单时回补，payCallback
  // 收到晚到成功回调须**重新 reserveStock 抢回 reserved 才翻 paid**；抢不到（已售罄）则进 refund_required 待退款态
  // （钱已收·不静默吞钱·告警人工退款），杜绝「关单回补 + 晚到回调」双单争一份库存的超卖。reverseTest 锁此组合行为。
  { id: 'paycallback-revive-reserves-stock', mechanism: 'test', roots: ['#1', '#2'], reverseTest: 'tests/cloud/payCallback.test.js' },
  // 管理操作审计（操作审计#4·根因#3）：recordAudit 写痕 + 剥凭证 + fail-soft；shouldAudit 只记动钱/状态操作、跳只读/上传/认证。reverseTest 锁此行为。
  { id: 'admin-action-audit-logged', mechanism: 'test', roots: ['#3'], reverseTest: 'tests/cloud/kit/audit.test.js' },
  // 新会话推送 fail-soft（M⑦ 推送线·根因#8「构建过≠真能用」防推送反噬）：enqueueSession 推在线坐席（应用消息）
  // 失败/网络异常一律静默——转人工入队照常完成、顾客回复不受影响；且只在「真正新入队」（首建/closed 重开）才推，
  // 已 pending/active 不重复骚扰。reverseTest 锁此行为（推送抛错→enqueue 仍 resolves + 会话入队）。
  { id: 'enqueue-push-fail-soft', mechanism: 'test', roots: ['#8'], reverseTest: 'tests/cloud/agentPush.test.js' },
  // 企微免登 fail-closed（M⑦ 车道B·根因#3 信任边界）：loginByWecomCode 无 code/换不到 userid/userid 未绑账号/
  // 账号停用/无缓存令牌 → 一律拒、绝不签发 session 令牌；checkKey 认令牌时过期/停用 → 拒（不放行）。签发的令牌
  // 存 sha 不存明文·令牌不持密钥（复用缓存令牌·根因#3）。reverseTest 锁此 fail-closed 组合行为。
  { id: 'wecom-login-gated', mechanism: 'test', roots: ['#3'], reverseTest: 'tests/cloud/wecomLogin.test.js' },
  // 口令登录签发会话令牌（深审 P1·根因#3 口令不落盘）：login 成功必随包返 sessionToken（sha 入 sessions 数组·
  // 绝不存明文）；令牌可作后续请求 key（checkKey 会话解析）；过期/停号 fail-closed 拒；多设备并存（sessions
  // 数组·剪过期/超容剪最旧）；口令作 key 兼容不破（旧已部署前端）。reverseTest 锁此组合行为。
  { id: 'admin-session-issued', mechanism: 'test', roots: ['#3'], reverseTest: 'tests/cloud/adminSession.test.js' },
  // 库存列表有界读（深审 P2·根因#7/#8）：真 SDK 裸 .get() 默认 100 条静默截断（桩已对齐此语义·根因#8）——
  // getInventory 分页取齐（100/页·封顶 1000）、到顶如实报 truncated（前端明示不装全量）。reverseTest 灌 150 条锁「不被 100 截断」。
  { id: 'inventory-reads-bounded', mechanism: 'test', roots: ['#7', '#8'], reverseTest: 'tests/cloud/adminInventoryBounded.test.js' },
  // 外部对账比对面截断如实标注（深审 P2·根因#7 固定样本失真）：getBillMatch 取最近 CAP 条触顶时必返 approx:true
  // ——否则老窗口真单配不上账单被误报「微信有我方无（最危险）」＝截断假象当真差异。reverseTest 灌满 CAP 锁此标注。
  { id: 'billmatch-approx-flag', mechanism: 'test', roots: ['#7'], reverseTest: 'tests/cloud/bill-match.test.js' },
  // 云存储上传路径消毒（深审 P3·根因#3 不信前端）：storeImage/getVideoUploadMeta 的 pid/courseId 客户端串
  // 直接拼对象键——'../' 等路径字符须剥净（[^\w-] 白名单·同 name 口径）、全非法回退 misc。reverseTest 锁此行为。
  { id: 'upload-path-sanitized', mechanism: 'test', roots: ['#3'], reverseTest: 'tests/cloud/adminUploadPath.test.js' },
  // 体检面板派生性（正册·可视检查系统批）：面板守卫清单必须=四注册表机器派生（一条不漏不多造）、
  // 失败现场置顶可见、单测带复跑命令、病根地图与根因账本 §一 同源。reverseTest 锁此派生性。
  { id: 'check-report-derived', mechanism: 'test', roots: ['正册'], reverseTest: 'tests/scripts/checkReport.test.js' },
  // mp↔cloud 响应契约哨兵（批B10·病根#5 手抄副本漂移 + #8 编译绿≠契约没漂）：mp 物理进不了
  // @ldrw/shared（微信开发者工具编译限制），响应形状全靠手抄——cloud 改键 mp 编译不红＝静默漂移面。
  // 钱链/学习链 5 热 action（createOrder/pay/getMyOrders/getOrderById/getPlaybackUrl）成功响应
  // 精确键集合（Object.keys 排序全等·增删都红）；红了先同步 rewrite/shared/src/contracts.ts 与
  // mp 消费面四点位（payFlow/mapOrders/playbackCache/order-list·清单见测试头注）。
  { id: 'rw-app-response-contract', mechanism: 'test', roots: ['#5', '#8'], reverseTest: 'rewrite/cloud/tests/contract-shape.test.ts' },
]

// export：供 check-report 体检面板复用同一套遍历/判定（面板=派生视图，禁自建第二套语义）
// 'rewrite' 加入扫描面（批1·2026-07-10）：唯一在迭代的活代码线，此前 fileRules 全量扫描扫不到，
// rw- 前缀的新守卫不动这条即是装饰。旧 fileRules（5 条）inScope 全部锁死 packages 路径，扩面不误咬。
export const SRC_DIRS = ['packages', 'cloudfunctions', 'scripts', 'rewrite']
export function* walk(dir) {
  if (!existsSync(dir)) return
  for (const name of lsScan(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (/\.(js|mjs|cjs|ts|vue)$/.test(name)) yield p
  }
}
const isCommentLine = (line) => /^(\/\/|\/\*|\*|<!--|#)/.test(line.trim())

// 剥注释单源 helper（执行者错题本 E1·坑史：方法体正则咬注释假绿——2026-07-08 播放页批/客服批连栽两次）：
// 剥 // 行注释与 /* */ 块注释，供守卫「查真实调用」前先清场——防真调用挪进注释、假实现留在正文，正则仍误判命中。
// 原三处（1151/客服触点/首页加购）重复裸写的字面量单源化到这里；元守卫 guard-strip-single-source 焊死不许再裸写绕开。
// 块注释用「逐字符替换成空串再保留原有换行数」而非整段替换成空串——保证剥注释后行数与原文件严格一一对应，
// 供按下标转行号的调用方（如 rw-moneychain-alert-wired）报出真实行号；纯布尔 .test() 调用方语义不受影响
// （P2 复审：整段替换成空串会吃掉块注释内部换行，跨行块注释之后的行号会比真实行号小）。
export function stripComments(src) {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
}

// 方法体截取单源 helper（同错题本 E1·配 stripComments 使用）：截取形如 `name(...) {\n  ...\n  },`
// 的对象方法/类方法整段文本（含签名），兼容可选 async 前缀、任意参数段（含空参）；收尾沿用两空格缩进
// 逗号收尾 `\n {2}\},` 启发式（仓内页面对象方法书写惯例，未改行为）。找不到该方法名或收尾边界返回 ''。
export function methodBody(src, name) {
  const sigRe = new RegExp('(?:async\\s+)?\\b' + name + '\\b\\s*\\([^)]*\\)\\s*\\{')
  const sigMatch = src.match(sigRe)
  if (!sigMatch) return ''
  const rest = src.slice(sigMatch.index)
  const endMatch = rest.match(/\n {2}\},/)
  if (!endMatch) return ''
  return rest.slice(0, endMatch.index + endMatch[0].length)
}

// setup 顶层函数体截取单源 helper（配 methodBody 并列·批3 规格新写）：methodBody 的收尾启发式只适配
// mp Options-API 对象方法书写（逗号收尾、固定两空格缩进），对 `<script setup>` 里裸写的顶层函数（无
// 逗号收尾、非固定缩进）实测错抓——预审已证伪，故不复用。本 helper 改走确定性花括号配对计数：从
// `function <名>(` 签名起数开合花括号直到配平，取完整签名+函数体整段。调用前须先 stripComments()
// （同 methodBody 约定），防注释里的花括号打乱配对计数；计数本身走 maskStringLiterals() 掩蔽后的副本
// （防字面量里的花括号字符打乱配平·复审补漏·P2 潜在假阴性——定义见本函数之后），但返回值仍切片自
// 原始 src（拿到真实源码，非掩蔽后的占位符）。找不到签名或花括号不配平（源码损坏）返回 ''。
export function setupFnBody(src, name) {
  const sigRe = new RegExp('(?:export\\s+)?(?:async\\s+)?\\bfunction\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{')
  const sigMatch = src.match(sigRe)
  if (!sigMatch) return ''
  const masked = maskStringLiterals(src)
  const braceStart = sigMatch.index + sigMatch[0].length - 1 // 匹配串以 '{' 收尾
  let depth = 0
  for (let i = braceStart; i < src.length; i++) {
    if (masked[i] === '{') depth++
    else if (masked[i] === '}') {
      depth--
      if (depth === 0) return src.slice(sigMatch.index, i + 1)
    }
  }
  return ''
}

// 字符串/模板字面量掩蔽（配 setupFnBody 花括号配对计数用·复审补漏·P2 潜在假阴性）：花括号配对计数
// 不认字符串边界，含奇数个字面量花括号字符（如一个值为「incomplete: {」的字符串）的函数体会打乱配平、
// 把边界算到别处函数头上（假阴性——漏报真缺失、错报别处）。逐字符扫单引号/双引号/反引号包裹段，段内
// 非引号字符替换成 'x'（换行符原样保留，不影响后续按行定位），引号本身与段外代码字符不变——保持与原
// src 等长，setupFnBody 返回值仍按原 src 切片取真实源码。反斜杠转义按「\+下一字符」两字一并替换，防
// 转义引号被误判成边界。模板字面量的插值整段一并掩蔽（不单独复原花括号）——插值内必是合法完整表达式，
// 不可能横跨一个真实的顶层函数/块边界，掩蔽换计数简单换来的假阳性风险可忽略。放在 setupFnBody 之后
// （而非之前）定义——防插在 methodBody/setupFnBody 之间破坏 guard-strip-single-source 的 span 判定
// （错题本 E8：新插入的顶层 function 声明会把前一 span 的终点提前截断，让 span 内原有的合法引用文本
// 露到 span 外被误判成裸写复辟）。
function maskStringLiterals(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      out += c
      i++
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < n) {
          out += 'xx'
          i += 2
          continue
        }
        out += src[i] === '\n' ? '\n' : 'x'
        i++
      }
      if (i < n) {
        out += src[i]
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

// —— 隐私挂载可达性（守卫 privacy-authorize-wired 用·债#25/根因#8）——
// 微信「涉隐私接口」登记：调用前会触发 onNeedPrivacyAuthorization（全局闸经弹窗放行）。新接口扩补此册。
const PRIVACY_INTERFACES = [
  'chooseImage', 'chooseMedia', 'chooseVideo', 'chooseMessageFile',
  'getLocation', 'chooseLocation', 'choosePoi', 'chooseAddress',
  'chooseInvoice', 'chooseInvoiceTitle', 'saveImageToPhotosAlbum',
  'saveVideoToPhotosAlbum', 'getClipboardData', 'startRecord',
  'getRecorderManager', 'getWeRunData', 'addPhoneContact', 'scanCode',
  'createCameraContext', 'addPhoneCalendar',
]
const PRIVACY_RE = new RegExp('\\b(?:uni|wx)\\.(?:' + PRIVACY_INTERFACES.join('|') + ')\\s*\\(')

// 剥「mp-weixin 不可达」的条件编译块（#ifndef MP-WEIXIN / #ifdef H5|APP… 等），留 mp 可达文本
// （#ifdef MP-WEIXIN/MP + 未 gate）。宁过勿漏：未 gate 的脚本级调用一律计入（多挂个 PrivacySheet 是无害防御）。
function mpReachableText(src) {
  const out = []
  const stack = [] // 每层存累积可达性（含祖先）
  const cur = () => stack.length === 0 || stack[stack.length - 1]
  for (const line of src.split('\n')) {
    const m = line.match(/(?:\/\/|<!--)\s*#(ifdef|ifndef)\s+([^\n>]+?)(?:\s*-->)?\s*$/)
    if (m) {
      const platforms = m[2].split('||').map((s) => s.trim())
      const mp = platforms.includes('MP-WEIXIN') || platforms.includes('MP')
      const here = m[1] === 'ifdef' ? mp : !mp
      stack.push(cur() && here)
      continue
    }
    if (/(?:\/\/|<!--)\s*#endif/.test(line)) {
      stack.pop()
      continue
    }
    if (cur()) out.push(line)
  }
  return out.join('\n')
}

export function checkFile(file) {
  // 扫描面排除（病根#16）：dot 目录（.claude/worktrees 残留 worktree 等）不是活代码——
  // 主循环经 lsScan 已排除，此处再挡 --hook 单文件路径（编辑 hook 直接把文件路径喂进来，
  // 不经 walk；漏了这道，编辑残留 worktree 里的文件仍会被当活代码咬红）。
  // 必须对 ROOT 相对路径判（批2 反向自检当场逮住的自埋雷：本仓工作 worktree 本身住在
  // <主仓>/.claude/worktrees/ 下，拿绝对路径匹配 /.claude/ 会把 worktree 里的**全部活文件**
  // 一并豁免——fileRules 在所有 worktree 里静默全灭、只在 main/CI 上活着，恰是病根#16 空样本=绿）。
  const relFile = relative(ROOT, String(file)).replace(/\\/g, '/')
  if (/(^|\/)\.claude\//.test(relFile)) return []
  const rules = fileRules.filter((r) => r.inScope(file))
  if (!rules.length) return []
  const violations = []
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (isCommentLine(line) || line.includes('structure-ok')) return
    for (const rule of rules) {
      const msg = rule.test(line, { file, lines, i })
      if (msg) violations.push({ id: rule.id, loc: `${relative(ROOT, file)}:${i + 1}`, msg, src: line.trim().slice(0, 80) })
    }
  })
  return violations
}

function runRepoChecks() {
  const violations = []
  for (const c of repoChecks) {
    for (const msg of c.run()) violations.push({ loc: `[${c.id}]`, msg, src: c.desc })
  }
  return violations
}

function report(violations, stream) {
  for (const v of violations) stream.write(`${v.loc}\n  ✗ ${v.msg}\n  → ${v.src}\n`)
  stream.write(`\n结构不变量未通过：${violations.length} 处（每条对应一项重构主张守卫；刻意例外行内加 structure-ok）\n`)
}

// 引擎自检（非守卫·不进 repoChecks/fileRules 计数·与 guard-coverage 的 Set 去重逻辑正交）：注册期 id 撞名
// 硬断言——任一守卫数组内 id 重复注册即红并使 check:structure 非零退出。批I 前 rw-material-stock-single-seam
// / rw-scm-ledger-idempotent 各注册两次（length=200 而 distinct=198），guard-coverage 用 Set 去重反而把撞名
// 掩盖、无任何机制测得出；合并去重后加此断言防再犯（撞名=length 虚高/distinct 漂移，计数根治的前提）。
function assertNoDuplicateIds() {
  const bad = []
  for (const [name, arr] of [
    ['repoChecks', repoChecks],
    ['fileRules', fileRules],
  ]) {
    const seen = new Set()
    for (const g of arr) {
      if (seen.has(g.id)) bad.push({ loc: '[registry-no-dup-id]', msg: `${name} 数组 id 重复注册：${g.id}（撞名=length 虚高、distinct 漂移·合并去重后修）`, src: '注册期 id 撞名硬断言（引擎自检·不计入守卫数）' })
      seen.add(g.id)
    }
  }
  return bad
}

// CLI 入口包进 main()，只在被 node 直接运行时执行——这样测试 / guard-coverage
// 可 import 上面三个守卫数组而不触发全量检查（isMain 守门）。
async function main() {
  const args = process.argv.slice(2)

  // 注册期 id 撞名硬断言先于一切判定（引擎自检·非守卫）：撞名会让 length 虚高、下游计数全错，先红先停。
  const dupIds = assertNoDuplicateIds()
  if (dupIds.length) {
    report(dupIds, process.stdout)
    process.exit(1)
  }

  if (args[0] === '--hook') {
    // PostToolUse：stdin 是 hook JSON，只查被编辑的单文件（fileRules），违例 exit 2 反馈 Claude
    let stdin = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) stdin += chunk
    let file
    try {
      file = JSON.parse(stdin)?.tool_input?.file_path
    } catch {
      process.exit(0)
    }
    if (!file || !existsSync(file)) process.exit(0)
    const violations = checkFile(resolve(file))
    if (violations.length) {
      report(violations, process.stderr)
      process.exit(2)
    }
    process.exit(0)
  }

  // 全量：repoChecks + 所有源文件 fileRules
  const violations = [...runRepoChecks()]
  if (fileRules.length) {
    for (const dir of SRC_DIRS) {
      for (const f of walk(join(ROOT, dir))) violations.push(...checkFile(f))
    }
  }
  if (violations.length) {
    report(violations, process.stdout)
    process.exit(1)
  }
  console.log(
    `✅ 结构不变量通过（仓级 ${repoChecks.length} 条：${repoChecks.map((c) => c.id).join(' / ')}；逐文件规则 ${fileRules.length} 条）`
  )
}

const isMain = resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
if (isMain) main()
