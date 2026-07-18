#!/usr/bin/env node
/**
 * 活线产物行为验证（盲区体检批4·根因#8「构建过≠真能用」在部署产物层的镜像·病根#16 配套）：
 * 把 esbuild 产物（rewrite/cloud/dist/<fn>/index.js）当真云函数 require 进来跑。
 *
 * 为什么要有：三道闸（编辑 hook/pre-commit/CI）此前从不构建任何真实生产产物——esbuild 特有
 * 的问题（external 声明错、动态 require 未排除、摇树误删）在 check 全绿下直接流入生产；
 * 旧 verify-cloud-bundles.cjs 只验冻结旧线（其头注自declared），活线产物层是验证真空。
 *
 * 验证面（专守「打包不破坏」，深行为归 vitest 对 src 的 2000+ 例）：
 *   ① 全部函数产物可 require 且导出 main 函数（bundle require 图完整·external 解析正确）；
 *   ② 网关 fail-closed 冒烟在**产物层**活着：app 未知 action 拒 BAD_ARGS、无身份拒 NO_OPENID。
 *      （adminApi 为 HTTP 触发形态，契约冒烟归 vitest 网关测试；此处验加载面即可——其
 *      @cloudbase/manager-node 为惰性 require，本地无该包也必须可加载，一并被①证明。）
 *
 * 产物 external 的 wx-server-sdk 从本仓 node_modules 解析到 file: 内存桩（stub-only-sdk 守卫
 * 焊死的同一份）——与 vitest 同源，桩即受控云。
 *
 * 用法：npm run verify:rw-cloud（先 build:rw-cloud 产 dist）。CI 的 check:artifacts 步骤调用。
 */
const { resolve, join } = require('node:path')
const { readdirSync, existsSync } = require('node:fs')

const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'rewrite/cloud/dist')
const { control } = require(resolve(ROOT, 'node_modules/wx-server-sdk'))

let failed = 0
const assert = (cond, msg) => {
  if (cond) console.log('  ✓ ' + msg)
  else {
    console.error('  ✗ ' + msg)
    failed++
  }
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('✗ rewrite/cloud/dist 不存在——先 npm run build:rw-cloud')
    process.exit(1)
  }
  const fns = readdirSync(DIST).filter((n) => existsSync(join(DIST, n, 'index.js')))
  assert(fns.length >= 15, `产物函数数 ${fns.length}（≥15·16 函数拓扑，缺=build 掉队）`)

  for (const name of fns) {
    try {
      const mod = require(join(DIST, name, 'index.js'))
      assert(typeof mod.main === 'function', `${name} 可加载且导出 main`)
    } catch (e) {
      assert(false, `${name} 产物 require 失败：${String(e && e.message).slice(0, 120)}`)
    }
  }

  // 网关 fail-closed 冒烟（产物层）
  control.reset()
  control.setOpenId('oVERIFY_BUNDLE')
  const app = require(join(DIST, 'app', 'index.js'))
  const r1 = await app.main({ action: '__no_such_action__', data: {} })
  assert(
    r1 && r1.ok === false && r1.error === 'BAD_ARGS',
    `app 产物：未知 action 拒 BAD_ARGS（实得 ${JSON.stringify(r1).slice(0, 80)}）`
  )
  control.setOpenId('')
  const r2 = await app.main({ action: 'login', data: {} })
  assert(r2 && r2.ok === false && r2.error === 'NO_OPENID', `app 产物：无身份拒 NO_OPENID（fail-closed 缺省在产物层活着）`)

  console.log(failed ? `\n✗ 活线产物验证未过：${failed} 处` : '\n✅ 活线产物验证通过（加载面 + 网关 fail-closed 冒烟）')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('✗ 验证脚本异常：', e)
  process.exit(1)
})
