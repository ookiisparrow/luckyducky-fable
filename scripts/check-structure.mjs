#!/usr/bin/env node
/**
 * 结构不变量检查——重构主张的「机器守卫」。
 *
 * （原 check-conventions 扫描器已随旧线退役——单文件样式/多端写法类规则现走本文件 fileRule + eslint。）
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
import { builtinModules } from 'node:module'
import { findDeadExports, findPhantomDeps, checkBudget, collectImportSpecifiers } from './lib/slim-scan.mjs'
import { allDeployNames } from './lib/deploy-aliases.mjs' // 部署别名单源（产物→云函数名·adminApi 亦部署为 adminApiV2·病根#16）
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
// 仅作人读的出处标注。
// ── 单一接缝守卫注册表（第一性原理审计批 2026-07-23·元模式「守卫准入」：同类合成一张注册表+一条守卫）──
// 五条「平台/原语接缝单点」守卫的判定骨架完全同构：扫 rewrite/cloud/src 全部 .ts → 特征 pattern 命中且不在
// allow 名单即红。骨架折成一个 makeSeamGuard 生成器 + 本表五行；守卫 id / 红词 / 逐条额外断言原样保留——
// 外部文档与代码注释引用的守卫 id 不变，reverse 自检语义不变。新增平台接缝只加表行、不复制 walk。表列语义：
//   seam＝唯一允许出现点 · pattern＝接缝特征（string=includes / RegExp=test·无 g flag）· strip＝剥注释再匹配（E1/E10）
//   seamMissing＝接缝文件缺失红词（五条全 fail-closed：守卫目标消失须显式退役守卫，不静默绿）
//   seamMustHit＝接缝文件本身须命中 pattern 的红词（防接缝空壳）· seamAssert＝对接缝剥注释源码的额外断言
//   allow＝seam 外额外放行文件 · extra＝注册表装不下的逐条特例（bot-push 调用方接通性 / vod getPlaybackUrl 分流）
export const SINGLE_SEAM_REGISTRY = [
  {
    // 企微推送单一收口·重写线（观测批5·治病根#14「告警不进人眼」+ 根因#13/#12 接缝单点）：pushBotAlert 仅
    // 定义于 kit/botpush.ts、仅 kit/observe.ts(notifyAlert) 调；其余不得直达（防散调/绕 alertEvents 开关/webhook 凭证多处）。
    id: 'rw-bot-push-single-seam',
    roots: ['#12', '#13', '#14'],
    desc: '企微推送单一收口·重写线：pushBotAlert 仅在 rewrite/cloud/src/kit/botpush.ts 定义、仅 kit/observe.ts 调用；其余不得直达（防散调/绕开关/凭证多处·根因#13/#12）',
    seam: 'rewrite/cloud/src/kit/botpush.ts',
    pattern: /pushBotAlert|['"][^'"]*\/botpush['"]/,
    strip: false,
    allow: ['rewrite/cloud/src/kit/observe.ts'],
    seamMissing: 'rewrite/cloud/src/kit/botpush.ts 缺失——企微推送接缝单点（重写线·根因#13）',
    hitMsg: '直达 pushBotAlert/botpush——企微推送须经 kit/observe.notifyAlert 单一收口（重写线·根因#12）',
    seamAssert: (src) =>
      /export\s+async\s+function\s+pushBotAlert/.test(src) ? [] : ['rewrite/cloud/src/kit/botpush.ts 未导出 pushBotAlert——接缝空壳'],
    extra: () => {
      const caller = 'rewrite/cloud/src/kit/observe.ts'
      if (existsSync(join(ROOT, caller)) && !/pushBotAlert/.test(readFileSync(join(ROOT, caller), 'utf8')))
        return [`${caller}(notifyAlert) 未调 pushBotAlert——接缝未接通（死代码）`]
      return []
    },
  },
  {
    // 原料账单点收口——新线扫描面（批K·SCM 门1·根因#1/#2·移植 material-stock-single-seam）：kit/scmStock.ts
    // 头注承诺「全库唯一 materials.stock/stockLedger 读写处」，applyStockMoves 须导出、CAS 须用条件 where(stock)。
    id: 'rw-material-stock-single-seam',
    roots: ['#1', '#2'],
    desc: '新线原料账单点收口（SCM 门1·根因#1/#2·批K·移植 material-stock-single-seam，同 rw-order-transitions-declared 精神：旧守卫只扫冻结线，kit/scmStock.ts 头注承诺的保护对生产代码此前是假的）：materials.stock/stockLedger 仅 rewrite/cloud/src/kit/scmStock.ts 读写（applyStockMoves 唯一入口·乐观 CAS）；rewrite/cloud/src 其余文件直碰即红（防绕 CAS/绕流水改账）',
    seam: 'rewrite/cloud/src/kit/scmStock.ts',
    pattern: /COLLECTIONS\.(materials|stockLedger)\b|\.collection\(\s*['"](materials|stockLedger)['"]\s*\)/,
    strip: true,
    seamMissing: 'rewrite/cloud/src/kit/scmStock.ts 缺失——生产线原料账原语（SCM 门1）·守卫目标消失须显式退役本守卫',
    hitMsg: '直碰 materials/stockLedger 集合——原料账读写须经 kit/scmStock（SCM 门1·防绕 CAS/绕流水）',
    seamAssert: (src) => {
      const bad = []
      if (!/export\s+async\s+function\s+applyStockMoves/.test(src))
        bad.push('rewrite/cloud/src/kit/scmStock.ts 未导出 applyStockMoves——门1 空壳')
      if (!/\.where\(\{[^}]*stock/.test(src))
        bad.push('rewrite/cloud/src/kit/scmStock.ts 库存变更未用条件 where(stock) 乐观 CAS——有并发互覆盖风险（根因#1）')
      return bad
    },
  },
  {
    // VOD 平台接缝单点（根因#12·决策§31 转码管线批1·镜像 flow-seam-via-kit 之于支付工作流）：腾讯云点播平台
    // 触点（Key 防盗链签名算法/服务端 API 域名）收口 kit/vod.ts 一处；extra 焊 getPlaybackUrl 新旧双线前缀分流
    // 四件套（业务不变量·与接缝单点判定异构，故留 extra 不进骨架）：分流拆掉任意一半，存量或转码课程之一必哑。
    id: 'rw-vod-seam-single',
    roots: ['#12'],
    desc: 'VOD 平台接缝单点（决策§31 批1）：kit/vod.ts 必须存在且为 rewrite/cloud/src 内唯一含 tencentcloudapi.com 字面量的文件；learning.ts getPlaybackUrl 段须含 isVodFileId + signVodPlayUrl + getTempUrl + vodUrl 四件套前缀分流——接缝散写/分流缺失即红',
    seam: 'rewrite/cloud/src/kit/vod.ts',
    pattern: 'tencentcloudapi.com',
    strip: true,
    seamMissing: 'rewrite/cloud/src/kit/vod.ts 不存在——VOD 平台接缝单点未建（根因#12·决策§31 转码管线批1）',
    hitMsg: '含腾讯云 API 域名字面量——VOD 平台触点必须收口 kit/vod.ts 单点（根因#12）',
    extra: () => {
      const bad = []
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
    // 图像处理接缝单点（批1·根因#12 平台规则外部风险）：数据万象（CI）imageMogr2 处理参数拼接收口
    // kit/storage.ts withImageProc 一处——控制台开通/参数格式变化只改这里 + 环境变量 LD_IMAGE_PROC。
    id: 'rw-image-proc-seam-single',
    roots: ['#12'],
    desc: '图像处理接缝单点（根因#12 平台规则外部风险）：数据万象 imageMogr2 处理参数拼接全库仅 rewrite/cloud/src/kit/storage.ts 一处（withImageProc）——控制台开通/参数格式变化改一处；别处出现 imageMogr2 字面量即红（同 flow-seam-single 形状）',
    seam: 'rewrite/cloud/src/kit/storage.ts',
    pattern: 'imageMogr2',
    strip: false,
    seamMissing: 'rewrite/cloud/src/kit/storage.ts 应为 imageMogr2 图像处理参数唯一出现点（withImageProc），未见——接缝单点缺失',
    seamMustHit: 'rewrite/cloud/src/kit/storage.ts 应为 imageMogr2 图像处理参数唯一出现点（withImageProc），未见——接缝单点缺失',
    hitMsg: '出现 imageMogr2——图像处理接缝须收口 kit/storage.ts 单点（根因#12）',
  },
  {
    // 平台接缝单点（根因#12）rewrite 镜像：cloudbase_module 支付/退款工作流调用仅 kit/flow.ts（callFlow）一处。
    id: 'rw-flow-seam-single',
    roots: ['#12'],
    desc: '平台接缝单点（根因#12 平台规则外部风险）镜像：cloudbase_module 工作流调用 rewrite/cloud/src 内仅 kit/flow.ts 一处（callFlow），平台规则变化改动面最小',
    seam: 'rewrite/cloud/src/kit/flow.ts',
    pattern: "'cloudbase_module'",
    strip: false,
    seamMissing: 'rewrite/cloud/src/kit/flow.ts 应为 cloudbase_module 唯一调用点（callFlow），未见——接缝单点缺失（rewrite 镜像）',
    seamMustHit: 'rewrite/cloud/src/kit/flow.ts 应为 cloudbase_module 唯一调用点（callFlow），未见——接缝单点缺失（rewrite 镜像）',
    hitMsg: '直调 cloudbase_module——接缝须收口 kit callFlow 单点（根因#12·rewrite 镜像）',
  },
]

// 注册表行 → repoCheck 守卫对象（骨架单源；per-row 差异全走表列，判定语义与折叠前逐条等价）
const makeSeamGuard = (s) => ({
  id: s.id,
  roots: s.roots,
  desc: s.desc,
  run() {
    const srcRoot = join(ROOT, 'rewrite/cloud/src')
    if (!existsSync(srcRoot)) return ['rewrite/cloud/src 缺失——守卫扫描面消失（rw-flow-seam-single）']
    const seamAbs = join(ROOT, s.seam)
    if (!existsSync(seamAbs)) return [s.seamMissing]
    const readMatchable = (abs) => (s.strip ? stripComments(readFileSync(abs, 'utf8')) : readFileSync(abs, 'utf8'))
    const hit = (text) => (typeof s.pattern === 'string' ? text.includes(s.pattern) : s.pattern.test(text))
    const bad = []
    if (s.seamAssert) bad.push(...s.seamAssert(stripComments(readFileSync(seamAbs, 'utf8'))))
    if (s.seamMustHit && !hit(readMatchable(seamAbs))) bad.push(s.seamMustHit)
    const allow = new Set([s.seam, ...(s.allow || [])])
    const walk = (d) => {
      for (const e of lsScan(d)) {
        const p = join(d, e)
        if (statSync(p).isDirectory()) walk(p)
        else if (e.endsWith('.ts')) {
          const rel = relative(ROOT, p).replace(/\\/g, '/')
          if (allow.has(rel)) continue
          if (hit(readMatchable(p))) bad.push(`${rel} ${s.hitMsg}`)
        }
      }
    }
    walk(srcRoot)
    if (s.extra) bad.push(...s.extra())
    return bad
  },
})

export const repoChecks = [
  ...SINGLE_SEAM_REGISTRY.map(makeSeamGuard),
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
    // 客服小程序卡片 pagepath 须为已注册路由（根因#8 桩过≠真机能开·外审 R1-R4·P2.11）：cs/kfCallback/dispatch.ts
    // 的 miniprogram route 写死 page 字符串，曾写错 pages/aftersale（少 s·实际 aftersales）、pages/course（实际在
    // pkg-video 分包 = pkg-video/courses/index）——桩测把错路径锁成假绿，真机点卡片打不开目标页。锁每个 page 都在
    // pages.json 注册（主包 path + 分包 root/path），路由改名/迁分包后客服卡片当场红。
    id: 'kf-card-page-registered',
    roots: ['#8'],
    desc: '客服卡片 pagepath 须为小程序已注册路由（根因#8·外审 P2.11）：旧线 packages/cloud dispatch.ts×pages.json + 新线 rewrite/cloud dispatch.ts×rewrite/mp/app.json（主包 pages + subPackages root/path）双面扫——防卡片跳不存在页真机打不开。课程链路审计 2026-07-17 扩新线面：原只扫旧线冻结参照，新线死链（pkg-video 分包路径从未落地）在守卫真空里假绿',
    run() {
      const bad = []
      // 旧线面已随 packages/ 删除（2026-07-23 瘦身拍板批）
      // 新线（原生小程序 app.json·真正部署面）
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
  // ── 后台360工作站 B1.1：模块化框架（架构规范五铁律）+ §1.5 信任边界（360 读越权面）──
  // provider/registry/编排器在 functions/admin/adminApi/customer360/；4 模块守卫焊「板块不散落/解耦/经接口/可开关」，
  // 2 信任边界守卫焊「360 读他人全貌→破例留痕 + 能力闸」（补 admin-actions-audited 跳 ^get 的盲区）。原 B0 框架并入本批·守卫随首个真 provider 立、咬真板块（防过度工程裁决）。
  {
    // 后台360工作站 B2.2 节点诊断·UGC 图片入库前必过内容安全（根因#3 信任边界 fail-closed）：学员拍照上传是
    // 本项目第一个「用户图片入库」越权写面——黄暴恐违规图直接入库＝合规风险。守此不变量：① kit/contentsec.ts
    // 内容安全接缝须真调 cloud.openapi.security.imgSecCheck（非注释摆设·扫真实调用模式·防假绿）；② 写 checkpoints
    // 的 UGC 上传函数 submitCheckpointPhoto 须调 imgSecCheck 接缝（入库前·校不过不存）。真机验图真能拦属根因#8 靠人。
    id: 'ugc-imgsecchecked',
    roots: ['#3'],
    desc: 'UGC 内容安全入库前必校（根因#3 fail-closed）：kit/contentsec.ts 接缝须真调 cloud.openapi.security.imgSecCheck（图）+ .msgSecCheck（文本）；写 UGC 图的函数——checkpoint.ts 写 checkpoints / reviews.ts 存买家秀 photos / user.ts 头像——须调 imgSecCheck；写 UGC 文本的函数——reviews.ts 评价 text/tags、user.ts 昵称/签名——须调 msgSecCheck，防违规图/文直接入库（节点诊断拍照 B2.2 + 买家秀晒图 + 昵称/签名/头像公开展示面）',
    run() {
      const bad = []
      // 旧线 contentsec/submitCheckpointPhoto 段已随 packages/ 删除（2026-07-23 瘦身拍板批）；本守卫只守活线
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
    desc: '生产部署闸（接管 tcb + wechatide 官方 CLI，用户拍板 A/2026-07-24 正式接入批）：**实跑** guard-deploy 断言行为——敏感函数/批量部署/wechatide 写工具（upload/cloud_fn_deploy/cloud_db_write_*/cloud_manage_storage）→ask 二次确认、读类/单个非敏感→放行、提交信息字样不误拦。行为偏离即红（grep 易被注释蒙混，故跑真行为）',
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
        // wechatide 官方 CLI 接管（2026-07-24 正式接入批）：写工具一律 ask，读类/项目列表管理放行
        ['wechatide -c x upload --project rewrite/mp --upload-version 1.0.0', 'ask'], // 发布体验版
        ['wechatide -c x cloud_fn_deploy --dir dist/app', 'ask'], // 云函数部署
        ['wechatide -c x cloud_db_write_doc --collection orders', 'ask'], // 云数据库写
        ['wechatide -c x cloud_manage_storage --action upload', 'ask'], // 云存储写
        ['wechatide -c x project_list', 'allow'], // 只读列出项目
        ['wechatide -c x cloud_query_storage', 'allow'], // 只读查云存储（不与 cloud_manage_storage 误撞）
        ['git commit -m chore-wechatide-upload-skill', 'allow'], // 提交信息提字样 → 不拦
      ]
      const bad = []
      for (const [cmd, want] of cases) {
        const got = decide(cmd)
        if (got !== want) bad.push(`guard-deploy「${cmd}」期望 ${want}、实际 ${got}——生产部署闸行为偏离（接管 tcb 安全线）`)
      }
      // 写工具禁包 npm script（2026-07-25 补机器守）：本闸读的是 Bash 命令**文本**，`npm run <name>` 这层
      // 间接让它看不进 package.json 里真正执行的命令——把任何写工具包成 script 即等于开一个静默绕过的洞。
      // 实证：`npm run upload:mp` 经本闸判定为 allow（而 `wechatide … upload` 直打是 ask）。
      // 此前这条纪律只写在 guard-deploy.mjs 头注里（靠人记）；2026-07-25 加 preview:mp（只读预览·合规）时
      // 顺手焊成机器守——同一位置最容易手滑把 upload 也包进去。tcb 侧同理一并咬。
      const pkgPath = join(ROOT, 'package.json')
      if (existsSync(pkgPath)) {
        let scripts = {}
        try {
          scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts || {}
        } catch {
          /* package.json 解析失败另有守卫管 */
        }
        const WRITE_TOOLS = ['upload', 'cloud_fn_deploy', 'cloud_fn_inc_deploy', 'cloud_db_write_doc', 'cloud_db_write_struct', 'cloud_manage_storage']
        for (const [name, body] of Object.entries(scripts)) {
          const cmd = String(body)
          if (!/\bwechatide\b/.test(cmd)) continue
          const hit = WRITE_TOOLS.find((t) => new RegExp('\\b' + t + '\\b').test(cmd))
          if (hit)
            bad.push(`package.json script「${name}」把 wechatide 写工具「${hit}」包进了 npm script——部署闸读命令文本、看不进 npm run 内层，等于静默绕过（写工具必须整行手打；只读类如 auto_preview 不在此限）`)
        }
      }
      return bad
    },
  },
  {
    // 红区（钱链）提交闸在位（2026-08-21 治理减负批·用户拍板「物理层面划分 AI 权限」）：闸=pre-commit 钩子
    // 拦截命中 scripts/lib/moneychain-paths.mjs 的暂存提交（MONEYCHAIN_ALLOWED=1 显式授权放行·与部署闸同模式）。
    // 本守卫守闸自身：清单存在且含关键路径、钩子真引用它——防「锁被拆了没人知道」（同 omp 闸漏3 教训·病根#16）。
    id: 'moneychain-gate-present',
    roots: ['#3'],
    desc: '红区提交闸在位（根因#3·物理隔离）：scripts/lib/moneychain-paths.mjs 存在且含 callbacks/kit 钱件/shared 契约关键路径与 isMoneychainPath 导出；scripts/git-hooks/pre-commit 含 moneychain-paths 引用与 MONEYCHAIN_ALLOWED 闸逻辑——闸被删/被改瘦即红（改红区边界=治理批须老板拍板）',
    run() {
      const bad = []
      const manifest = join(ROOT, 'scripts/lib/moneychain-paths.mjs')
      if (!existsSync(manifest)) return ['scripts/lib/moneychain-paths.mjs 缺失——红区提交闸的路径单源，重建它（含 isMoneychainPath 导出）']
      const mSrc = readFileSync(manifest, 'utf8')
      for (const must of [
        'rewrite/cloud/src/functions/callbacks/',
        'rewrite/cloud/src/kit/wxpay.ts',
        'rewrite/cloud/src/kit/transition.ts',
        'rewrite/shared/src/money.ts',
        'rewrite/shared/src/order.ts',
        'rewrite/mp/pages/checkout/',
      ])
        if (!mSrc.includes(must)) bad.push(`moneychain-paths.mjs 缺关键路径 ${must}——红区边界被收窄，补回或经治理批正式改边界`)
      if (!mSrc.includes('export function isMoneychainPath')) bad.push('moneychain-paths.mjs 缺 isMoneychainPath 导出——pre-commit 闸依赖它判定')
      const hook = join(ROOT, 'scripts/git-hooks/pre-commit')
      if (!existsSync(hook)) return ['scripts/git-hooks/pre-commit 缺失——提交闸不存在（core.hooksPath 指 scripts/git-hooks）']
      const hSrc = readFileSync(hook, 'utf8')
      if (!hSrc.includes('moneychain-paths')) bad.push('pre-commit 钩子不再引用 moneychain-paths——红区闸被拆除，恢复闸逻辑')
      if (!hSrc.includes('MONEYCHAIN_ALLOWED')) bad.push('pre-commit 钩子缺 MONEYCHAIN_ALLOWED 授权开关——红区闸语义被改，恢复')
      return bad
    },
  },
  {
    // MCP 写工具封锁（2026-07-25·用户拍板「三个都装」的安全前提·与 deploy-gated 同族）。痛：MCP 工具调用
    // 不经 Bash，guard-deploy（Bash PreToolUse hook）对它整体失明——wechat-devtools/cloudbase 两个 MCP server
    // 暴露的生产写工具（发体验版/云函数部署/产库直写/权限修改/任意云API直通）若不在 settings.json 权限层
    // deny，就是一条绕过部署闸直达生产的暗道（deny 在 bypass/auto 权限模式下依然最高优先级生效，是 MCP 面
    // 唯一可靠的闸）。清单以 2026-07-25 tools/list 协议直测实录为准（wechatide 44 工具/cloudbase 40 工具逐一
    // 过筛）；server 未挂载（.mcp.json 缺失）亦红——MCP 接入若刻意退役，按「删与加对等」同批退役本守卫。
    id: 'mcp-write-tools-denied',
    roots: ['#3'],
    desc: 'MCP 写工具封锁（fail-closed·根因#3）：.mcp.json 挂载的 wechat-devtools/cloudbase 两 MCP server，其生产写/危险工具（wechatide 6写+quit+project_remove；cloudbase 全部 manage*/write*/modify* + downloadTemplate + callCloudApi 计 18）须逐条出现在 .claude/settings.json permissions.deny——MCP 调用不经 Bash、guard-deploy 对其失明，deny 是 MCP 面唯一的闸；缺一条即红',
    run() {
      const bad = []
      const REQUIRED_DENY = [
        'mcp__wechat-devtools__upload',
        'mcp__wechat-devtools__cloud_fn_deploy',
        'mcp__wechat-devtools__cloud_fn_inc_deploy',
        'mcp__wechat-devtools__cloud_db_write_doc',
        'mcp__wechat-devtools__cloud_db_write_struct',
        'mcp__wechat-devtools__cloud_manage_storage',
        'mcp__wechat-devtools__project_remove',
        'mcp__wechat-devtools__quit',
        'mcp__cloudbase__envDomainManagement',
        'mcp__cloudbase__manageEnv',
        'mcp__cloudbase__writeNoSqlDatabaseStructure',
        'mcp__cloudbase__writeNoSqlDatabaseContent',
        'mcp__cloudbase__modifyDataModel',
        'mcp__cloudbase__managePgDatabase',
        'mcp__cloudbase__manageMysqlDatabase',
        'mcp__cloudbase__manageFunctions',
        'mcp__cloudbase__manageHosting',
        'mcp__cloudbase__manageStorage',
        'mcp__cloudbase__manageCloudRun',
        'mcp__cloudbase__manageGateway',
        'mcp__cloudbase__manageAppAuth',
        'mcp__cloudbase__manageApps',
        'mcp__cloudbase__managePermissions',
        'mcp__cloudbase__manageAgents',
        'mcp__cloudbase__downloadTemplate',
        'mcp__cloudbase__callCloudApi',
      ]
      const mcpPath = join(ROOT, '.mcp.json')
      if (!existsSync(mcpPath)) {
        bad.push('.mcp.json 缺失——MCP 接入被拆（2026-07-25 用户拍板装载）；若刻意退役 MCP，同批退役本守卫（删与加对等）')
        return bad
      }
      let servers = {}
      try {
        servers = JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers || {}
      } catch {
        bad.push('.mcp.json 不是合法 JSON')
        return bad
      }
      for (const name of ['wechat-devtools', 'cloudbase'])
        if (!servers[name]) bad.push(`.mcp.json 缺 ${name} server——MCP 接入面不完整（拆卸须同批退役本守卫）`)
      const settingsPath = join(ROOT, '.claude/settings.json')
      let deny = []
      try {
        deny = JSON.parse(readFileSync(settingsPath, 'utf8'))?.permissions?.deny || []
      } catch {
        bad.push('.claude/settings.json 读取/解析失败——deny 闸状态不可知（fail-closed 判红）')
        return bad
      }
      for (const t of REQUIRED_DENY)
        if (!deny.includes(t))
          bad.push(`settings.json permissions.deny 缺「${t}」——MCP 生产写暗道未封（guard-deploy 对 MCP 失明·根因#3）`)
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
    // （清存量或显式接受风险记账·待办见 GitHub Issues）。仿 rw-artifact-gate-in-ci
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
    id: 'user-writes-throttled',
    roots: ['#13'],
    desc: '用户端可滥用写函数防刷（根因#13·活线）：高频/造数写函数（trackEvent/createOrder/login/updateProfile）必经 withRateLimit（按 openid 限频），防无限刷库/堆垃圾/成本',
    run() {
      const bad = []
      // 旧线段已随 packages/ 删除（2026-07-23 瘦身拍板批）
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
    // 视频源不走外链（优化批0618·T-F7·合规红线）。根因#8「urlCheck 翻 true 后真机才暴露」：
    // player 曾硬编码 Google 外链占位视频（.mp4），合规非法域名 + 小程序 urlCheck 开启后真机根本播不了
    // （dev/未校验时能播=假绿）。视频源只许经 getPlaybackUrl/store.playbackUrl 换云端短时效 URL；
    // 前端禁裸 http(s) 视频 URL 字面量。无真实视频 → 本地占位封面（不播外链）。
    id: 'no-external-video-src',
    roots: ['#8'],
    desc: '视频源不走外链（T-F7·合规）：rewrite/mp（.js/.ts/.wxml）禁裸 http(s) 视频 URL 字面量（.mp4/.m3u8/.mov/.webm 等）——视频源只经 getPlaybackUrl/store.playbackUrl 换云端临时 URL，无真视频显本地占位；防外链合规红线 + urlCheck 翻 true 后真机播不了（根因#8）',
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
      // 旧线扫描段已随 packages/ 删除（2026-07-23 瘦身拍板批）
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
    // wxml 事件绑定 handler 静态存在性（2026-07-24·闭「冒烟条件节点覆盖边界」待决账——待办与债 2026-07-19
    // 冒烟批次D条）。痛：批次D实测删 player.ts 的 noop() 后冒烟照样全 PASS——wx:if=false 的条件节点（抽屉/
    // 遮罩）不渲染就摸不到它挂的 handler，真机一打开即报「does not have a method」（根因#8）。原两岔路（冒烟
    // 补交互步骤 vs 接受边界）都不如静态按类闭：绑定名是 wxml 字面量、方法名是 ts 字面量，静态即可对账，
    // 条件/普通节点、页面/自定义组件通吃、零工具依赖；且交互步骤追着 UI 跑必腐（批次D当年的标的 listOpen
    // 抽屉，2026-07-24 已不存在于 player.wxml）。边界如实：动态绑定名（值含 {{}}）不进扫描面（仓内现状
    // 0 个）；值带点且命中本文件 <wxs module> 名单的走渲染层、跳过。原型实测 2026-07-24：27 wxml/192 绑定
    // 零误报。ts 侧匹配用 stripComments 后源（E1：裸源会被注释里提到的方法名假绿）。
    id: 'rw-mp-wxml-handlers-exist',
    roots: ['#8'],
    desc: 'wxml 事件绑定 handler 静态存在性（根因#8）：rewrite/mp 全部 .wxml 的 bind/catch/mut-bind/capture-bind/capture-catch 字面 handler 名，须在同目录同名 .ts 中有定义（`名(`/`名:`/`async 名(` 形态）——wx:if=false 条件节点上的 handler 缺失冒烟层摸不到、真机必报 does not have a method；全仓零绑定即红（病根#16「空样本＝绿不发信号」）',
    run() {
      const bad = []
      const base = join(ROOT, 'rewrite/mp')
      if (!existsSync(base)) return bad
      const ATTR = /\b(?:mut-bind|capture-bind|capture-catch|bind|catch)[:]?[a-zA-Z]+\s*=\s*"([^"{}]+)"/g
      let bindings = 0
      const walkW = (d) => {
        for (const name of lsScan(d)) {
          if (name === 'node_modules' || name === 'dist') continue
          const p = join(d, name)
          if (statSync(p).isDirectory()) walkW(p)
          else if (name.endsWith('.wxml')) {
            // 注释置换为等长空白（保行号列号）；<wxs module> 名单先整文收集（声明位置任意）
            const src = readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
            const wxsMods = new Set([...src.matchAll(/<wxs[^>]*\bmodule="([^"]+)"/g)].map((m) => m[1]))
            const tsPath = p.slice(0, -5) + '.ts'
            const tsSrc = existsSync(tsPath) ? stripComments(readFileSync(tsPath, 'utf8')) : null
            src.split('\n').forEach((line, i) => {
              if (line.includes('structure-ok')) return
              for (const m of line.matchAll(ATTR)) {
                const handler = m[1].trim()
                bindings++
                if (handler.includes('.') && wxsMods.has(handler.split('.')[0])) continue // wxs 模块函数：渲染层闭环不查 ts
                if (tsSrc === null) {
                  bad.push(`${relative(ROOT, p)}:${i + 1} 绑定「${handler}」但同目录无同名 .ts——handler 无处定义（根因#8）`)
                  continue
                }
                const esc = handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                if (!new RegExp(`(?:^|[^\\w$])(?:async\\s+)?${esc}\\s*[(:]`).test(tsSrc))
                  bad.push(
                    `${relative(ROOT, p)}:${i + 1} 绑定的 handler「${handler}」在 ${relative(ROOT, tsPath)} 无定义——wx:if 条件节点上冒烟摸不到、真机必报 does not have a method（根因#8）`,
                  )
              }
            })
          }
        }
      }
      walkW(base)
      if (!bindings)
        bad.push('rewrite/mp 下零个 wxml 事件绑定——本守卫扫描面空转（病根#16「空样本＝绿」）；若非 wxml 全撤，先查扫描正则是否失配')
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
    // 隐藏文件；本表额外剔除四个不可达/工具专属项——
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
      if (!existsSync(base)) return ['rewrite/mp 缺失——守卫扫描面消失（rw-mp-main-package-budget）']
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
    // 品牌字体走远程加载（wx.loadFontFace）、绝不进小程序包——杜绝字体二进制撑爆包体积（主包 2MB·总包 20MB）。
    // 痛：文源圆体单字重 ~14MB，若有人把 .otf/.ttf 丢进 src/static（构建原样拷入包）或 base64 内嵌进 wxss，
    // 包体积瞬间爆掉。锁两条进包路径：① src 下无字体二进制 ② mp 可达源码无字体 data-URI（base64 内嵌）。
    // 子集产物正本在仓根 assets/brand-fonts/（不在 src·不进包，仅作部署到托管的真相源 + OFL 授权随附）。
    id: 'font-not-in-package',
    roots: ['基建'],
    desc: '品牌字体远程加载不进包：rewrite/mp 下无字体二进制(.otf/.ttf/.woff/.woff2/.eot) + mp 可达源码无字面内嵌字体 blob（base64 长串·非运行时 downloadFile→base64 模板）——防 ~14MB 字重撑爆包体积（主包 2MB），字体须远程拉取（正本在 assets/brand-fonts/·远程托管·mp 端 downloadFile→base64 绕 CORS 见 App.vue / rewrite/mp/utils/brandFont.ts）',
    run() {
      const bad = []
      const srcDirs = [join(ROOT, 'rewrite/mp')]
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
  // ── 承面 C 车道 B·外包坐席工作台前端（独立 /agent 部署单元·对 mock 建·不进 /admin）守卫 ──
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
      // 扫描面含 .wxml（2026-07-25 全量页面体检批）：默认 walk 只看编译面四类，mp 模板层此前完全不设防——
      // 废弃占位「易织™小棉鸭® 官方旗舰店」就硬编码在 order.wxml:56 / checkout.wxml:39 活到了生产源，
      // 守卫在位、禁词正确、npm run check 全绿照样漏（体检取证：结算页与订单详情页顾客可见）。
      const EXTS = /\.(js|mjs|cjs|ts|vue|wxml)$/
      // 判定前剥注释（错题本 E1 既有纪律的本守卫落地·扩面后才暴露的老缺陷）：本守卫咬的是**用户可见的
      // 硬编码文案**，不是解释性注释。wxml 注释是 <!-- -->（stripComments 只认 JS 两式），故叠一层。
      // 不剥的话 order/checkout.wxml 里「仅一家官方旗舰店」这类说明文字会被误判成硬编码违例。
      const strip = (rel, src) => {
        const s = stripComments(src)
        return rel.endsWith('.wxml') || rel.endsWith('.vue') ? s.replace(/<!--[\s\S]*?-->/g, '') : s
      }
      const brandFile = 'rewrite/mp/lib/brand.ts'
      const shopFile = 'rewrite/mp/lib/shop.ts' // 店铺全名单源（与 brand.ts 分家的理由见该文件头注：首屏字体子集）
      const absBrand = join(ROOT, brandFile)
      if (!existsSync(absBrand)) bad.push(`${brandFile} 缺失（店名单一来源，R23⑲）`)
      else if (!new RegExp(`BRAND_NAME\\s*=\\s*['"]${NAME}['"]`).test(readFileSync(absBrand, 'utf8')))
        bad.push(`${brandFile} 未导出 BRAND_NAME='${NAME}'——店名单源缺定值（R23⑲）`)
      // ① NAME / 官方旗舰店 单源：只在 brand.js，别处引 BRAND_NAME（限引它的 miniapp/admin 两端）
      for (const dir of ['rewrite/mp', 'rewrite/admin/src', 'rewrite/agent/src']) {
        for (const f of walk(join(ROOT, dir), EXTS)) {
          const rel = relative(ROOT, f)
          const s = strip(rel, readFileSync(f, 'utf8'))
          if (rel !== brandFile && s.includes(NAME))
            bad.push(`${rel} 硬编码店名「${NAME}」——须引 constants/brand.js 的 BRAND_NAME 单源（病根#5）`)
          // 店铺全名单源住 lib/shop.ts 而非 brand.ts（2026-07-25 体检批 P3）：brand.ts 在首页闭包内，
          // 「旗舰店」并进去会被 rw-mp-font-tier-subset-covers 算作 tier1 首屏字，而首屏子集里没有这三个字
          // → 真机静默掉系统字体。拆开后本字落 tier2（详见 lib/shop.ts 头注）。
          if (rel !== shopFile && s.includes('官方旗舰店'))
            bad.push(`${rel} 硬编码「官方旗舰店」店铺后缀——须引 lib/shop.ts 的 SHOP_FULL_NAME 单源（病根#5·债#30）`)
          // 英文口号同样单源（2026-07-25 体检批 P3）：paysuccess 曾硬编码「Get Ducky Get Lucky」，
          // 与 brand.ts 的「Get ducky get lucky」大小写不一致——同一句口号全 App 两种写法。
          // 大小写不敏感匹配：正是大小写漂移本身要抓，不能只比字面量。
          // **仅限 mp**：admin/agent 引不到 mp 的 lib/brand.ts（跨包无 import 通路），
          // 且那边的口号是 CMS 表单默认值/示例文案，性质不同——扩到那两端等于立一条无法满足的规矩。
          if (dir === 'rewrite/mp' && rel !== brandFile && /get\s+ducky\s+get\s+lucky/i.test(s))
            bad.push(`${rel} 硬编码英文品牌口号——须引 lib/brand.ts 的 BRAND_SLOGAN_EN 单源（大小写写法会各页漂移·病根#5）`)
        }
      }
      // ② 绝迹名单全库扫（含 shared 种子 / cloud 云函数 / 根级 tests 夹具——中文名当初从这些「单源缺守」处漂进来；
      //    tests 当初不在扫描内＝守卫盲区，纳入。walk 默认只看 .js/.ts/.vue，故显式传 EXTS 把 .wxml 纳入
      //    （2026-07-25 体检：模板层失明让废弃占位在两处 wxml 活到生产源）；.json/.html 仍不在内，/q 落地页另走 ③）
      for (const dir of ['rewrite/mp', 'rewrite/admin/src', 'rewrite/agent/src', 'rewrite/cloud/src', 'rewrite/shared/src', 'tests']) {
        for (const f of walk(join(ROOT, dir), EXTS)) {
          const rel = relative(ROOT, f)
          const s = strip(rel, readFileSync(f, 'utf8'))
          for (const ban of BANNED)
            if (s.includes(ban))
              bad.push(`${rel} 仍含品牌名漂移变体「${ban}…」——中文名定「小棉鸭」，须全替（病根#5 复制漂移）`)
        }
      }
      // ③ 用户可见的静态品牌页（.html 不被 walk 扫·反向自检逮出的假绿·根因#8）——逐个显式钉死
      //    /q 扫码落地页（源已迁 rewrite/site/public/q/·2026-07-23 瘦身批随旧线搬家）
      for (const page of ['rewrite/site/public/q/index.html']) {
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
    // 云环境目录单源（病根#5·债#30① + Issue #106）：生产/测试 env id 只在 scripts/lib/env.mjs
    // 以 PROD_ENV / TEST_ENV 字面量定义；ENV_CATALOG 给出 stub|test|prod-readonly 选择子。
    // scripts/ 递归扫（含 test-api/）禁再抄门牌号——抄漏会让「拒生产」闸与压测目标不一致。
    // guard-deploy 的 id 仅在确认消息文案（非逻辑常量）·豁免。
    id: 'prod-env-single-source',
    roots: ['#5'],
    desc: '云环境目录单源（病根#5·Issue #106）：scripts/ 里生产/测试 env id 只在 scripts/lib/env.mjs 定义；ENV_CATALOG 须有 stub/test/prod-readonly；递归扫 scripts/**/*.mjs 禁硬编码门牌（guard-deploy 豁免）',
    run() {
      const src = join(ROOT, 'scripts/lib/env.mjs')
      if (!existsSync(src)) return ['scripts/lib/env.mjs 缺失（云环境目录单源·病根#5）']
      const text = readFileSync(src, 'utf8')
      const prodM = text.match(/PROD_ENV\s*=\s*['"]([a-z0-9-]+)['"]/i)
      const testM = text.match(/TEST_ENV\s*=\s*['"]([a-z0-9-]+)['"]/i)
      const envId = prodM ? prodM[1] : ''
      const testId = testM ? testM[1] : ''
      if (!envId) return ['scripts/lib/env.mjs 未定义 PROD_ENV（云环境目录单源·病根#5）']
      if (!testId) return ['scripts/lib/env.mjs 未定义 TEST_ENV（测试云门牌须与生产并列入册·Issue #106）']
      if (envId === testId) return ['scripts/lib/env.mjs 生产/测试 env id 撞号——目录失效']
      const bad = []
      if (!/export const ENV_CATALOG\s*=/.test(text))
        bad.push('scripts/lib/env.mjs 缺 ENV_CATALOG（选择子目录·Issue #106）')
      if (!/export function resolveTarget\s*\(/.test(text))
        bad.push('scripts/lib/env.mjs 缺 resolveTarget（断言套件入口·Issue #106）')
      if (!/export function resolveWriteTestTarget\s*\(/.test(text))
        bad.push('scripts/lib/env.mjs 缺 resolveWriteTestTarget（写测试须显式 test·Issue #106）')
      for (const sel of ['stub', 'test', 'prod-readonly']) {
        if (!text.includes("selector: '" + sel + "'") && !text.includes('selector: "' + sel + '"'))
          bad.push(`ENV_CATALOG 缺选择子 ${sel}（stub|test|prod-readonly 须齐·Issue #106）`)
      }
      const walkMjs = (d, acc) => {
        for (const e of lsScan(d)) {
          const p = join(d, e)
          if (statSync(p).isDirectory()) walkMjs(p, acc)
          else if (e.endsWith('.mjs')) acc.push(p)
        }
        return acc
      }
      const exempt = new Set(['scripts/lib/env.mjs', 'scripts/guard-deploy.mjs'])
      for (const abs of walkMjs(join(ROOT, 'scripts'), [])) {
        const rel = relative(ROOT, abs).replace(/\\/g, '/')
        if (exempt.has(rel)) continue
        const s = readFileSync(abs, 'utf8')
        if (s.includes(envId))
          bad.push(`${rel} 硬编码生产 env id——须 import { PROD_ENV } / resolveTarget from scripts/lib/env.mjs（单源·病根#5）`)
        if (s.includes(testId))
          bad.push(`${rel} 硬编码测试 env id——须 import { TEST_ENV } / resolveTarget from scripts/lib/env.mjs（单源·Issue #106）`)
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
    id: 'module-map-synced',
    roots: ['#11'],
    desc: '运行时模块映射与正册同步（车队地基批2·病根#11 生成物防漂·同 gen-order-domain-synced 范式）：rewrite/shared/src/moduleMap.ts 的 APP_ACTION_MODULE 须与 modules.json 各模块 appActions 完全一致（云函数运行时按它给异常账本标模块，物理进不了 JSON 单源故设镜像+本守卫焊死）——改 modules.json 的 appActions 后同步 moduleMap.ts，漏改即红',
    run() {
      const bad = []
      const regPath = join(ROOT, 'modules.json')
      const mapPath = join(ROOT, 'rewrite/shared/src/moduleMap.ts')
      if (!existsSync(regPath)) return [] // 正册缺失由 module-registry-complete 报，不双报
      if (!existsSync(mapPath))
        return ['rewrite/shared/src/moduleMap.ts 缺失——异常账本模块归因的运行时映射（单源 modules.json 的镜像），按 modules.json appActions 生成它']
      let reg
      try {
        reg = JSON.parse(readFileSync(regPath, 'utf8'))
      } catch {
        return [] // JSON 坏由 module-registry-complete 报
      }
      const want = new Map() // action → module（真值：modules.json）
      for (const [mid, m] of Object.entries(reg?.modules ?? {}))
        for (const a of m?.appActions ?? []) want.set(a, mid)
      const mapSrc = readFileSync(mapPath, 'utf8')
      const got = new Map(
        [...mapSrc.matchAll(/^\s*([A-Za-z0-9_]+):\s*'([a-z]+)',/gm)].map((m) => [m[1], m[2]])
      )
      for (const [a, mid] of want)
        if (!got.has(a)) bad.push(`moduleMap.ts 缺 action \`${a}\`（modules.json 归 \`${mid}\`）——补 \`${a}: '${mid}',\``)
        else if (got.get(a) !== mid)
          bad.push(`moduleMap.ts 里 \`${a}\` 标 \`${got.get(a)}\` ≠ modules.json 真值 \`${mid}\`——改为真值`)
      for (const a of got.keys())
        if (!want.has(a)) bad.push(`moduleMap.ts 多出 action \`${a}\`（modules.json 无此登记）——删除（防幽灵映射）`)
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
    desc: '新线 SCM 域（购/外协单）状态写入只走声明流转（根因#2·批K 引入·批S 修复①对 fromFor(X) 调用形态的假绿：新增分支核对 fromFor 参数 X 与 transition() 第四参数 to 一致，不一致＝越流转被静默放行）：rewrite/cloud/src/functions/adminApi/actions/scm*.ts 里 transition(purchaseOrders/outworkOrders) 的边（字面量数组或 fromFor(X) 两种形态）、裸条件 CAS 的边须在 order-domain.generated.json 声明流转表内（该 JSON 原由已退役的 gen-order-domain-synced 生成器守卫维护·2026-07-23 起为冻结数据快照、锚 rewrite/shared 两份 spec·生成物范式处置见 待办与债 (f)）；写这两集合 status 的字面量须是声明状态——越流转/打错状态名即红',
    run() {
      const jsonPath = join(ROOT, 'scripts/order-domain.generated.json')
      if (!existsSync(jsonPath)) return ['scripts/order-domain.generated.json 缺失——它是冻结数据快照（生成器已退役）：`git checkout HEAD -- scripts/order-domain.generated.json` 恢复，或按 rewrite/shared/src/scm.ts 手改单源核正']
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
      if (!existsSync(actionsDir)) return ['rewrite/cloud/src/functions/adminApi/actions 缺失——守卫扫描面消失（rw-scm-transitions-declared）']
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
    desc: '结算常量镜像同步（根因#5·mp 包进不了 @ldrw/shared——开发者工具编译不出仓外引用，故 mp 落副本 + 本守卫焊死）：rewrite/mp/lib/checkoutConst.ts 的全部导出常量必须与 rewrite/shared/src/checkout.ts 名值双向一致（第一性原理审计批堵元漂移：原版硬编码 COUPON/SHIP/CHECKOUT_ADDONS 三个名字，shared 新增第四个常量 mp 忘抄守卫仍绿——改为自动枚举全部 export const，新增/删除/改值任一侧漂移即红）',
    run() {
      const mpPath = join(ROOT, 'rewrite/mp/lib/checkoutConst.ts')
      const shPath = join(ROOT, 'rewrite/shared/src/checkout.ts')
      if (!existsSync(shPath)) return ['rewrite/shared/src/checkout.ts 缺失——守卫扫描面消失（rw-mp-checkout-consts-synced）']
      if (!existsSync(mpPath)) return ['rewrite/mp/lib/checkoutConst.ts 缺失——结算常量副本未落（mp 无法引 @ldrw/shared·守卫需两份对账）']
      const bad = []
      // 全导出枚举：数值常量取字面量；数组常量取 {id,name,price} 逐项序列化——两类之外的导出形态（对象/函数）
      // 出现时报「守卫需扩形态」而非静默跳过（防扫描面盲区·病根#16）
      const parse = (src) => {
        const stripped = stripComments(src)
        const vals = {}
        for (const m of stripped.matchAll(/export const (\w+)(?::[^=]*)? = ([0-9.]+)/g)) vals[m[1]] = m[2]
        for (const m of stripped.matchAll(/export const (\w+)(?::[^=]*)? = \[([\s\S]*?)\n\]/g)) {
          const items = [...m[2].matchAll(/\{ id: '([^']+)', name: '([^']+)', price: ([0-9.]+) \}/g)].map((x) => `${x[1]}|${x[2]}|${x[3]}`)
          vals[m[1]] = items.join(';')
        }
        const unparsed = [...stripped.matchAll(/export const (\w+)/g)].map((m) => m[1]).filter((n) => !(n in vals))
        return { vals, unparsed }
      }
      const mp = parse(readFileSync(mpPath, 'utf8'))
      const sh = parse(readFileSync(shPath, 'utf8'))
      if (!Object.keys(sh.vals).length) bad.push('rewrite/shared/src/checkout.ts 未解析出任何导出常量——守卫定位失效（改了导出形态须同步本守卫·病根#16 空样本假绿）')
      for (const n of sh.unparsed) bad.push(`rewrite/shared/src/checkout.ts 导出 ${n} 形态本守卫不识别（非数值/非 {id,name,price} 数组）——扩守卫解析后再加，不许静默跳过`)
      for (const [n, v] of Object.entries(sh.vals)) {
        if (!(n in mp.vals)) bad.push(`结算常量漂移：shared 导出 ${n} 在 mp checkoutConst.ts 无副本（结算页展示价与云端定价不一致·下单必对不上账）`)
        else if (mp.vals[n] !== v) bad.push(`结算常量漂移：${n} mp=${mp.vals[n]} ≠ shared=${v}（结算页展示价与云端定价不一致·下单必对不上账）`)
      }
      for (const n of Object.keys(mp.vals)) if (!(n in sh.vals)) bad.push(`结算常量漂移：mp checkoutConst.ts 导出 ${n} 在 shared checkout.ts 无对应——副本多出无源常量`)
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
      'AFTERSALE_STATUS_LABEL_CUSTOMER 键集合一致——状态机新增状态若 mp 忘配标签，页面会悄悄显示原始状态码；' +
      '③ order/order-list 模板不得硬编码「实付…」金额行标题（须引 mapOrders 的 amountTitle）——未付订单（pending/closed）' +
      '写「实付款」是假话，顾客会以为被扣了钱（2026-07-25 体检批 P1 取证：已关闭单同屏两处「实付款 ¥778.00」）',
    run() {
      const shPath = join(ROOT, 'rewrite/shared/src/statusLabels.ts')
      const mpOrdersPath = join(ROOT, 'rewrite/mp/lib/mapOrders.ts')
      const mpAftersalesPath = join(ROOT, 'rewrite/mp/lib/mapAftersales.ts')
      if (!existsSync(shPath)) return ['rewrite/shared/src/statusLabels.ts 缺失——守卫扫描面消失（rw-mp-order-labels-synced）']
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
      // ③ 金额行标题不得在模板层硬编码（2026-07-25 全量页面体检批 P1·钱链措辞）：
      //    order/order-list 曾对**全部**状态写死「实付款」，已关闭订单（从未付过钱·closed 只从 pending 转来）
      //    同屏两处写「实付款 ¥778.00」，顾客会以为被扣款。须引 mapOrders 的 amountTitle（付过=实付款/未付=订单金额）。
      //    语义正确性另由 rewrite/mp/tests/orders-map.test.ts「金额行标题」组锁；本条只封「绕过单源再写死」这条回潮路。
      for (const rel of ['rewrite/mp/pages/order/order.wxml', 'rewrite/mp/pages/order-list/order-list.wxml']) {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) continue
        const body = readFileSync(abs, 'utf8').replace(/<!--[\s\S]*?-->/g, '') // 剥注释（错题本 E1）
        if (/实付/.test(body))
          bad.push(`${rel} 模板层硬编码「实付…」金额行标题——须引 mapOrders 的 amountTitle（未付订单写「实付款」会让顾客以为被扣款·体检批 P1）`)
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
      if (!existsSync(base)) return ['rewrite/site 缺失——守卫扫描面消失（rw-site-in-gates）']
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
      if (!existsSync(base)) return ['rewrite/agent 缺失——守卫扫描面消失（rw-agent-in-gates）']
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
      if (!existsSync(base)) return ['rewrite/admin 缺失——守卫扫描面消失（rw-admin-ui-in-gates）']
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
      if (!existsSync(base)) return ['rewrite/mp 缺失——守卫扫描面消失（rw-mp-line-in-gates）']
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
      if (!existsSync(base)) return ['rewrite/mp 缺失——守卫扫描面消失（rw-mp-privacy-gated）']
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
      // 扩守卫面必须同步改这里——曾有 20 接口「扩补此册」注册册死代码误导（LD-007，2026-08-09 已删）。
      // ⚠️ 守卫范围=下方内联正则（wxml: chooseAvatar/nickname；wx. 接口 6 项：chooseImage/chooseMedia/getUserProfile/getClipboardData/getLocation/saveImageToPhotosAlbum）。
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
      if (!existsSync(tsPath)) return ['pages/player/player.ts 缺失——守卫扫描面消失（rw-mp-player-no-autonext）'] // 播放页未建时不红
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
    // 开发版提审包禁带 A/B 翻转演示页（Issue #117）：pages/flip-demo 是隔离真机对比台，不是顾客面。
    // 测试版分支另留；本守卫锁开发版/正式包不得注册、不得留目录（文件在包里即会被审核员点到）。
    id: 'rw-mp-no-flip-demo-pack',
    roots: ['#8'],
    desc: '开发版/正式提审包不得收录 A/B 翻转演示页（Issue #117）：app.json 不得注册 pages/flip-demo/flip-demo，pages/flip-demo 目录不得存在——演示页只留测试版分支；提审包带 demo 会被审核员点到（根因#8 构建过≠真能用）',
    run() {
      const bad = []
      const appJsonPath = join(ROOT, 'rewrite/mp/app.json')
      if (!existsSync(appJsonPath)) return ['rewrite/mp/app.json 缺失——守卫扫描面消失（rw-mp-no-flip-demo-pack）']
      let appJson
      try {
        appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'))
      } catch (e) {
        return [`rewrite/mp/app.json 不是合法 JSON：${e.message}`]
      }
      if ((appJson.pages || []).includes('pages/flip-demo/flip-demo'))
        bad.push('app.json 仍注册 pages/flip-demo/flip-demo——开发版提审包不得带 A/B 演示页（Issue #117）')
      if (existsSync(join(ROOT, 'rewrite/mp/pages/flip-demo')))
        bad.push('rewrite/mp/pages/flip-demo 目录仍在——演示页文件会随包上传，须从开发版删掉（测试版分支另留）')
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
      if (!existsSync(base)) return ['rewrite/mp 缺失——守卫扫描面消失（rw-mp-no-casting）']
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
      if (!existsSync(base)) return ['rewrite/mp 缺失——守卫扫描面消失（rw-mp-list-loadfailed-state）']
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
      // 取址 fetcher 已迁 lib/playbackCache.ts（批3 跨页取址预热）：FETCH_FAIL
      // 分流随 fetcher 迁到单例文件，断言目标随之移；player.ts 消费端仍按「非 NOT_ENTITLED 即 error」分流（无需字面量）。
      const fetcherHome = join(base, 'lib/playbackCache.ts')
      if (existsSync(fetcherHome) && !/FETCH_FAIL/.test(stripComments(readFileSync(fetcherHome, 'utf8'))))
        bad.push('lib/playbackCache.ts 取址 fetcher 无 FETCH_FAIL 分流——取址网络失败仍伪装成「视频还在整理中」且无重试（根因#14）')
      // ── 2026-07-25 体检批 P2：同族「界面说假话」三条（前三条守的是「失败伪装成空」，这三条守反向与延伸）──
      // ① 反向：「查无此单」被伪装成网络失败。云端 getOrderById 对不存在/非本人一律 err(NOT_FOUND)＝ok:false，
      //    页面若只看 ok 就全落 loadFailed →「网络开小差」+ 重试永远点不通，而 missing「订单不存在」成死代码。
      const orderTs = join(base, 'pages/order/order.ts')
      if (existsSync(orderTs) && !/NOT_FOUND/.test(stripComments(readFileSync(orderTs, 'utf8'))))
        bad.push('pages/order/order.ts 未对 NOT_FOUND 分流——云端「查无此单」被伪装成网络失败，用户对着不存在的订单反复重试，missing 空态成死代码（根因#14 反向）')
      // ② 延伸：进度读失败被伪装成「一段没学过」。my-courses 三路并发中 progress 若失败回退空数组，
      //    课卡会显示「已学 0/80 · 0%」——学了一半的用户会以为学习记录丢了。
      const mcTs = join(base, 'pages/my-courses/my-courses.ts')
      if (existsSync(mcTs) && /progress\.ok\s*\?\s*progress\.list\s*:\s*\[\]/.test(stripComments(readFileSync(mcTs, 'utf8'))))
        bad.push('pages/my-courses/my-courses.ts 把进度失败回退成空数组——「读不到进度」被伪装成「一段没学过」（0%），须传 null 落未知态（根因#14 延伸）')
      // ③ 延伸：写入被云端静默剔除，前端却报「已保存」。云端 updateProfile 对 phone 走白名单
      //    （纯数字 7–11 位才入库、否则剔除不改），前端不校验就会「说存了其实没存」。
      //    数字须与 rewrite/cloud/src/functions/app/actions/user.ts 的 CAPS.phone / d.length>=7 一致（手落副本+本条焊死，同 checkout consts 范式）。
      const peTs = join(base, 'pages/profile-edit/profile-edit.ts')
      if (existsSync(peTs)) {
        const src = stripComments(readFileSync(peTs, 'utf8'))
        const mpMin = src.match(/PHONE_MIN_DIGITS\s*=\s*(\d+)/)
        const mpMax = src.match(/PHONE_MAX_DIGITS\s*=\s*(\d+)/)
        if (!mpMin || !mpMax) {
          bad.push('pages/profile-edit/profile-edit.ts 无手机号位数校验（PHONE_MIN_DIGITS/PHONE_MAX_DIGITS）——非法号被云端白名单静默剔除，界面却弹「已保存」（根因#14 延伸：写入说假话）')
        } else {
          // 副本焊死（病根#5）：只断言「有校验」挡不住漂移——前端放宽一位，云端照旧剔除，
          // 假「已保存」立刻复发。故与云端白名单真值逐数比对（同 rw-mp-checkout-consts-synced 精神）。
          const cloudUser = join(ROOT, 'rewrite/cloud/src/functions/app/actions/user.ts')
          if (existsSync(cloudUser)) {
            const cs = stripComments(readFileSync(cloudUser, 'utf8'))
            const cMax = cs.match(/CAPS\s*=\s*\{[^}]*phone:\s*(\d+)/)
            const cMin = cs.match(/d\.length\s*>=\s*(\d+)/)
            if (cMin && mpMin[1] !== cMin[1])
              bad.push(`手机号下界漂移：mp profile-edit PHONE_MIN_DIGITS=${mpMin[1]} ≠ 云端 user.ts d.length>=${cMin[1]}——前端放行、云端剔除，假「已保存」复发（病根#5）`)
            if (cMax && mpMax[1] !== cMax[1])
              bad.push(`手机号上界漂移：mp profile-edit PHONE_MAX_DIGITS=${mpMax[1]} ≠ 云端 user.ts CAPS.phone=${cMax[1]}——同上（病根#5）`)
          }
        }
      }
      return bad
    },
  },
  {
    // 学习进度百分比口径单源（2026-07-25 进度条专项·病根#5 三处裸写同式 + 根因#14 界面说假话）。
    // 病史：mp mapLearning / cloud customer360 / admin Courses 三处各自裸写
    // `Math.round((done/total)*100)`，边界上对用户撒谎——1/250 显示 0%（学了却像没学）、
    // 199/200 显示 100%（没学完却像结课）。收口 shared 的 progressPercent；mp 进不了 @ldrw/shared
    // 故手落副本，本守卫逐规则焊死两侧（副本最怕单边改：一边收紧一边照旧，同一门课两处显示不同进度）。
    // 反向自检＝把 mp 副本的 Math.min(99,…) 改回裸 raw 即红。
    id: 'rw-progress-percent-single-source',
    roots: ['#5', '#14'],
    desc: '学习进度百分比口径单源：canonical＝rewrite/shared/src/learning.ts 的 progressPercent（0% 只表示真没学、100% 只表示真学完、中间夹 [1,99]）；cloud customer360 与 admin Courses 须 import 它、不得裸写 Math.round((x/y)*100)；mp 进不了 @ldrw/shared 故手落副本，四条关键规则（d<=0→0 / d>=t→100 / Math.round / Math.min(99,Math.max(1,…))）须与单源一致',
    run() {
      const bad = []
      const shPath = join(ROOT, 'rewrite/shared/src/learning.ts')
      if (!existsSync(shPath)) return ['rewrite/shared/src/learning.ts 缺失——守卫扫描面消失（rw-progress-percent-single-source）']
      const sh = stripComments(readFileSync(shPath, 'utf8'))
      if (!/export\s+function\s+progressPercent\b/.test(sh))
        bad.push('rewrite/shared/src/learning.ts 未导出 progressPercent——学习进度口径单源缺定值（病根#5）')
      // ① 两个能引 shared 的消费面：必须引单源、不得裸写
      for (const rel of ['rewrite/cloud/src/functions/adminApi/customer360/providers/learning.ts', 'rewrite/admin/src/pages/Courses.vue']) {
        const abs = join(ROOT, rel)
        if (!existsSync(abs)) continue
        const src = stripComments(readFileSync(abs, 'utf8'))
        if (!/progressPercent\s*\(/.test(src))
          bad.push(`${rel} 未用 progressPercent——学习进度百分比须引 @ldrw/shared 单源（病根#5）`)
        if (/Math\.round\s*\(\s*\(\s*\w+(\.\w+)*\s*\/\s*\w+(\.\w+)*\s*\)\s*\*\s*100\s*\)/.test(src))
          bad.push(`${rel} 仍裸写 Math.round((x/y)*100) 算学习进度——边界会撒谎（1/250→0%、199/200→100%），须走 progressPercent`)
      }
      // ② mp 手落副本：四条关键规则逐条焊死（同 STATUS_LABELS/checkoutConst 副本范式）
      const mpPath = join(ROOT, 'rewrite/mp/lib/mapLearning.ts')
      if (existsSync(mpPath)) {
        const mp = stripComments(readFileSync(mpPath, 'utf8'))
        const body = methodBody(mp, 'progressPercent') || mp
        if (!/function\s+progressPercent\b/.test(mp)) {
          bad.push('rewrite/mp/lib/mapLearning.ts 无 progressPercent 副本——mp 进不了 @ldrw/shared，须手落副本（病根#5）')
        } else {
          const RULES = [
            { re: /d\s*<=\s*0/, msg: 'd<=0→0（没学过才是 0%）' },
            { re: /d\s*>=\s*t/, msg: 'd>=t→100（学完才是 100%）' },
            { re: /Math\.min\s*\(\s*99/, msg: 'Math.min(99,…)（没学完不许显示 100%）' },
            { re: /Math\.max\s*\(\s*1/, msg: 'Math.max(1,…)（学过了不许显示 0%）' },
          ]
          for (const r of RULES)
            if (!r.re.test(body))
              bad.push(`rewrite/mp/lib/mapLearning.ts 的 progressPercent 副本缺规则「${r.msg}」——与 shared 单源漂移，同一门课两处显示不同进度（病根#5）`)
        }
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
      if (!existsSync(base)) return ['rewrite/mp 缺失——守卫扫描面消失（rw-mp-font-tier-subset-covers）']
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
    id: 'rw-lock-budget',
    roots: ['#17'],
    desc: '依赖锁重量基线棘轮（病根#17）：package-lock.json 字节数与 packages 条数对基线——防旧线 639 死包式静默积重复发',
    run() {
      const bp = join(ROOT, 'scripts/slim-baseline.json')
      if (!existsSync(bp)) return ['scripts/slim-baseline.json 缺失——瘦身棘轮无基准（病根#17）']
      const base = JSON.parse(readFileSync(bp, 'utf8'))
      const lockRaw = readFileSync(join(ROOT, 'package-lock.json'), 'utf8')
      const pkgs = Object.keys(JSON.parse(lockRaw).packages || {}).length
      return [
        ...checkBudget({ label: '依赖锁(字节)', current: lockRaw.length, baseline: base.lockBytes }),
        ...checkBudget({ label: '依赖锁(包数)', current: pkgs, baseline: base.lockPackages }),
      ]
    },
  },
  {
    id: 'rw-dead-exports',
    roots: ['#17'],
    desc: '死导出零容忍（病根#17）：rewrite/shared/src 导出符号在消费面（cloud/admin/agent/site 源 + 各包 tests + 守卫注册表文本级消费）零出现即红——防 scm.spec 式「自称单源无人读」复发；mp 手抄副本刻意不算消费（T1 结构性隔离）',
    run() {
      const shDir = join(ROOT, 'rewrite/shared/src')
      if (!existsSync(shDir)) return ['rewrite/shared/src 缺失——守卫扫描面消失（rw-dead-exports）']
      const files = []
      for (const e of lsScan(shDir)) if (e.endsWith('.ts')) files.push({ path: 'rewrite/shared/src/' + e, text: readFileSync(join(shDir, e), 'utf8') })
      const consumerTexts = []
      const collectTs = (dir) => {
        const abs = join(ROOT, dir)
        if (!existsSync(abs)) return
        const rec = (d) => {
          for (const e of lsScan(d)) {
            const pp = join(d, e)
            if (statSync(pp).isDirectory()) rec(pp)
            else if (/\.(ts|vue)$/.test(e)) consumerTexts.push({ path: relative(ROOT, pp), text: readFileSync(pp, 'utf8') })
          }
        }
        rec(abs)
      }
      for (const d of ['rewrite/cloud/src', 'rewrite/admin/src', 'rewrite/agent/src', 'rewrite/site/src', 'rewrite/cloud/tests', 'rewrite/shared/tests', 'rewrite/admin/tests']) collectTs(d)
      consumerTexts.push({ path: 'scripts/check-structure.mjs', text: readFileSync(join(ROOT, 'scripts/check-structure.mjs'), 'utf8') })
      return findDeadExports({ files, consumerTexts }).map(
        (d) => `${d.file} 导出 ${d.name} 全消费面零引用——死导出（病根#17·确属预留须有 why 注释并进豁免，别静默躺尸）`
      )
    },
  },
  {
    id: 'rw-phantom-deps',
    roots: ['#17'],
    desc: '幽灵依赖零容忍（病根#17）：活线源码 import 的顶层包须在自家或根 package.json 声明——防 @vue/compiler-sfc 式「蹭提升、宿主一删就断」复发',
    run() {
      const declared = new Set(builtinModules)
      for (const pj of ['package.json', 'rewrite/cloud/package.json', 'rewrite/admin/package.json', 'rewrite/agent/package.json', 'rewrite/site/package.json', 'rewrite/shared/package.json']) {
        const abs = join(ROOT, pj)
        if (!existsSync(abs)) continue
        const j = JSON.parse(readFileSync(abs, 'utf8'))
        for (const k of Object.keys({ ...(j.dependencies || {}), ...(j.devDependencies || {}) })) declared.add(k)
      }
      const sourceImports = []
      for (const d of ['rewrite/cloud/src', 'rewrite/admin/src', 'rewrite/agent/src', 'rewrite/site/src', 'rewrite/shared/src', 'tests', 'scripts']) {
        const abs = join(ROOT, d)
        if (existsSync(abs)) sourceImports.push(...collectImportSpecifiers(abs))
      }
      // 过滤：带 scheme 的虚拟模块 + 非法包名形态（文档字符串里的伪 from '…' 噪声）
      for (const si of sourceImports) si.specifiers = si.specifiers.filter((x) => !x.includes(':') && /^(@[\w.-]+\/)?[\w.-]+(\/|$)/.test(x))
      return findPhantomDeps({ sourceImports, declared }).map((x) => `幽灵依赖 ${x}——import 了但无人声明（病根#17·补进对应 package.json）`)
    },
  },
  {
    id: 'rw-orphan-assets',
    roots: ['#17'],
    desc: '孤儿资产零容忍（病根#17）：assets/ 与 site/public、mp/static 下文件须在仓内有引用（按去扩展名 basename 匹配·覆盖 tab 图标 -on 动态拼接）——防素材换版后旧文件躺尸',
    run() {
      const pools = ['assets', 'rewrite/site/public', 'rewrite/mp/static']
      const names = []
      for (const pool of pools) {
        const abs = join(ROOT, pool)
        if (!existsSync(abs)) continue
        const rec = (d) => {
          for (const e of lsScan(d)) {
            const pp = join(d, e)
            if (statSync(pp).isDirectory()) rec(pp)
            else if (!/^(README\.md|LICENSE|index\.html)$/.test(e)) names.push({ rel: relative(ROOT, pp), stem: e.replace(/\.[^.]+$/, '') })
          }
        }
        rec(abs)
      }
      let corpus = ''
      const collect = (d) => {
        for (const e of lsScan(d)) {
          const pp = join(d, e)
          if (statSync(pp).isDirectory()) collect(pp)
          else if (/\.(ts|vue|wxml|wxss|astro|js|mjs|cjs|json|md|txt|html|css)$/.test(e)) corpus += readFileSync(pp, 'utf8')
        }
      }
      for (const d of ['rewrite', 'scripts', 'docs', 'console-assets']) if (existsSync(join(ROOT, d))) collect(join(ROOT, d))
      const bad = []
      for (const { rel, stem } of names) {
        const hit = corpus.includes(stem) || (stem.endsWith('-on') && corpus.includes(stem.slice(0, -3)))
        if (!hit) bad.push(`${rel} 仓内零引用——孤儿资产（病根#17·删除或补引用；tab 激活态图标按基名 + '-on' 拼接已放行）`)
      }
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
    id: 'rw-red-second-review',
    roots: ['#3'],
    desc: '红区（订单交易钱链 orders / 运维观测与配置 ops）改动必须双人复核——red 模块文件被改动时，提交信息须带 [red-review: <复核人>] 标记（工头亲自+人签字的机器化），拦截点在 commit-msg hook（pre-commit 阶段拿不到本次提交信息）。本守卫职责=机器闸完整性：commit-msg hook 缺失/未注册（core.hooksPath 错）即红——红区改动无人复核也拦不住=机器闸形同虚设。红区文件清单从 modules.json tier=red 推导 + 显式补录（app 网关壳/kit 共享内核）。反向自检：删 hook 或改 hooksPath 必红；改 red 文件无标记被 hook 拦。',
    run() {
      const bad = []
      const modPath = join(ROOT, 'modules.json')
      if (!existsSync(modPath)) return ['modules.json 缺失——守卫扫描面消失（rw-red-second-review）']
      let mods
      try { mods = JSON.parse(readFileSync(modPath, 'utf8'))?.modules ?? {} } catch { return [] }

      const redFiles = new Set()
      const appActionFileOf = {}
      const appDir = join(ROOT, 'rewrite/cloud/src/functions/app/actions')
      if (existsSync(appDir)) {
        for (const f of readdirSync(appDir).filter((x) => x.endsWith('.ts'))) {
          const src = readFileSync(join(appDir, f), 'utf8')
          for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const\s+)?(?:function\s+)?(\w+)\s*[=(]/gm)) {
            appActionFileOf[m[1]] = `rewrite/cloud/src/functions/app/actions/${f}`
          }
        }
      }
      for (const [mid, m] of Object.entries(mods)) {
        if (m?.tier !== 'red') continue
        for (const a of m?.appActions ?? []) {
          if (appActionFileOf[a]) redFiles.add(appActionFileOf[a])
        }
        for (const f of m?.adminActionFiles ?? []) {
          redFiles.add(`rewrite/cloud/src/functions/adminApi/actions/${f}.ts`)
        }
        for (const p of m?.mpPages ?? []) {
          redFiles.add(`rewrite/mp/pages/${p}`)
        }
        for (const p of m?.adminPages ?? []) {
          redFiles.add(`rewrite/admin/src/pages/${p}.vue`)
        }
      }
      const EXTRA_RED = [
        'rewrite/cloud/src/functions/app/index.ts',
        'rewrite/cloud/src/functions/adminApi/index.ts',
        'rewrite/cloud/src/functions/adminApi/lib.ts',
        'rewrite/cloud/src/kit/gate.ts',
        'rewrite/cloud/src/kit/wxpay.ts',
        'rewrite/cloud/src/kit/transition.ts',
        'rewrite/shared/src/money.ts',
      ]
      for (const f of EXTRA_RED) redFiles.add(f)

      let changed = []
      try {
        const staged = execSync('git diff --cached --name-only', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], cwd: ROOT })
        const unstaged = execSync('git diff --name-only', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], cwd: ROOT })
        changed = [...new Set([...staged.split('\n'), ...unstaged.split('\n')])].map((s) => s.trim()).filter(Boolean)
      } catch {
        return []
      }
      const redTouched = changed.filter((f) => [...redFiles].some((rf) => f === rf || f.startsWith(rf + '/')))
      if (redTouched.length === 0) return []

      const hookPath = join(ROOT, 'scripts/git-hooks/commit-msg')
      let hooksPath = ''
      try {
        hooksPath = execSync('git config core.hooksPath', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: ROOT }).trim()
      } catch { /* hooksPath 读取失败按未设置处理（下方判红） */ }
      if (!existsSync(hookPath) || hooksPath !== 'scripts/git-hooks') {
        bad.push(`红区文件被改动（${redTouched.slice(0, 5).join(', ')}）但 commit-msg 复核闸缺失（scripts/git-hooks/commit-msg 不存在或 core.hooksPath=${hooksPath || '未设置'}）——红区改动必须双人复核 [red-review: <复核人>]，机器闸缺失即红（rw-red-second-review·根因#3）`)
      }
      return bad
    },
  },
]

// ============== 逐文件规则（fileRules）==============
// 形状：{ id, inScope(absPath)->bool, test(line, {file, lines, i})->msg|null }
// 按主张追加（B3 起：禁 #ifdef 多端回退、禁 api 运行时引 data/…）。
export const fileRules = [
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
// 这些守卫没有独立的 JS 规则对象（活在 TS 编译期或 tests/），此处仅登记出处供 npm run report 展示。
// mechanism：'ts'（编译期，reverseTest 为手动篡改说明）| 'test'（reverseTest 指向测试文件）。
export const typeAndTestGuards = [
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
    reverseTest: 'rewrite/cloud/tests/transition.test.ts',
  },
  {
    id: 'deterministic-id-concurrency',
    mechanism: 'test',
    roots: ['#1'],
    reverseTest: 'rewrite/cloud/tests/ids.test.ts',
  },
  // 进销存计量整数一致（SCM-0·根因#8 假数据入账）：物料 uom 只收 count|gram 且建档后锁死（改 uom→400 UOM_LOCKED）；
  // 单据行数量/调整 delta 必整数（克/件全链整数·镜像金额「分整数」纪律·浮点入账即拒）。reverseTest 锁此组合行为。
  { id: 'scm-uom-integer', mechanism: 'test', roots: ['#8'], reverseTest: 'rewrite/cloud/tests/app-scm.test.ts' },
  // 组装快照冻结 + 幂等（SCM-C·根因#2·同订单快照原则）：组装单执行时冻结 bomSnapshot/consumedLines——改模板后
  // 历史单不追新（重放旧单结果不变）；同 assemblyId 重放 409 不双扣（claim=确定性 _id）；料不足全单回滚（宁不动账勿错账）。
  { id: 'bom-snapshot-frozen', mechanism: 'test', roots: ['#2'], reverseTest: 'rewrite/cloud/tests/app-scm.test.ts' },
  // 发货核销流水（SCM-D·根因#2·「如实核销」蓝图定稿）：shipOrder 首次 paid→shipped 必落 ship 流水
  // （fg 行确定性 _id=ship:<orderId>:fg:<pid>__<spec>·只留痕不动账）；改单号/重试/批量不双记账。reverseTest 锁此行为。
  { id: 'ship-verify-ledger', mechanism: 'test', roots: ['#2'], reverseTest: 'rewrite/cloud/tests/app-scm.test.ts' },
  // admin 频控全局/账户级兜底（审核 P1·根因#13）：per-IP 频控 key 取 x-forwarded-for（可伪造·轮换可绕 5 次锁），
  // 故叠加跨所有 IP 的全局失败计数——轮换伪造 header 的爆破累计达全局阈值仍锁。reverseTest 锁此组合行为。
  { id: 'admin-throttle-global-backstop', mechanism: 'test', roots: ['#13'], reverseTest: 'rewrite/cloud/tests/security-dos-hardening.test.ts' },
  // 钱/权限两条门面守卫的 reverseTest 锚活线等价测试（盲区体检批2·病根#16 ⑥）。
  { id: 'gate-fail-closed', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/gate.test.ts' },
  { id: 'notify-forge-proof', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/notify.test.ts' },
  // 支付配置 fail-closed（根因#3 同款）：createOrder 缺/错 config/pay 时绝不伪造已付单——
  // mock 仅 env ALLOW_MOCK_PAY=1 放行，否则拒 PAY_CONFIG_MISSING（reverseTest 锁此行为）。
  { id: 'pay-config-fail-closed', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/app-orders.test.ts' },
  { id: 'fen-money-chain', mechanism: 'test', roots: ['#4'], reverseTest: 'rewrite/cloud/tests/e2e-refund-conservation.test.ts' },
  { id: 'paging-contract', mechanism: 'test', roots: ['#7'], reverseTest: 'rewrite/cloud/tests/paging.test.ts' },
  // 发货上传 fail-soft（根因#12 + 合规债#26）：微信发货上传失败绝不反噬本地发货——shipOrder 仍翻 shipped、
  // 留痕 wxShipError、打 [LD_ALERT] sev=money 告警人工补录；上传成功留痕 wxShipUploaded。reverseTest 锁此行为。
  { id: 'shipping-upload-fail-soft', mechanism: 'test', roots: ['#12'], reverseTest: 'rewrite/cloud/tests/app-admin3.test.ts' },
  // 商品停售生效（债#12）：unpublishProduct 置 listed:false 后 getProducts 不再下发该商品（顾客端列表消失），
  // republishProduct 恢复；旧无 listed 字段的商品视为可售（兼容）。reverseTest 锁此端到端行为。
  { id: 'product-unpublish-effective', mechanism: 'test', roots: ['债#12'], reverseTest: 'rewrite/cloud/tests/app-catalog.test.ts' },
  // 停售商品挡交易入口（审核 P1·债#12 + 根因#3 信任边界 fail-closed）：软下架（listed:false）此前只挡 getProducts
  // 列表，createOrder 不校验——旧购物车/缓存/直调云函数仍能买已停售品。本守卫锁 createOrder 对 listed:false 主商品
  // fail-closed（UNLISTED_ITEM·不建单不扣库存），且 publishProduct 重新上架保留旧 listed（不隐式复活销售）。reverseTest 锁此组合行为。
  { id: 'createorder-rejects-unlisted', mechanism: 'test', roots: ['债#12', '#3'], reverseTest: 'rewrite/cloud/tests/app-orders.test.ts' },
  // 评价列表分页端到端（根因#7·债#13）：getReviews 列表 cursor 翻页（>limit 返 nextCursor·续页接上），
  // 汇总仅首页基于 bounded 样本返回（approx 标注）。reverseTest 锁此行为。
  { id: 'reviews-paged-effective', mechanism: 'test', roots: ['#7'], reverseTest: 'rewrite/cloud/tests/app-reviews.test.ts' },
  // 评价汇总真全量精确（债#13 后半·根因#7 固定样本失真）：评分/计数/星级分布走 count()+aggregate(sum)·不封顶·approx 恒 false
  // （与 dashboard GMV 同范式·#18续）；标签仍近样本 top-5。reverseTest 灌 250 条（>200 样本上限）锁「不被截断」。
  { id: 'reviews-summary-exact', mechanism: 'test', roots: ['#7', '债#13'], reverseTest: 'rewrite/cloud/tests/app-reviews.test.ts' },
  // 用户反馈写库行为端到端（运营钩子①·待办#23）：submitFeedback 缺身份 fail-closed（NO_OPENID·根因#3）、
  // content 空/越长截断、category 白名单越界归 other、超 10 次/分 RATE_LIMITED（根因#13）。reverseTest 锁此行为。
  { id: 'feedback-throttled-gated', mechanism: 'test', roots: ['#13', '债#23'], reverseTest: 'rewrite/cloud/tests/app-misc.test.ts' },
  // 企微推送 fail-soft（债#23续·根因#13）：pushBotAlert 推送失败/网络异常/非企微 webhook 一律返回 ok:false
  // 而**绝不抛错**——可观测性不反噬主流程（钱链回调照常 ACK）。reverseTest 锁此行为。
  { id: 'bot-alert-fail-soft', mechanism: 'test', roots: ['#13', '债#23'], reverseTest: 'rewrite/cloud/tests/botpush.test.ts' },
  // 下单库存预留 + 回补端到端（库存#1·根因#1/#2 防超卖）：createOrder 缺货拒单(OUT_OF_STOCK)、预留扣减记 reserved；
  // 超时关单回补且幂等；乐观 CAS 抢最后一件只一个赢；不限量(无文档)放行。reverseTest 锁此行为。
  { id: 'order-reserves-stock', mechanism: 'test', roots: ['#1', '#2'], reverseTest: 'rewrite/cloud/tests/e2e-inventory-oversell.test.ts' },
  // 关单回补后晚到回调复活前重抢库存（审核 P0·根因#1/#2 防超卖）：closed 单库存已在关单时回补，payCallback
  // 收到晚到成功回调须**重新 reserveStock 抢回 reserved 才翻 paid**；抢不到（已售罄）则进 refund_required 待退款态
  // （钱已收·不静默吞钱·告警人工退款），杜绝「关单回补 + 晚到回调」双单争一份库存的超卖。reverseTest 锁此组合行为。
  { id: 'paycallback-revive-reserves-stock', mechanism: 'test', roots: ['#1', '#2'], reverseTest: 'rewrite/cloud/tests/e2e-paycallback-contract.test.ts' },
  // 管理操作审计（操作审计#4·根因#3）：recordAudit 写痕 + 剥凭证 + fail-soft；shouldAudit 只记动钱/状态操作、跳只读/上传/认证。reverseTest 锁此行为。
  { id: 'admin-action-audit-logged', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/adminapi-gates-batch-c.test.ts' },
  // 新会话推送 fail-soft（M⑦ 推送线·根因#8「构建过≠真能用」防推送反噬）：enqueueSession 推在线坐席（应用消息）
  // 失败/网络异常一律静默——转人工入队照常完成、顾客回复不受影响；且只在「真正新入队」（首建/closed 重开）才推，
  // 已 pending/active 不重复骚扰。reverseTest 锁此行为（推送抛错→enqueue 仍 resolves + 会话入队）。
  { id: 'enqueue-push-fail-soft', mechanism: 'test', roots: ['#8'], reverseTest: 'rewrite/cloud/tests/botpush.test.ts' },
  // 企微免登 fail-closed（M⑦ 车道B·根因#3 信任边界）：loginByWecomCode 无 code/换不到 userid/userid 未绑账号/
  // 账号停用/无缓存令牌 → 一律拒、绝不签发 session 令牌；checkKey 认令牌时过期/停用 → 拒（不放行）。签发的令牌
  // 存 sha 不存明文·令牌不持密钥（复用缓存令牌·根因#3）。reverseTest 锁此 fail-closed 组合行为。
  { id: 'wecom-login-gated', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/app-admin6.test.ts' },
  // 口令登录签发会话令牌（深审 P1·根因#3 口令不落盘）：login 成功必随包返 sessionToken（sha 入 sessions 数组·
  // 绝不存明文）；令牌可作后续请求 key（checkKey 会话解析）；过期/停号 fail-closed 拒；多设备并存（sessions
  // 数组·剪过期/超容剪最旧）；口令作 key 兼容不破（旧已部署前端）。reverseTest 锁此组合行为。
  { id: 'admin-session-issued', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/app-admin1.test.ts' },
  // 库存列表有界读（深审 P2·根因#7/#8）：真 SDK 裸 .get() 默认 100 条静默截断（桩已对齐此语义·根因#8）——
  // getInventory 分页取齐（100/页·封顶 1000）、到顶如实报 truncated（前端明示不装全量）。reverseTest 灌 150 条锁「不被 100 截断」。
  { id: 'inventory-reads-bounded', mechanism: 'test', roots: ['#7', '#8'], reverseTest: 'rewrite/cloud/tests/scm-paging-bounded.test.ts' },
  // 外部对账比对面截断如实标注（深审 P2·根因#7 固定样本失真）：getBillMatch 取最近 CAP 条触顶时必返 approx:true
  // ——否则老窗口真单配不上账单被误报「微信有我方无（最危险）」＝截断假象当真差异。reverseTest 灌满 CAP 锁此标注。
  { id: 'billmatch-approx-flag', mechanism: 'test', roots: ['#7'], reverseTest: 'rewrite/cloud/tests/bill-reconcile.test.ts' },
  // 云存储上传路径消毒（深审 P3·根因#3 不信前端）：storeImage/getVideoUploadMeta 的 pid/courseId 客户端串
  // 直接拼对象键——'../' 等路径字符须剥净（[^\w-] 白名单·同 name 口径）、全非法回退 misc。reverseTest 锁此行为。
  { id: 'upload-path-sanitized', mechanism: 'test', roots: ['#3'], reverseTest: 'rewrite/cloud/tests/course-chain-hardening.test.ts' },
  // 体检面板派生性（正册·可视检查系统批）：面板守卫清单必须=四注册表机器派生（一条不漏不多造）、
  // 失败现场置顶可见、单测带复跑命令、病根地图与根因账本 §一 同源。reverseTest 锁此派生性。
  { id: 'check-report-derived', mechanism: 'test', roots: ['正册'], reverseTest: 'tests/scripts/checkReport.test.js' },
  // mp↔cloud 响应契约哨兵（批B10·病根#5 手抄副本漂移 + #8 编译绿≠契约没漂）：mp 物理进不了
  // @ldrw/shared（微信开发者工具编译限制），响应形状全靠手抄——cloud 改键 mp 编译不红＝静默漂移面。
  // 钱链/学习链 5 热 action（createOrder/pay/getMyOrders/getOrderById/getPlaybackUrl）成功响应
  // 精确键集合（Object.keys 排序全等·增删都红）；红了先同步 rewrite/shared/src/contracts.ts 与
  // mp 消费面四点位（payFlow/mapOrders/playbackCache/order-list·清单见测试头注）。
  { id: 'rw-app-response-contract', mechanism: 'test', roots: ['#5', '#8'], reverseTest: 'rewrite/cloud/tests/contract-shape.test.ts' },
  // 云环境选择子（Issue #106·病根#5）：同一套断言对 stub|test|prod-readonly 分别解析；
  // 空输入=生产只读保险；写测试须显式 test；目录无密钥。reverseTest 锁解析矩阵。
  { id: 'env-catalog-resolve', mechanism: 'test', roots: ['#5'], reverseTest: 'tests/scripts/env-catalog.test.js' },
  // 小程序「我」页版本脚自动戳（老板 2026-09-18·根因#8/#5）：日期上海日历、通道 main→开发 / test→测试 /
  // release→发布候选 / experimental→实验。reverseTest 锁脚本行为 + hook/CI/预览接线。
  { id: 'rw-mp-version-stamp-script', mechanism: 'test', roots: ['#8', '#5'], reverseTest: 'tests/scripts/stamp-mp-version-date.test.js' },
  { id: 'rw-mp-version-channel', mechanism: 'test', roots: ['#5', '#8'], reverseTest: 'rewrite/mp/tests/app-version.test.ts' },
]

// export：供 check-report 体检面板复用同一套遍历/判定（面板=派生视图，禁自建第二套语义）
// 'rewrite' 加入扫描面（批1·2026-07-10）：唯一在迭代的活代码线，此前 fileRules 全量扫描扫不到，
// rw- 前缀的新守卫不动这条即是装饰。旧 fileRules（5 条）inScope 全部锁死 packages 路径，扩面不误咬。
export const SRC_DIRS = ['packages', 'cloudfunctions', 'scripts', 'rewrite']
// 扩展名过滤可选参数（2026-07-25 全量页面体检批）：默认沿用「编译面四类」不动既有全部调用方，
// 需要扫小程序模板层的守卫显式传 exts。病根：默认集合不含 .wxml/.wxss/.json，**凡走 walk() 的守卫
// 在 mp 模板层一律失明**——废弃店名占位「易织™小棉鸭®」正是借此在 order/checkout 两处 wxml 里
// 活了下来（brand-name-single-source 守卫在位、禁词正确、npm run check 全绿，照样漏）。
export function* walk(dir, exts = /\.(js|mjs|cjs|ts|vue)$/) {
  if (!existsSync(dir)) return
  for (const name of lsScan(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p, exts)
    else if (exts.test(name)) yield p
  }
}
const isCommentLine = (line) => /^(\/\/|\/\*|\*|<!--|#)/.test(line.trim())

// 剥注释单源 helper（执行者错题本 E1·坑史：方法体正则咬注释假绿——2026-07-08 播放页批/客服批连栽两次）：
// 剥 // 行注释与 /* */ 块注释，供守卫「查真实调用」前先清场——防真调用挪进注释、假实现留在正文，正则仍误判命中。
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
// 不可能横跨一个真实的顶层函数/块边界，掩蔽换计数简单换来的假阳性风险可忽略。
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
    let result
    try {
      result = c.run()
    } catch (e) {
      violations.push({ loc: `[${c.id}]`, msg: `守卫执行抛异常（扫描面缺失/IO 失败）：${e?.message || e}`, src: c.desc })
      continue
    }
    for (const msg of result) violations.push({ loc: `[${c.id}]`, msg, src: c.desc })
  }
  return violations
}

function report(violations, stream) {
  for (const v of violations) stream.write(`${v.loc}\n  ✗ ${v.msg}\n  → ${v.src}\n`)
  stream.write(`\n结构不变量未通过：${violations.length} 处（每条对应一项重构主张守卫；刻意例外行内加 structure-ok）\n`)
}

// 引擎自检（非守卫）：任一守卫数组内 id 重复注册即红并使 check:structure 非零退出。
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

// CLI 入口包进 main()，只在被 node 直接运行时执行——这样测试 / npm run report
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
