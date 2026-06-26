/**
 * cloud-kit 打包（esbuild）：functions/<domain>/<name>.ts → dist/<name>/index.js
 * （CJS 单文件，kit/shared 内联 + 摇树），external: wx-server-sdk（tcb 运行时提供 + installDependency 装）。
 * 产物形态与现 cloudfunctions/ 部署同构（每函数一目录：index.js + package.json）。
 *
 * 用法：npm run build:cloud（先 build:shared 产 @luckyducky/shared dist 供内联）。
 * 部署：本仓禁部署（guard-deploy 全拦）；产物经回灌点在生产仓部署验证（用户动作）。
 */
import { build } from 'esbuild'
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const ROOT = resolve(import.meta.dirname)
const FN_ROOT = join(ROOT, 'src', 'functions')
const OUT = join(ROOT, 'dist')

function collect() {
  const fns = []
  for (const domain of readdirSync(FN_ROOT)) {
    const dpath = join(FN_ROOT, domain)
    if (!statSync(dpath).isDirectory()) continue
    for (const entry of readdirSync(dpath)) {
      const epath = join(dpath, entry)
      if (statSync(epath).isDirectory()) {
        // 多文件函数：<域>/<name>/index.ts（esbuild 内联本地 imports：lib/actions）
        const idx = join(epath, 'index.ts')
        if (existsSync(idx)) fns.push({ name: entry, domain, entry: idx })
      } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
        fns.push({ name: basename(entry, '.ts'), domain, entry: epath })
      }
    }
  }
  return fns
}

const fns = collect()

// 云调用（cloud.openapi）权限登记（根因#12 平台接缝 + 合规债#26）：每个云函数若用到下列云调用，其部署产物
// 须带 config.json 声明对应 openapi 权限，否则微信拒调用（权限不足）。权限串 === JS 调用路径 cloud.openapi.<串>
// （官方云调用规则·如 wxacode.getUnlimited / subscribeMessage.send）。当前仅发货上传一处；新增云调用须在此登记，
// 否则 check-structure 的 openapi-perm-declared 守卫会红。
const OPENAPI_PERMS = [
  'wxaSecOrder.uploadShippingInfo', // 发货信息上传 upload_shipping_info（kit/shipping.ts·实物+微信支付合规·债#26）
]

// 并发构建安全（复审报告 P2）：verify:cloud / deploy-fns 各自独立跑 build:cloud，并发时共享
// dist 的 rmSync ↔ 写入互踩 → ENOTEMPTY / 产物损坏。用原子 mkdir 作锁串行化：第二个构建等第
// 一个完成而非污染产物（mkdir 已存在即 EEXIST＝锁被持有）。构建脚本并发性静态测不出（无干净
// 机器守卫）——故收口于此 + 成文（靠人纪律：别绕过锁手删 dist）。僵锁 >2min 自动破除。
const LOCK = join(ROOT, '.build-cloud.lock')
const lockDeadline = Date.now() + 120_000
for (;;) {
  try {
    mkdirSync(LOCK) // 原子 check-and-create：已被持有则抛 EEXIST
    break
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    if (Date.now() > lockDeadline) {
      rmSync(LOCK, { recursive: true, force: true }) // 僵锁破除（持锁进程已崩）
      continue
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

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
    legalComments: 'none',
  })
  // 每函数 package.json（installDependency 装）：wx-server-sdk 恒有；manager-node 按需。
  // 从打包产物检测（多文件函数里 manager-node 在 lib，不在 index 入口；产物含其 external require）
  const bundle = readFileSync(join(outdir, 'index.js'), 'utf8')
  const usesManager = bundle.includes('@cloudbase/manager-node')
  writeFileSync(
    join(outdir, 'package.json'),
    JSON.stringify(
      {
        name: fn.name,
        version: '1.0.0',
        main: 'index.js',
        dependencies: {
          'wx-server-sdk': '~2.6.3',
          ...(usesManager ? { '@cloudbase/manager-node': '^4.2.0' } : {}),
        },
      },
      null,
      2
    ) + '\n'
  )
  // 云调用权限 config.json（债#26·根因#12）：产物用到登记的 cloud.openapi.<串>（串在打包产物里以属性访问形式
  // 保留，如 .wxaSecOrder.uploadShippingInfo）即声明对应 openapi 权限；用不到则不产（避免空 config.json）。
  const openapi = OPENAPI_PERMS.filter((perm) => bundle.includes(perm))
  if (openapi.length) writeFileSync(join(outdir, 'config.json'), JSON.stringify({ permissions: { openapi } }, null, 2) + '\n')
}

rmSync(LOCK, { recursive: true, force: true }) // 释放并发构建锁

console.log(
  `✅ esbuild 打包 ${fns.length} 个云函数 → packages/cloud/dist/：` +
    fns.map((f) => `${f.domain}/${f.name}`).join(' · ')
)
