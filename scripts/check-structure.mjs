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
// roots：本守卫治哪条病根/主张（病根 #N / 主张 TN / 红线·基建·正册·格式 等标签）——
// 机读 provenance，guard-coverage 据此断言每条病根都有守卫（见 docs/元模式.md A2/A4）。
export const repoChecks = [
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
    roots: ['#12'],
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
        for (const e of readdirSync(d)) {
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
        for (const e of readdirSync(d)) {
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
    roots: ['#11'],
    desc: '文档防膨胀（根因#11）：CLAUDE.md ≤180 行 + docs/ 活文档 ≤15 份 + 记录类单文档行数上限（重构日志≤200/调试日志≤160/待办≤150·把 CLAUDE 规则②卷档从靠人变机器守）（一需求一家·客观→系统事实/主观→单源·历史卷档 archive）',
    run() {
      const out = []
      const abs = join(ROOT, 'CLAUDE.md')
      if (existsSync(abs)) {
        const n = readFileSync(abs, 'utf8').split('\n').length
        if (n > 180) out.push(`CLAUDE.md ${n} 行 > 180 预算——文档职责渗漏（根因#11）；约定本体精简，进度/bug/欠债沉 docs/ 记录类`)
      }
      const DOC_BUDGET = 15
      const dir = join(ROOT, 'docs')
      const docs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : []
      if (docs.length > DOC_BUDGET)
        out.push(`docs/ 活文档 ${docs.length} 份 > ${DOC_BUDGET} 预算——文档膨胀（根因#11）；按"一需求一家"合并、历史卷档 archive、客观计数收口 系统事实`)
      // 记录类单文档行数上限：记录类（日志/账本）会随时间膨胀，超上限即逼卷档 archive（老批次/旧季/已关账）——
      // 把 CLAUDE 规则②「卷档」从靠人记变机器守（docs-budget 原只管份数/CLAUDE 行数，不管单文档膨胀）。
      const RECORD_LIMITS = { '重构日志.md': 200, '调试日志.md': 160, '待办与债.md': 160 }
      for (const [f, max] of Object.entries(RECORD_LIMITS)) {
        const p = join(dir, f)
        if (!existsSync(p)) continue
        const n = readFileSync(p, 'utf8').split('\n').length
        if (n > max)
          out.push(`docs/${f} ${n} 行 > ${max} 预算——记录类膨胀（根因#11）；老批次/旧季/已关账卷档 archive（CLAUDE 规则②）`)
      }
      return out
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
    desc: '部署配置完整（根因#8 dry-run 过≠真部署能用）：cloudbaserc.json functions 须与 packages/cloud/src/functions/<域>/ 实际函数一一对应——漏配置真部署会卡交互确认（login 漏配即此坑，2026-06-14 真切换暴露）',
    run() {
      const rc = join(ROOT, 'cloudbaserc.json')
      const fnRoot = join(ROOT, 'packages/cloud/src/functions')
      if (!existsSync(rc) || !existsSync(fnRoot)) return []
      const configured = new Set((JSON.parse(readFileSync(rc, 'utf8')).functions || []).map((f) => f.name))
      const actual = []
      for (const domain of readdirSync(fnRoot)) {
        const dp = join(fnRoot, domain)
        if (!statSync(dp).isDirectory()) continue
        for (const e of readdirSync(dp)) {
          const name = statSync(join(dp, e)).isDirectory() ? e : e.endsWith('.ts') ? e.slice(0, -3) : null
          if (name) actual.push(name)
        }
      }
      const bad = []
      for (const name of actual) if (!configured.has(name)) bad.push(`云函数 ${name} 缺 cloudbaserc.json 配置——真部署会卡交互确认（根因#8）`)
      for (const name of configured) if (!actual.includes(name)) bad.push(`cloudbaserc.json 配了不存在的函数 ${name}——孤儿配置`)
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
        ['tcb fn deploy getProducts', 'allow'], // 单个非敏感读函数 → 放行
        ['tcb fn invoke getProducts', 'allow'], // 读类 → 放行
        ['git commit -m chore-tcb-deploy-fns', 'allow'], // 提交信息提字样 → 不拦
        ['DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs', 'ask'], // 批量部署 → 确认
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
      // §一「十二类病根」：取「## 二、」之前，抓 `### N.` 标题为病根 id
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
    id: 'requirement-trace',
    roots: ['元'],
    desc: '需求→守卫闭环（仿 guard-coverage 泛化「病根→守卫」为「需求→功能→守卫」）：需求清单「需求→实现映射」每条 ✅ 实现需求(L1)须有映射行，且行内 函数(见系统事实)/测试(tests/cloud)/守卫(注册表) 真实存在——改需求或改码断链当场红；`npm run trace R#` 查爆炸半径',
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
    id: 'admin-login-throttled',
    roots: ['#13'],
    desc: '认证端点防爆破（根因#13）：adminApi 口令校验路径必经频控闸（throttleLocked + 失败 throttleFail），杜绝公网口令无限重试爆破',
    run() {
      const f = 'packages/cloud/src/functions/admin/adminApi/index.ts'
      const abs = join(ROOT, f)
      if (!existsSync(abs)) return [`${f} 缺失`]
      const src = readFileSync(abs, 'utf8')
      const bad = []
      if (!/throttleLocked\s*\(/.test(src)) bad.push(`${f} 未经 throttleLocked 闸——认证端点无锁定、公网口令可被爆破（根因#13）`)
      if (!/throttleFail\s*\(/.test(src)) bad.push(`${f} 失败未 throttleFail 计数——频控空转（根因#13）`)
      return bad
    },
  },
  {
    id: 'user-writes-throttled',
    roots: ['#13'],
    desc: '用户端可滥用写函数防刷（根因#13）：高频/造数写函数（trackEvent/createOrder/login/updateProfile）必经 withRateLimit（按 openid 限频），防无限刷库/堆垃圾/成本',
    run() {
      const targets = ['learning/trackEvent', 'orders/createOrder', 'user/login', 'user/updateProfile']
      const bad = []
      for (const t of targets) {
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
      return bad
    },
  },
  {
    id: 'events-cleanup-wired',
    roots: ['债#9'],
    desc: 'events 流水定时清理（待办债#9 无界增长）：system/cleanupEvents 存在且删 events + cloudbaserc 配 timer，防回归成只增不删',
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
    desc: '协议正文非占位（R27 上线必做㉑）：pages/agreement/index.vue 不得含「占位」语 + 须含精确隐私承诺「不通过微信授权获取」手机号（债#21：原「不采集手机号」与 address-edit 手填收货电话自相矛盾·须精确到微信授权口径）+ 条款条目齐（≥8 条「第N条」），防占位文本上线',
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
    desc: '数据页空载态用 Skeleton 非空白（优化批0618·T-F2）：components/Skeleton.vue 存在 + 有真实冷启空白态的数据页（catalog/order-list）须挂 <Skeleton> 占位，防冷启/弱网白屏或纯文字「加载中」（首页 LoadingSplash / detail 样例即时渲染另有载态，不入册）',
    run() {
      const bad = []
      const comp = 'packages/miniapp/src/components/Skeleton.vue'
      if (!existsSync(join(ROOT, comp))) bad.push(`${comp} 缺失（骨架屏组件，T-F2）`)
      const SKELETON_PAGES = ['catalog', 'order-list']
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
    desc: '视频源不走外链（T-F7·合规）：packages/miniapp/src 禁裸 http(s) 视频 URL 字面量（.mp4/.m3u8/.mov/.webm 等）——视频源只经 getPlaybackUrl/store.playbackUrl 换云端临时 URL，无真视频显本地占位；防外链合规红线 + urlCheck 翻 true 后真机播不了（根因#8）',
    run() {
      const bad = []
      const re = /https?:\/\/[^'"`\s)]+\.(?:mp4|m3u8|mov|webm|avi|mkv)\b/i
      for (const f of walk(join(ROOT, 'packages/miniapp/src'))) {
        if (!/\.(js|ts|vue)$/.test(f)) continue
        readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (isCommentLine(line) || line.includes('structure-ok')) return
            if (re.test(line))
              bad.push(
                `${relative(ROOT, f)}:${i + 1} 裸 http(s) 视频 URL 字面量——视频源须经 getPlaybackUrl/云、禁外链（T-F7/合规·根因#8）`,
              )
          })
      }
      return bad
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
    // 店名单一来源（决策 R23 / 占位⑲，2026-06-15 定名「Lucky Ducky 小棉鸭」）。病根#5「样板复制即漂移」：
    // 店名曾在 order/checkout/welcome/BrandIntro/GroupPanel/productDetail 六处硬编码（order↔checkout 还逐字重复），
    // 改名必漏改。根治＝收口 constants/brand.js 的 BRAND_NAME，「保持一致」从人工义务变机器保证。
    id: 'brand-name-single-source',
    roots: ['#5', 'R23'],
    desc: '店名单一来源（决策 R23 / 占位⑲）：① 旧占位「易织…」全库绝迹（定名后须全替）② 店名字面量「Lucky Ducky 小棉鸭」只在 constants/brand.js、别处引 BRAND_NAME——改名只改一处，防散落硬编码漂移（病根#5）',
    run() {
      const bad = []
      const NAME = 'Lucky Ducky 小棉鸭'
      const OLD = '易织'
      const brandFile = 'packages/miniapp/src/constants/brand.js'
      const absBrand = join(ROOT, brandFile)
      if (!existsSync(absBrand)) bad.push(`${brandFile} 缺失（店名单一来源，R23⑲）`)
      else if (!new RegExp(`BRAND_NAME\\s*=\\s*['"]${NAME}['"]`).test(readFileSync(absBrand, 'utf8')))
        bad.push(`${brandFile} 未导出 BRAND_NAME='${NAME}'——店名单源缺定值（R23⑲）`)
      for (const dir of ['packages/miniapp/src', 'packages/admin/src']) {
        for (const f of walk(join(ROOT, dir))) {
          const rel = relative(ROOT, f)
          const s = readFileSync(f, 'utf8')
          if (s.includes(OLD))
            bad.push(`${rel} 仍含旧占位店名「${OLD}…」——定名 R23 后须全替（病根#5 复制漂移）`)
          if (rel !== brandFile && s.includes(NAME))
            bad.push(`${rel} 硬编码店名「${NAME}」——须引 constants/brand.js 的 BRAND_NAME 单源（病根#5）`)
          if (rel !== brandFile && s.includes('官方旗舰店'))
            bad.push(`${rel} 硬编码「官方旗舰店」店铺后缀——须引 brand.js 的 SHOP_FULL_NAME 单源（病根#5·债#30）`)
        }
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
    roots: ['#13'],
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
    id: 'capacity-reads-bounded',
    roots: ['规模'],
    desc: '看板/批次读路径不静默封顶（债#18/#22）：dashboard 计数走 .count() 精确、batches 列表分页全取；dashboard.ts/batches.ts 禁裸 limit(1000) 内存聚合（破千静默少算/截断）',
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
        for (const e of readdirSync(d)) {
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
      for (const e of readdirSync(dir)) {
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
          bad.push(`scripts/${f} 硬编码生产 env id「${envId}」——须 import { PROD_ENV } from './lib/env.mjs'（单源·病根#5·债#30①）`)
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
      return bad
    },
  },
  {
    // 守卫计数 + 测试计数自洽（文档体系规则⑥·客观计数机器维护·巡检 #009 ④/💡）：守卫数随加守卫
    // 天天涨、被手抄进 现状与路线.md 必漂（#009 标 31 vs 真值 35）——同 collection-count-synced 的
    // 「客观计数别手抄」病（病根#11）。repoChecks/fileRules 数组长度＝守卫数真值（含本守卫自己），
    // 现状与路线.md 任何「N repoCheck / M fileRule」须报同一数。测试数无静态真值源（vitest 才报准、
    // 跑全套太重不进静态闸），故只校验文档内多处「测试 N」互相自洽——封死 #009 标的 337 vs 326 手抄自相矛盾。
    id: 'guard-count-synced',
    roots: ['#11'],
    desc: '守卫计数单源（规则⑥·客观计数机器维护·巡检#009④）：repoChecks/fileRules 数组长度为守卫数真值；现状与路线.md「N repoCheck / M fileRule」须报同一数（同 collection-count-synced 路子·防 31/35 手抄漂移）。测试数无静态真值源，只校验文档内多处「测试 N」自洽（防 337 vs 326 自相矛盾）',
    run() {
      const doc = join(ROOT, 'docs/现状与路线.md')
      if (!existsSync(doc)) return []
      const text = readFileSync(doc, 'utf8')
      const bad = []
      // ① 守卫数：数组长度为真值（含本守卫自己），文档报同一数
      for (const m of text.matchAll(/(\d+)\s*repoCheck/g))
        if (Number(m[1]) !== repoChecks.length)
          bad.push(`现状与路线.md 报「${m[1]} repoCheck」≠ 真值 ${repoChecks.length}（repoChecks 数组·客观计数单源·规则⑥·别手抄）`)
      for (const m of text.matchAll(/(\d+)\s*fileRule/g))
        if (Number(m[1]) !== fileRules.length)
          bad.push(`现状与路线.md 报「${m[1]} fileRule」≠ 真值 ${fileRules.length}（fileRules 数组·客观计数单源·规则⑥）`)
      // ② 测试数：无静态真值源（vitest 才报准），只校验文档内多处互相自洽——防 337 vs 326 自相矛盾
      const tn = [
        ...[...text.matchAll(/(\d+)\s*测试/g)].map((m) => m[1]),
        ...[...text.matchAll(/测试\s*\**\s*(\d+)/g)].map((m) => m[1]),
      ]
      if (new Set(tn).size > 1)
        bad.push(`现状与路线.md 测试数多处不一致：${[...new Set(tn)].join(' vs ')}（手抄自相矛盾·状态只一处权威·规则⑥）`)
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
        for (const e of readdirSync(d)) {
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
    desc: '目录课程随激活/扫码取，不恒 list[0]（根因#8 单课样本失真·多课暴露）：courses store currentId+setCurrent + catalog 按 courseId/激活集 setCurrent + welcome 跳目录带 courseId=——任一缺即目录恒显第一门课',
    run() {
      const bad = []
      const checks = [
        ['packages/miniapp/src/store/courses.js', 'currentId', 'courses store 无 currentId——current 又回到恒 list[0]'],
        ['packages/miniapp/src/store/courses.js', 'setCurrent', 'courses store 无 setCurrent——无法聚焦激活课'],
        ['packages/miniapp/src/pages/catalog/index.vue', 'setCurrent', 'catalog 未按 courseId/激活集 setCurrent——目录不随激活课'],
        ['packages/miniapp/src/pages/welcome/index.vue', 'courseId=', 'welcome 跳目录未带 courseId=——目录不知聚焦哪门课'],
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
  { id: 'gate-fail-closed', mechanism: 'test', roots: ['#3'], reverseTest: 'tests/cloud/kit/gate.test.js' },
  { id: 'notify-forge-proof', mechanism: 'test', roots: ['#3'], reverseTest: 'tests/cloud/kit/notify.test.js' },
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
  // 评价列表分页端到端（根因#7·债#13）：getReviews 列表 cursor 翻页（>limit 返 nextCursor·续页接上），
  // 汇总仅首页基于 bounded 样本返回（approx 标注）。reverseTest 锁此行为。
  { id: 'reviews-paged-effective', mechanism: 'test', roots: ['#7'], reverseTest: 'tests/cloud/getReviewsPaged.test.js' },
  // 企微推送 fail-soft（债#23续·根因#13）：pushBotAlert 推送失败/网络异常/非企微 webhook 一律返回 ok:false
  // 而**绝不抛错**——可观测性不反噬主流程（钱链回调照常 ACK）。reverseTest 锁此行为。
  { id: 'bot-alert-fail-soft', mechanism: 'test', roots: ['#13', '债#23'], reverseTest: 'tests/cloud/kit/botpush.test.js' },
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

// CLI 入口包进 main()，只在被 node 直接运行时执行——这样测试 / guard-coverage
// 可 import 上面三个守卫数组而不触发全量检查（isMain 守门）。
async function main() {
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
}

const isMain = resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
if (isMain) main()
