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
import { join, resolve, relative } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

function listPackageJsons() {
  const dir = join(ROOT, 'packages')
  const out = ['package.json']
  if (existsSync(dir)) {
    for (const n of readdirSync(dir)) {
      const p = `packages/${n}/package.json`
      if (existsSync(join(ROOT, p))) out.push(p)
    }
  }
  return out
}

// ============== 仓级不变量（repoChecks）==============
// 每条 run() 返回违例说明数组（空 = 通过）。
const repoChecks = [
  {
    id: 'stub-only-sdk',
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
    id: 'cloud-domain-grouped',
    desc: 'T2 域分组：云函数源须在 functions/<域>/ 下，functions/ 顶层不得有裸 .ts（部署单元按域不散落）',
    run() {
      const dir = join(ROOT, 'packages/cloud/src/functions')
      if (!existsSync(dir)) return []
      const bad = []
      for (const entry of readdirSync(dir)) {
        if (statSync(join(dir, entry)).isFile() && entry.endsWith('.ts')) {
          bad.push(`packages/cloud/src/functions/${entry} 在顶层——函数须放进域子目录（catalog/learning/orders/user/system/admin，T2）`)
        }
      }
      return bad
    },
  },
  {
    id: 'flow-seam-single',
    desc: '平台接缝单点（根因#12 平台规则外部风险）：cloudbase_module 工作流调用全库仅 kit/flow.ts 一处（callFlow），平台规则变化改动面最小',
    run() {
      const root = join(ROOT, 'packages/cloud/src')
      if (!existsSync(root)) return []
      const allowed = 'packages/cloud/src/kit/flow.ts'
      const hits = []
      const walk = (d) => {
        for (const e of readdirSync(d)) {
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
    id: 'interface-catalog-sync',
    desc: '接口正册同步（docs/接口正册.md 是接口权威登记册，正册自评 P1）：每个云函数 + 每个 adminApi action 都须登记，杜绝「加接口忘登记」',
    run() {
      const catPath = join(ROOT, 'docs/接口正册.md')
      if (!existsSync(catPath)) return ['docs/接口正册.md 缺失（接口权威登记册）']
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
          if (name && !has(name)) bad.push(`云函数 ${name} 未登记 docs/接口正册.md（正册 P1）`)
        }
      }
      // adminApi action（index.ts ACTIONS 查表键 + 特例 ping/login）
      const idxPath = join(fnRoot, 'admin/adminApi/index.ts')
      if (existsSync(idxPath)) {
        const m = readFileSync(idxPath, 'utf8').match(/const ACTIONS[^{]*\{([\s\S]*?)\n\}/)
        const actions = m ? [...m[1].matchAll(/^\s*(\w+):/gm)].map((x) => x[1]) : []
        for (const a of [...actions, 'ping', 'login']) {
          if (!has(a)) bad.push(`adminApi action ${a} 未登记 docs/接口正册.md（正册 P1）`)
        }
      }
      return bad
    },
  },
  {
    id: 'writes-need-gate',
    desc: '写库必过闸（根因#3「不过闸写不出来」成结构事实）：functions/ 下写 DB（.add/.set/.update/.remove）的函数须引 kit 闸（withOpenId/withAdminGate/defineNotifyCallback/isServerCall）或 checkKey；纯读（公开目录）豁免',
    run() {
      const root = join(ROOT, 'packages/cloud/src/functions')
      if (!existsSync(root)) return []
      const GATE = /\b(withOpenId|withAdminGate|defineNotifyCallback|isServerCall|checkKey)\b/
      const WRITE = /\.(add|set|update|remove)\s*\(/
      const readAll = (d) => {
        let src = ''
        for (const f of readdirSync(d)) {
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
    id: 'docs-budget',
    desc: '文档防膨胀（根因#11 文档职责渗漏）：CLAUDE.md 须 ≤180 行（病史曾 314 行→收口 130；约定机器化后只会更瘦，溢出沉记录类）',
    run() {
      const abs = join(ROOT, 'CLAUDE.md')
      if (!existsSync(abs)) return []
      const n = readFileSync(abs, 'utf8').split('\n').length
      return n > 180
        ? [`CLAUDE.md ${n} 行 > 180 预算——文档职责渗漏（根因#11）；约定本体保持精简，进度/bug/欠债沉到 docs/ 记录类`]
        : []
    },
  },
  {
    id: 'console-assets-present',
    desc: '控制台资产正册不可误删（根因#9）：console-assets 关键正册文件须存在（git 外资产的唯一版本化记录）',
    run() {
      const bad = []
      for (const f of [
        'console-assets/README.md',
        'console-assets/01-支付退款工作流.md',
        'console-assets/02-库权限期望表.md',
        'console-assets/forward-node.js',
      ]) {
        if (!existsSync(join(ROOT, f))) bad.push(`${f} 缺失（控制台资产正册不可删，根因#9）`)
      }
      return bad
    },
  },
  {
    id: 'deploy-deny-all',
    desc: '样板房禁部署：guard-deploy 须对一切 tcb 部署/发布返回 deny（与生产仓只拦敏感名单不同）',
    run() {
      const abs = join(ROOT, 'scripts/guard-deploy.mjs')
      if (!existsSync(abs)) return ['scripts/guard-deploy.mjs 不存在（禁部署硬闸缺失）']
      const src = readFileSync(abs, 'utf8')
      return /permissionDecision:\s*'deny'/.test(src) && /isMutating/.test(src)
        ? []
        : ["guard-deploy.mjs 缺 deny-all 机制——样板房禁部署硬闸被削弱"]
    },
  },
  {
    id: 'format-hook-wired',
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
]

// ============== 逐文件规则（fileRules）==============
// 形状：{ id, inScope(absPath)->bool, test(line, {file, lines, i})->msg|null }
// 按主张追加（B3 起：禁 #ifdef 多端回退、禁 api 运行时引 data/…）。
const fileRules = [
  {
    // T2 域分组（根因账本 #5）：云函数业务代码禁裸用 cloud.init()/getWXContext()，
    // 身份/初始化一律经 kit（withOpenId/getDb/isServerCall）。kit 自身与类型声明放行。
    id: 'kit-only-cloud-primitives',
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
    inScope: (abs) => abs.includes('/packages/cloud/src/functions/') && abs.endsWith('.ts'),
    test: (line) =>
      /cloudbase_module/.test(line)
        ? '触发工作流禁裸用 cloudbase_module——经 kit.callFlow 单点收口（根因#12 平台接缝最小化）'
        : null,
  },
  {
    // T1 砍多端（根因账本 #6）：api 层禁 import @/data/——api 只对接云（callCloud），
    // 不引样例数据＝不可能再造本地假数据回退。比正则抓 res===null 干净。
    id: 'api-cloud-only',
    inScope: (abs) => abs.includes('/packages/miniapp/src/api/') && abs.endsWith('.js'),
    test: (line) =>
      /\bfrom\s+['"]@\/data\//.test(line) || /\brequire\(\s*['"]@\/data\//.test(line)
        ? 'api 层禁 import @/data/——api 只对接云，不引样例数据＝不可能再造本地假数据回退（T1/根因6）'
        : null,
  },
  {
    // T4 按链内聚（CLAUDE §8 依赖方向）：pages→store/api→utils，data/utils 是叶。禁反向 import。
    id: 'dep-direction',
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
]

const SRC_DIRS = ['packages', 'cloudfunctions', 'scripts']
function* walk(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (/\.(js|mjs|cjs|ts|vue)$/.test(name)) yield p
  }
}
const isCommentLine = (line) => /^(\/\/|\/\*|\*|<!--|#)/.test(line.trim())

function checkFile(file) {
  const rules = fileRules.filter((r) => r.inScope(file))
  if (!rules.length) return []
  const violations = []
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (isCommentLine(line) || line.includes('structure-ok')) return
    for (const rule of rules) {
      const msg = rule.test(line, { file, lines, i })
      if (msg) violations.push({ loc: `${relative(ROOT, file)}:${i + 1}`, msg, src: line.trim().slice(0, 80) })
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

const args = process.argv.slice(2)

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
