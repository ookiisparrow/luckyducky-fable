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
import { oldlineDigest } from './oldline-freeze-lib.mjs'

const ROOT = resolve(import.meta.dirname, '..')

function listPackageJsons() {
  const out = ['package.json']
  // 旧线 packages/ + 新线 rewrite/（rw-line-in-gates：包级守卫不许漏扫新线）
  for (const base of ['packages', 'rewrite']) {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) continue
    for (const n of readdirSync(dir)) {
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
        for (const e of readdirSync(d)) {
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
        else if (!/'config\.json'\)[\s\S]{0,160}\.update\(\s*readFileSync/.test(readFileSync(deployFns, 'utf8')))
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
        for (const e of readdirSync(d)) {
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
    desc: '客服卡片 pagepath 须为小程序已注册路由（根因#8·外审 P2.11）：cs/kfCallback/dispatch.ts miniprogram 的 page 须在 pages.json（主包 + 分包 root/path）登记——防卡片跳不存在页真机打不开',
    run() {
      const dispatch = 'packages/cloud/src/functions/cs/kfCallback/dispatch.ts'
      const pagesJson = 'packages/miniapp/src/pages.json'
      if (!existsSync(join(ROOT, dispatch)) || !existsSync(join(ROOT, pagesJson))) return []
      const reg = new Set()
      try {
        const pj = JSON.parse(readFileSync(join(ROOT, pagesJson), 'utf8'))
        ;(pj.pages || []).forEach((p) => reg.add(p.path))
        ;(pj.subPackages || []).forEach((sp) => (sp.pages || []).forEach((p) => reg.add(`${sp.root}/${p.path}`)))
      } catch {
        return [`${pagesJson} 解析失败——无法校验客服卡片路由`]
      }
      const bad = []
      const src = readFileSync(join(ROOT, dispatch), 'utf8')
      for (const m of src.matchAll(/page:\s*'([^']+)'/g)) {
        if (!reg.has(m[1]))
          bad.push(`${dispatch} 客服卡片 page '${m[1]}' 不是 pages.json 已注册路由——真机点卡片打不开（根因#8·外审 P2.11）`)
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
        for (const e of readdirSync(d)) {
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
        for (const e of readdirSync(d)) {
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
        for (const e of readdirSync(d)) {
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
        for (const e of readdirSync(d)) {
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
        for (const e of readdirSync(d)) {
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
          const p = join(d, e.name)
          if (e.isDirectory()) walk(p)
          else if (e.name.endsWith('.ts')) {
            const s = readFileSync(p, 'utf8')
            // 查真实标识符（import/调用都算——有 import 就有被调风险；注释里带括号的调用样式不匹配裸词）
            if (/\btransferToServicer\b/.test(s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')))
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
        // 查真实调用 assertOwnedByAgent( 而非裸 token（防注释里提一句就假绿·反向自检逼出·根因#8）
        if (perSession && !/assertOwnedByAgent\s*\(/.test(src))
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
    desc: 'UGC 图片入库前必过内容安全（根因#3 fail-closed）：kit/contentsec.ts 接缝须真调 cloud.openapi.security.imgSecCheck；写 checkpoints 的 submitCheckpointPhoto 须调 imgSecCheck 接缝校验后才入库——防违规图直接入库（节点诊断拍照·后台360工作站 B2.2）',
    run() {
      const bad = []
      const sec = 'packages/cloud/src/kit/contentsec.ts'
      const absSec = join(ROOT, sec)
      if (!existsSync(absSec)) bad.push(`${sec} 缺失——内容安全接缝（根因#3·UGC 入库前校验）`)
      else if (!/\.openapi\.security\.imgSecCheck/.test(readFileSync(absSec, 'utf8')))
        bad.push(`${sec} 未真调 cloud.openapi.security.imgSecCheck——内容安全接缝是摆设（根因#3·扫真实调用非注释）`)
      const fn = 'packages/cloud/src/functions/learning/submitCheckpointPhoto.ts'
      const absFn = join(ROOT, fn)
      if (!existsSync(absFn)) bad.push(`${fn} 缺失——节点拍照上传 UGC 写入口（B2.2）`)
      else {
        const fsrc = readFileSync(absFn, 'utf8')
        const writesCheckpoints = /COLLECTIONS\.checkpoints|['"]checkpoints['"]/.test(fsrc)
        if (writesCheckpoints && !/imgSecCheck\s*\(/.test(fsrc))
          bad.push(`${fn} 写 checkpoints 但未调 imgSecCheck——UGC 图片未过内容安全即入库（根因#3·fail-closed）`)
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
        if (!/collection\(['"]rateLimit['"]\)[\s\S]{0,120}\.remove/.test(src))
          bad.push(`${f} 未清 rateLimit 过期窗口——频控集合无界增长（外审 P2.14·债#9）`)
        if (!/collection\(['"]kfState['"]\)[\s\S]{0,120}\.remove/.test(src))
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
    // 品牌字体走远程加载（wx.loadFontFace）、绝不进小程序包——杜绝字体二进制撑爆包体积（主包 2MB·总包 20MB）。
    // 痛：文源圆体单字重 ~14MB，若有人把 .otf/.ttf 丢进 src/static（构建原样拷入包）或 base64 内嵌进 wxss，
    // 包体积瞬间爆掉。锁两条进包路径：① src 下无字体二进制 ② mp 可达源码无字体 data-URI（base64 内嵌）。
    // 子集产物正本在仓根 assets/brand-fonts/（不在 src·不进包，仅作部署到托管的真相源 + OFL 授权随附）。
    id: 'font-not-in-package',
    roots: ['基建'],
    desc: '品牌字体远程加载不进包：packages/miniapp/src 下无字体二进制(.otf/.ttf/.woff/.woff2/.eot) + mp 可达源码无字面内嵌字体 blob（base64 长串·非运行时 downloadFile→base64 模板）——防 ~14MB 字重撑爆包体积（主包 2MB），字体须远程拉取（正本在 assets/brand-fonts/·远程托管·mp 端 downloadFile→base64 绕 CORS 见 App.vue）',
    run() {
      const bad = []
      const srcDir = join(ROOT, 'packages/miniapp/src')
      const FONT_BIN = /\.(otf|ttf|woff2?|eot)$/i
      // 只拦「字面内嵌的字体 blob」（base64, 后跟一长串 base64=真把字体打进包），不拦运行时拼的 data URI
      // 模板（如 `data:font/woff;base64,${data}`·downloadFile 后运行时构造·字体不在包里·见 App.vue 绕 CORS）。
      const FONT_DATAURI =
        /data:(?:font\/[a-z0-9.+-]+|application\/(?:x-)?font[a-z0-9.+-]*|application\/vnd\.ms-fontobject)[^"')]*?base64,[A-Za-z0-9+/]{200,}/i
      const scan = (dir) => {
        if (!existsSync(dir)) return
        for (const name of readdirSync(dir)) {
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
          } else if (/\.(vue|scss|css|js|mjs|ts)$/.test(name)) {
            if (FONT_DATAURI.test(mpReachableText(readFileSync(p, 'utf8')))) {
              bad.push(
                `${relative(ROOT, p)} 在 mp 可达处内嵌字体 data-URI（base64）——会编进 wxss 撑爆包体积。字体走 wx.loadFontFace 远程加载、勿 base64 内嵌`
              )
            }
          }
        }
      }
      scan(srcDir)
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
    // 分段视频地址「缓存 + 预取」（根因#8 真机才暴露的段间转场卡顿，dev/模拟器快网掩盖）。痛：原 player
    // 只在「段 id 真变了」那一刻才云调用 getPlaybackUrl 换临时 URL（watch 触发），当前段播放期间下一段
    // 地址闲着没取、回看过的段也重新现取 → 切段要等一个云往返才起播。改＝纯函数解析器 playbackCache.js
    // （createPlaybackResolver：按 segId+TTL 缓存 + in-flight 去重）收口于 store（playbackUrl 缓存优先 +
    // prefetchPlaybackUrl），player 当前段就绪即预取下一段。本守卫防回退成「每次切段都现取、无缓存无预取」。
    id: 'player-playback-prefetch-cache',
    roots: ['#8'],
    desc: '分段视频地址缓存+预取（根因#8 真机段间卡顿）：utils/playbackCache.js 导出 createPlaybackResolver + store/courses.js 经它收口 playbackUrl(缓存优先) 且有 prefetchPlaybackUrl + player/index.vue 当前段就绪即 prefetch 下一段——防回退成「每次切段都现取地址、无缓存无预取」',
    run() {
      const bad = []
      // 解析器在主包 utils（非分包 pkg-video）：store 在主包·主包不能 require 分包模块（mp-weixin 白屏·根因#8）
      const cacheRel = 'packages/miniapp/src/utils/playbackCache.js'
      const storeRel = 'packages/miniapp/src/store/courses.js'
      const playerRel = 'packages/miniapp/src/pkg-video/player/index.vue'
      const cacheAbs = join(ROOT, cacheRel)
      if (!existsSync(cacheAbs)) bad.push(`${cacheRel} 缺失（分段地址缓存/预取纯函数·根因#8）`)
      else if (!/export\s+function\s+createPlaybackResolver\b/.test(readFileSync(cacheAbs, 'utf8')))
        bad.push(`${cacheRel} 未导出 createPlaybackResolver——缓存/去重/预取逻辑须在纯函数工厂里（单测锁·根因#8）`)
      const storeAbs = join(ROOT, storeRel)
      if (!existsSync(storeAbs)) bad.push(`${storeRel} 缺失`)
      else {
        const s = readFileSync(storeAbs, 'utf8')
        if (!/createPlaybackResolver\s*\(/.test(s))
          bad.push(`${storeRel} 未经 createPlaybackResolver 收口取址——playbackUrl 须走缓存优先解析器（防每次现取·根因#8）`)
        if (!/\bprefetchPlaybackUrl\b/.test(s))
          bad.push(`${storeRel} 无 prefetchPlaybackUrl——下一段地址须可预取（防切段等云往返·根因#8）`)
      }
      const playerAbs = join(ROOT, playerRel)
      if (!existsSync(playerAbs)) bad.push(`${playerRel} 缺失`)
      else if (!/\bprefetchPlaybackUrl\b/.test(readFileSync(playerAbs, 'utf8')))
        bad.push(`${playerRel} 未预取下一段——当前段就绪时须 prefetch 下一段地址（防切段卡一下·根因#8）`)
      // 列表页提前预热：还在课时列表时就把第一段地址换好进缓存 → 点进播放页免取址往返（首屏提速）
      const catRel = 'packages/miniapp/src/pages/catalog/index.vue'
      const catAbs = join(ROOT, catRel)
      if (!existsSync(catAbs)) bad.push(`${catRel} 缺失`)
      else if (!/\bprefetchPlaybackUrl\b/.test(readFileSync(catAbs, 'utf8')))
        bad.push(`${catRel} 列表页未预热第一段地址——进课时列表即应 prefetchPlaybackUrl 暖缓存（防回退成进播放页才取址·根因#8）`)
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
        for (const e of readdirSync(dir)) {
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
      //    /q 扫码落地页 + site/ 公网官网落地页（www.luckyducky.cn 根）
      for (const page of ['packages/admin/public/q/index.html', 'site/index.html']) {
        const absP = join(ROOT, page)
        if (existsSync(absP))
          for (const ban of BANNED)
            if (readFileSync(absP, 'utf8').includes(ban))
              bad.push(`${page} 仍含品牌名漂移变体「${ban}…」——用户可见品牌页，须替为「小棉鸭」（病根#5）`)
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
      for (const e of readdirSync(dir)) {
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
      for (const f of readdirSync(dir)) {
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
    // 守卫计数 + 病根计数 + 测试计数自洽（文档体系规则⑥·客观计数机器维护·巡检 #009 ④/💡）：守卫数随加守卫
    // 天天涨、病根数随立新病根涨（12→13）、被手抄进治理文档必漂（#009 标 31 vs 真值 35；治理体检抓到
    // 自动化验证系统「13 条 repoCheck」vs 真值 86、元模式/账本「12 类病根」vs 真值 13）——同 collection-count-synced
    // 的「客观计数别手抄」病（病根#11），但作用在**治理文档自身**：元守卫 guard-coverage 只核「病根↔守卫」逻辑闭环、
    // 不核这些计数，于是它们漂了没人发现。本守卫补这条缝：repoChecks/fileRules 数组长度＝守卫数真值（含本守卫自己）、
    // 根因账本 §一 `### N.` 病根数＝病根数真值（与 guard-coverage 同源），**全部治理文档**里「N repoCheck / M fileRule /
    // K 类病根」须报同一数。测试数无静态真值源（vitest 才报准·跑全套太重不进静态闸），只校验 现状与路线 内多处「测试 N」自洽。
    id: 'guard-count-synced',
    roots: ['#11'],
    desc: '客观计数机器维护（规则⑥·病根#11·治理文档自身防漂）：repoChecks/fileRules 数组长度为守卫数真值、根因账本 §一 `### N.` 数为病根数真值（与 guard-coverage 同源）；所有治理文档（现状与路线/自动化验证系统/CLAUDE/元模式/根因账本）里「N repoCheck / M fileRule / K 类病根」须报同一数（防手抄漂移·体检抓的 13≠86、12≠13 那类）。测试数无静态真值源，只校验现状与路线内多处「测试 N」自洽',
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
      // 测试数：无静态真值源（vitest 才报准），只校验现状与路线内多处「测试 N」互相自洽——防 337 vs 326 自相矛盾
      const sl = join(ROOT, 'docs/现状与路线.md')
      if (existsSync(sl)) {
        const text = readFileSync(sl, 'utf8')
        const tn = [
          ...[...text.matchAll(/(\d+)\s*测试/g)].map((m) => m[1]),
          ...[...text.matchAll(/测试\s*\**\s*(\d+)/g)].map((m) => m[1]),
        ]
        if (new Set(tn).size > 1)
          bad.push(`现状与路线.md 测试数多处不一致：${[...new Set(tn)].join(' vs ')}（手抄自相矛盾·状态只一处权威·规则⑥）`)
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
    // 订单域派生物与声明同步（P3「安全处生成」spike·北极星 A）：order.spec.ts 是订单/售后状态机的
    // 声明单源；order.ts（类型/常量/流转表）与 scripts/order-domain.generated.json 是其生成物。
    // 改声明须跑 `node scripts/gen-order-domain.mjs` 同步生成物——漂移即红，杜绝「改了声明忘重生成」。
    id: 'gen-order-domain-synced',
    roots: ['#2', 'P3'],
    desc: '订单+learning 域派生物与声明同步（P3 安全处生成·扩 learning）：order.ts/learning.ts/order-domain.generated.json 由 order.spec.ts+learning.spec.ts 经 scripts/gen-order-domain.mjs 生成；漂移（改声明未重生成）即红——跑 `node scripts/gen-order-domain.mjs` 修复',
    run() {
      const spec = join(ROOT, 'packages/shared/src/order.spec.ts')
      const learnSpec = join(ROOT, 'packages/shared/src/learning.spec.ts')
      if (!existsSync(spec)) return ['packages/shared/src/order.spec.ts 缺失（订单域声明单源·P3）']
      if (!existsSync(learnSpec)) return ['packages/shared/src/learning.spec.ts 缺失（learning 域声明单源·P3 扩）']
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
    desc: '用户反馈写库过闸+限频+集合登记（运营钩子①·待办#23）：submitFeedback 须经 withOpenId + withRateLimit（根因#3/#13·公网用户写函数防伪+防刷）且写 COLLECTIONS.feedback（known-collections-only 同治）；cloudbaserc 须配 submitFeedback（漏配真部署卡交互·根因#8）',
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
      // cloudbaserc 须配（漏配真部署卡交互确认·根因#8·同 deploy-config-complete 兜一道）
      const rc = join(ROOT, 'cloudbaserc.json')
      if (existsSync(rc) && !/"submitFeedback"/.test(readFileSync(rc, 'utf8')))
        bad.push('cloudbaserc.json 未配 submitFeedback——真部署会卡交互确认（根因#8）')
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
        for (const f of readdirSync(d)) {
          const fp = join(d, f)
          if (statSync(fp).isDirectory()) src += readAll(fp)
          else if (f.endsWith('.ts')) src += readFileSync(fp, 'utf8')
        }
        return src
      }
      // 单元清单：functions/ 递归到「文件」或「含 index.ts 的目录」为一单元（与旧线域级聚合同保护强度、粒度更细）
      const units = []
      const collect = (d) => {
        for (const e of readdirSync(d)) {
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
        for (const e of readdirSync(d)) {
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
    id: 'rw-site-in-gates',
    roots: ['铁律'],
    desc: '内容站三件套在位（M4·GEO 基建=可爬可收录的机器面）：astro.config 配 site 域名 + sitemap 集成；public/robots.txt 在；教程内容 frontmatter 带 reviewed 标记（AI 起草未审稿不冒充定稿——写真机器可核）',
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
      if (!existsSync(join(base, 'public/robots.txt'))) bad.push('public/robots.txt 缺失——爬虫策略未声明')
      const layout = join(base, 'src/layouts/Base.astro')
      if (existsSync(layout)) {
        const l = readFileSync(layout, 'utf8')
        for (const og of ['og:title', 'og:description', 'og:url']) {
          if (!l.includes(og)) bad.push(`Base.astro 缺 ${og}——社交分享/引擎摘要卡不全（GEO 面）`)
        }
      }
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
        for (const e of readdirSync(d)) {
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
    id: 'rw-m5-runbook-synced',
    roots: ['正册'],
    desc: 'M5 切换 runbook 与部署面同步：rewrite/M5-切换runbook.md 须存在，且 rewrite/cloud 每个函数单元名与并行期定名 adminApiV2 都出现在 runbook 内——函数增删改名 runbook 必跟，防切换日拿陈账操刀',
    run() {
      const base = join(ROOT, 'rewrite/cloud/src/functions')
      if (!existsSync(base)) return []
      const rbPath = join(ROOT, 'rewrite/M5-切换runbook.md')
      if (!existsSync(rbPath)) return ['rewrite/M5-切换runbook.md 缺失——M5 切换脚本未成文（切换日无脚本可循）']
      const rb = readFileSync(rbPath, 'utf8')
      const bad = []
      const isFn = (p) => readFileSync(p, 'utf8').includes('export const main')
      const need = ['adminApiV2']
      for (const e of readdirSync(base)) {
        const p = join(base, e)
        if (!statSync(p).isDirectory()) continue
        if (existsSync(join(p, 'index.ts')) && isFn(join(p, 'index.ts'))) {
          need.push(e)
          continue
        }
        for (const c of readdirSync(p)) {
          const cp = join(p, c)
          if (statSync(cp).isDirectory()) {
            if (existsSync(join(cp, 'index.ts')) && isFn(join(cp, 'index.ts'))) need.push(c)
          } else if (c.endsWith('.ts') && isFn(cp)) need.push(c.slice(0, -3))
        }
      }
      for (const n of need) if (!rb.includes('`' + n + '`')) bad.push(`M5 runbook 缺函数 ${n}——部署面与脚本漂移（切换日会漏部署/漏核）`)
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
        for (const e of readdirSync(d)) {
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
    id: 'rw-fen-branded-type',
    mechanism: 'ts',
    roots: ['#4'],
    reverseTest: '新线：浮点金额赋给 Fen → tsc 编译失败（rewrite/shared Fen 品牌类型；随 rw-line-in-gates 接入 typecheck 闸）',
  },
  {
    id: 'rw-contracts-golden',
    mechanism: 'test',
    roots: ['#4', '#2', '#5'],
    reverseTest: 'rewrite/shared/tests/money.test.ts',
  },
  {
    id: 'rw-kit-golden',
    mechanism: 'test',
    roots: ['#1', '#2', '#3', '#7', '#13'],
    reverseTest: 'rewrite/cloud/tests/transition.test.ts',
  },
  {
    id: 'rw-user-catalog-golden',
    mechanism: 'test',
    roots: ['#1', '#3'],
    reverseTest: 'rewrite/cloud/tests/app-user.test.ts',
  },
  {
    id: 'rw-learning-golden',
    mechanism: 'test',
    roots: ['#1', '#2', '#3'],
    reverseTest: 'rewrite/cloud/tests/app-learning.test.ts',
  },
  {
    id: 'rw-reviews-golden',
    mechanism: 'test',
    roots: ['#1', '#3', '#7'],
    reverseTest: 'rewrite/cloud/tests/app-reviews.test.ts',
  },
  {
    id: 'rw-money1-golden',
    mechanism: 'test',
    roots: ['#1', '#2', '#3', '#4'],
    reverseTest: 'rewrite/cloud/tests/app-orders.test.ts',
  },
  {
    id: 'rw-money2-golden',
    mechanism: 'test',
    roots: ['#1', '#2', '#3', '#4', '#12'],
    reverseTest: 'rewrite/cloud/tests/app-pay.test.ts',
  },
  {
    id: 'rw-money3-golden',
    mechanism: 'test',
    roots: ['#1', '#2', '#3', '#4', '#7'],
    reverseTest: 'rewrite/cloud/tests/app-refund.test.ts',
  },
  {
    id: 'rw-cs1-golden',
    mechanism: 'test',
    roots: ['#1', '#3', '#12'],
    reverseTest: 'rewrite/cloud/tests/app-cs1.test.ts',
  },
  {
    id: 'rw-cs2-golden',
    mechanism: 'test',
    roots: ['#1', '#3', '#5', '#8'],
    reverseTest: 'rewrite/cloud/tests/app-cs2.test.ts',
  },
  {
    id: 'rw-admin1-golden',
    mechanism: 'test',
    roots: ['#3', '#13'],
    reverseTest: 'rewrite/cloud/tests/app-admin1.test.ts',
  },
  {
    id: 'rw-admin2-golden',
    mechanism: 'test',
    roots: ['#3', '#7', '#8'],
    reverseTest: 'rewrite/cloud/tests/app-admin2.test.ts',
  },
  {
    id: 'rw-admin3-golden',
    mechanism: 'test',
    roots: ['#1', '#2', '#3', '#4'],
    reverseTest: 'rewrite/cloud/tests/app-admin3.test.ts',
  },
  {
    id: 'rw-admin4-golden',
    mechanism: 'test',
    roots: ['#4', '#7', '#8'],
    reverseTest: 'rewrite/cloud/tests/app-admin4.test.ts',
  },
  {
    id: 'rw-admin5-golden',
    mechanism: 'test',
    roots: ['#3', '#7', '#8'],
    reverseTest: 'rewrite/cloud/tests/app-admin5.test.ts',
  },
  {
    id: 'rw-admin6-golden',
    mechanism: 'test',
    roots: ['#1', '#3', '#4'],
    reverseTest: 'rewrite/cloud/tests/app-admin6.test.ts',
  },
  {
    id: 'rw-scm-golden',
    mechanism: 'test',
    roots: ['#1', '#2', '#4', '#7'],
    reverseTest: 'rewrite/cloud/tests/app-scm.test.ts',
  },
  {
    id: 'rw-misc-golden',
    mechanism: 'test',
    roots: ['#1', '#3', '#7', '#13'],
    reverseTest: 'rewrite/cloud/tests/app-misc.test.ts',
  },
  {
    id: 'rw-mp-home-golden',
    mechanism: 'test',
    roots: ['#8'],
    reverseTest: 'rewrite/mp/tests/home-map.test.ts',
  },
  {
    id: 'rw-mp-detail-golden',
    mechanism: 'test',
    roots: ['#8'],
    reverseTest: 'rewrite/mp/tests/detail-map.test.ts',
  },
  {
    id: 'rw-mp-cart-golden',
    mechanism: 'test',
    roots: ['#4', '#8'],
    reverseTest: 'rewrite/mp/tests/cart.test.ts',
  },
  {
    id: 'rw-mp-checkout-golden',
    mechanism: 'test',
    roots: ['#4', '#6', '#8'],
    reverseTest: 'rewrite/mp/tests/checkout.test.ts',
  },
  {
    id: 'rw-mp-pay-golden',
    mechanism: 'test',
    roots: ['#4', '#8'],
    reverseTest: 'rewrite/mp/tests/pay-flow.test.ts',
  },
  {
    id: 'rw-mp-orders-golden',
    mechanism: 'test',
    roots: ['#2', '#8'],
    reverseTest: 'rewrite/mp/tests/orders-map.test.ts',
  },
  {
    id: 'rw-mp-aftersales-golden',
    mechanism: 'test',
    roots: ['#4', '#8'],
    reverseTest: 'rewrite/mp/tests/aftersales-map.test.ts',
  },
  {
    id: 'rw-flow-observable',
    mechanism: 'test',
    roots: ['#12', '#8', '#14'],
    reverseTest: 'rewrite/cloud/tests/flow.test.ts',
  },
  {
    id: 'rw-mp-learning-golden',
    mechanism: 'test',
    roots: ['#2', '#8'],
    reverseTest: 'rewrite/mp/tests/learning-map.test.ts',
  },
  {
    id: 'rw-mp-player-golden',
    mechanism: 'test',
    roots: ['#7', '#8'],
    reverseTest: 'rewrite/mp/tests/player.test.ts',
  },
  {
    id: 'rw-mp-reviews-golden',
    mechanism: 'test',
    roots: ['#8'],
    reverseTest: 'rewrite/mp/tests/reviews-map.test.ts',
  },
  {
    id: 'rw-mp-me-golden',
    mechanism: 'test',
    roots: ['#6', '#8'],
    reverseTest: 'rewrite/mp/tests/continue-resolve.test.ts',
  },
  {
    id: 'rw-mp-privacy-golden',
    mechanism: 'test',
    roots: ['R27', '#8'],
    reverseTest: 'rewrite/mp/tests/privacy-gate.test.ts',
  },
  {
    id: 'rw-admin-money-ui-golden',
    mechanism: 'test',
    roots: ['#4', '#8'],
    reverseTest: 'rewrite/admin/tests/money-ui.test.ts',
  },
  {
    id: 'rw-admin-products-ui-golden',
    mechanism: 'test',
    roots: ['#8'],
    reverseTest: 'rewrite/admin/tests/products-ui.test.ts',
  },
  {
    id: 'rw-admin-content-ui-golden',
    mechanism: 'test',
    roots: ['#8', '#12'],
    reverseTest: 'rewrite/admin/tests/content-ui.test.ts',
  },
  {
    id: 'rw-admin-cs-ui-golden',
    mechanism: 'test',
    roots: ['#8'],
    reverseTest: 'rewrite/admin/tests/cs-ui.test.ts',
  },
  {
    id: 'rw-admin-system-ui-golden',
    mechanism: 'test',
    roots: ['#4', '#8'],
    reverseTest: 'rewrite/admin/tests/system-ui.test.ts',
  },
  {
    id: 'rw-admin-scm-ui-golden',
    mechanism: 'test',
    roots: ['#4', '#8'],
    reverseTest: 'rewrite/admin/tests/scm-ui.test.ts',
  },
  {
    id: 'rw-agent-ui-golden',
    mechanism: 'test',
    roots: ['#8'],
    reverseTest: 'rewrite/agent/tests/desk.test.ts',
  },
  {
    id: 'rw-site-schema-golden',
    mechanism: 'test',
    roots: ['#8'],
    reverseTest: 'rewrite/site/tests/schema.test.ts',
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
]

// export：供 check-report 体检面板复用同一套遍历/判定（面板=派生视图，禁自建第二套语义）
export const SRC_DIRS = ['packages', 'cloudfunctions', 'scripts']
export function* walk(dir) {
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

export function checkFile(file) {
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
