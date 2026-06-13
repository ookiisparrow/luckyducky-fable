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
  const usesManager = readFileSync(join(outdir, 'index.js'), 'utf8').includes('@cloudbase/manager-node')
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
}

console.log(
  `✅ esbuild 打包 ${fns.length} 个云函数 → packages/cloud/dist/：` +
    fns.map((f) => `${f.domain}/${f.name}`).join(' · ')
)
