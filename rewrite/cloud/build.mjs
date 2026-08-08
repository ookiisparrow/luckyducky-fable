/**
 * 重写线云函数打包（esbuild·M1 批18 收口·承接旧线 packages/cloud/build.mjs 范式）：
 * functions/ 下每个「函数单元」→ dist/<name>/index.js（CJS 单文件，kit/@ldrw/shared 内联 + 摇树），
 * external: wx-server-sdk（tcb 运行时提供 + installDependency 装）。
 *
 * 函数单元判定（与守卫 rw-interface-catalog-sync 同规则）：
 *   顶层目录含 index.ts 且有 `export const main` ＝ 一函数（app / adminApi）；
 *   否则为组目录（callbacks/timers/cs/ops），其下含 main 的 .ts 文件或含 main index.ts 的子目录各为一函数
 *   （无 main 的文件如 timers/recallRules.ts 是库·被内联、不独立成函数）。
 * @ldrw/shared 经 esbuild alias 直接从 TS 源打包（无需先 build shared dist——区别旧线两步构建）。
 *
 * 用法：npm run build:rw-cloud。部署（M5 切换后事实·深审 P3 纠错）：本仓＝生产源，rewrite/cloud/dist 是
 * 真实部署产物、部署真实生效于云环境 cloudbase-d4gcssqbv06865479；部署经 guard-deploy 闸（读类/单个非敏感
 * 放行·敏感/批量 ask 二次确认——非「全拦」）+ 人工确认。旧注释「本仓禁部署·并行期防覆盖」是切换前状态，已废。
 */
import { build } from 'esbuild'
import {
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname)
const FN_ROOT = join(ROOT, 'src', 'functions')
const OUT = join(ROOT, 'dist')
const SHARED = resolve(ROOT, '..', 'shared', 'src', 'index.ts')

const hasMain = (p) => readFileSync(p, 'utf8').includes('export const main')

function collect() {
  const fns = []
  for (const top of readdirSync(FN_ROOT)) {
    const tpath = join(FN_ROOT, top)
    if (!statSync(tpath).isDirectory()) continue
    const idx = join(tpath, 'index.ts')
    if (existsSync(idx) && hasMain(idx)) {
      fns.push({ name: top, group: top, entry: idx }) // 顶层函数目录（app / adminApi）
      continue
    }
    for (const entry of readdirSync(tpath)) {
      const epath = join(tpath, entry)
      if (statSync(epath).isDirectory()) {
        const ci = join(epath, 'index.ts')
        if (existsSync(ci) && hasMain(ci)) fns.push({ name: entry, group: top, entry: ci })
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && hasMain(epath)) {
        fns.push({ name: basename(entry, '.ts'), group: top, entry: epath })
      }
    }
  }
  return fns
}

// 云调用（cloud.openapi）权限登记（根因#12 平台接缝·守卫 rw-openapi-perm-declared 对账源码调用面）：
// 产物用到即产 config.json 声明，否则微信拒调用。权限串 === JS 调用路径 cloud.openapi.<串>。
const OPENAPI_PERMS = [
  'wxaSecOrder.uploadShippingInfo', // 发货信息上传（kit/shipping.ts·实物+微信支付合规）
  'security.imgSecCheck', // 图片内容安全（kit/contentsec.ts·UGC 节点拍照/买家秀/头像入库前 fail-closed）
  'security.msgSecCheck', // 文本内容安全（kit/contentsec.ts·UGC 评价文本/昵称/签名入库前 fail-closed）
]

const fns = collect()
if (existsSync(OUT)) rmSync(OUT, { recursive: true })

// 构建戳（工业级缺口③·release provenance）：产物必须能回答「这是从哪个提交构建的、构建时工作区干不干净」。
// 此前全仓零构建戳，线上版本只能靠人眼比对打包文件名哈希、生产状态记在待办本散文里。
// 只写元数据、不改任何函数源码 ⇒ 对运行时零风险；随 dist 一起上云，部署后仍可查。
// dirty=true 意味着**用未提交的代码构建**（经典工业事故），这里如实留痕而不是拦——拦属部署闸的职责。
const stamp = (() => {
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
    } catch {
      return '' // 非 git 环境/无 git ⇒ 记空，不让构建因取不到元数据而失败
    }
  }
  const sha = git(['rev-parse', '--short', 'HEAD'])
  // 版本号单源：仓根 package.json（生产定版权在老板，见 scripts/release.mjs）。
  // 测试部署（deploy-test.mjs）会经 LD_BUILD_VERSION 注入 `X.Y.Z-test.N`；生产构建不带该
  // 变量 ⇒ version 即正式号。取不到记 'unknown'，不让构建因元数据缺失而失败。
  let version = 'unknown'
  try {
    // 版本单源=仓根 package.json（ROOT 是 rewrite/cloud，仓根上两级）
    version = JSON.parse(readFileSync(resolve(ROOT, '..', '..', 'package.json'), 'utf8')).version || 'unknown'
  } catch {
    version = 'unknown'
  }
  if (process.env.LD_BUILD_VERSION) version = process.env.LD_BUILD_VERSION
  return {
    sha: sha || 'unknown',
    version, // 业务版本号：生产=X.Y.Z；测试=X.Y.Z-test.N（LD_BUILD_VERSION 注入）
    dirty: git(['status', '--porcelain']) !== '', // 工作区有未提交改动
    builtAt: new Date().toISOString(),
  }
})()

for (const fn of fns) {
  const outdir = join(OUT, fn.name)
  mkdirSync(outdir, { recursive: true })
  await build({
    entryPoints: [fn.entry],
    outfile: join(outdir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node18', // tcb 云函数运行时
    format: 'cjs',
    external: ['wx-server-sdk', '@cloudbase/manager-node'], // 运行时提供 / installDependency 装，禁内联
    alias: { '@ldrw/shared': SHARED }, // 直接从 TS 源内联（单步构建）
    legalComments: 'none',
  })
  // 每函数 package.json（installDependency 装）：wx-server-sdk 恒有；manager-node 按产物检测（同旧线）
  const bundle = readFileSync(join(outdir, 'index.js'), 'utf8')
  const usesManager = bundle.includes('@cloudbase/manager-node')
  writeFileSync(
    join(outdir, 'package.json'),
    JSON.stringify(
      {
        name: fn.name,
        version: `0.0.0-${stamp.sha}${stamp.dirty ? '-dirty' : ''}`, // 构建戳随每函数上云（缺口③）
        dependencies: {
          'wx-server-sdk': '~2.6.3',
          ...(usesManager ? { '@cloudbase/manager-node': '^4.2.0' } : {}),
        },
      },
      null,
      2
    ) + '\n'
  )
  // 云调用权限 config.json：产物真用到（属性访问串保留在 bundle 里）才声明；用不到不产（避免空权限）
  const openapi = OPENAPI_PERMS.filter((perm) => bundle.includes(perm))
  if (openapi.length)
    writeFileSync(
      join(outdir, 'config.json'),
      JSON.stringify({ permissions: { openapi } }, null, 2) + '\n'
    )
}

// dist 根一份汇总戳：部署前/后核对「这批产物出自哪个提交」的单一来源。
writeFileSync(join(OUT, 'BUILD-INFO.json'), JSON.stringify({ ...stamp, functions: fns.map((f) => f.name) }, null, 2) + '\n')

console.log(
  `✅ esbuild 打包 ${fns.length} 个重写线云函数 → rewrite/cloud/dist/：` +
    fns.map((f) => `${f.group}/${f.name}`).join(' · ')
)
console.log(
  `🔖 构建戳 ${stamp.sha}${stamp.dirty ? ' ⚠️ dirty（工作区有未提交改动·部署前请确认这正是你要发的代码）' : ''} @ ${stamp.builtAt}`
)
