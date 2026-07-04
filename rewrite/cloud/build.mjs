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
 * 用法：npm run build:rw-cloud。部署：本仓禁部署（guard-deploy 全拦）——产物形态供 M5 切换日用；
 * 并行期同名函数（回调/定时器/ops）只 build 不部署，防覆盖线上（云环境与 next 共用·真生产）。
 */
import { build } from 'esbuild'
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

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
  'security.imgSecCheck', // 图片内容安全（kit/contentsec.ts·UGC 节点拍照入库前 fail-closed）
]

const fns = collect()
if (existsSync(OUT)) rmSync(OUT, { recursive: true })

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
        version: '1.0.0',
        main: 'index.js',
        dependencies: { 'wx-server-sdk': '~2.6.3', ...(usesManager ? { '@cloudbase/manager-node': '^4.2.0' } : {}) },
      },
      null,
      2
    ) + '\n'
  )
  // 云调用权限 config.json：产物真用到（属性访问串保留在 bundle 里）才声明；用不到不产（避免空权限）
  const openapi = OPENAPI_PERMS.filter((perm) => bundle.includes(perm))
  if (openapi.length) writeFileSync(join(outdir, 'config.json'), JSON.stringify({ permissions: { openapi } }, null, 2) + '\n')
}

console.log(`✅ esbuild 打包 ${fns.length} 个重写线云函数 → rewrite/cloud/dist/：` + fns.map((f) => `${f.group}/${f.name}`).join(' · '))
