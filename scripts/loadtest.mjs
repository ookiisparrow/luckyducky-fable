#!/usr/bin/env node
/**
 * 压测台（债#19）——**只打独立测试环境，绝不碰生产**。
 *
 * 为什么这么测：本仓从未压测、全靠看码推断（根因#8）。我们改的 throttle CAS / dashboard
 * count·aggregate 全建立在一个**未验的假设**上：「真微信云 `where().update()` 是原子的、
 * `count()/aggregate` 不受 1000 封顶」。本脚本用 node-sdk admin **直连测试库**验这两条地基
 * （不经云函数——throttle 在 withOpenId 后、adminApi 是 HTTP 口，node-sdk 都调不动；而地基本身
 * 才是 throttle/transition/激活码/看板 共同所依）：
 *   ① 并发 CAS 原子性：一个 doc 上 N 个并发「读 v → where({_id,v:旧}).update(v+1)」→ 无丢更新则 v===N。
 *      这是 bumpWindowed/transition/激活码抢占的同一招——它真原子，那套并发正确性才算证。
 *   ② 规模精确：灌 N 条假单 → count() 应===N、aggregate 求和应精确（验 #18/#18续 破千不少算）。
 *
 * 前置：① 独立测试环境（非生产）② npm i -D @cloudbase/node-sdk ③ 本地 export
 *   TCB_SECRETID/TCB_SECRETKEY（经典 CAM 密钥·别进仓库/聊天）。
 * 用法：
 *   node scripts/loadtest.mjs --env <测试envId> --mode cas --n 200
 *   node scripts/loadtest.mjs --env <测试envId> --mode capacity --seed 2000
 * 安全闸：--env 等于生产 envId 直接退出。跑完自动清理 _loadtest 数据。
 */

import { fileURLToPath } from 'node:url'

const PROD_ENV = 'cloudbase-d4gcssqbv06865479' // 生产·禁压
const COL = 'loadtest' // 专用集合·与业务集合隔离·跑完清空

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]
  return a
}
function usage(msg) {
  if (msg) console.error('✗ ' + msg)
  console.error('用法：node scripts/loadtest.mjs --env <测试envId> --mode <cas|capacity> [--n 200] [--seed 2000]')
  process.exit(1)
}

async function getDb(env) {
  if (!process.env.TCB_SECRETID || !process.env.TCB_SECRETKEY) {
    usage('缺 CAM 密钥：跑命令时内联 TCB_SECRETID=<id> TCB_SECRETKEY=<key>（别用裸 npm run loadtest；密钥别进仓库/聊天）')
  }
  let cloudbase
  try {
    cloudbase = (await import('@cloudbase/node-sdk')).default
  } catch {
    usage('缺依赖：先 npm i -D @cloudbase/node-sdk')
  }
  const app = cloudbase.init({
    env,
    secretId: process.env.TCB_SECRETID,
    secretKey: process.env.TCB_SECRETKEY,
  })
  return app.database()
}

// SDK 返回形状兼容：node-sdk（直连）get().data 是数组、update() 返回 {updated}；
// wx-server-sdk（云函数内）get().data 是对象、update() 返回 {stats:{updated}}。两种都读对。
// 导出供 tests/scripts/loadtest.test.js 锁两种形状（根因#8 桩绿≠真证：读错字段会假阴）。
export function readV(res) {
  const d = res && res.data
  const doc = Array.isArray(d) ? d[0] : d
  return doc && typeof doc.v === 'number' ? doc.v : 0
}
export function updatedCount(r) {
  if (!r) return 0
  if (typeof r.updated === 'number') return r.updated // node-sdk
  if (r.stats && typeof r.stats.updated === 'number') return r.stats.updated // wx-server-sdk
  return 0
}

// ① 真库 CAS 原子性：N 并发自增同一 doc（读→where(旧值).update），无丢更新则 v===N。
async function runCas(db, n) {
  const id = 'cas-probe'
  // node-sdk(@cloudbase/database) set/update/add 都吃裸对象、不要 {data:...} 包层（云函数 wx-server-sdk 才要）
  await db.collection(COL).doc(id).set({ v: 0, _loadtest: true })
  console.log(`并发 CAS：${n} 个并发自增同一 doc（验真库 where().update() 原子性）…`)
  let lost = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let i = 0; i < 100; i++) {
        const got = await db.collection(COL).doc(id).get()
        const v = readV(got)
        const r = await db.collection(COL).where({ _id: id, v }).update({ v: v + 1 })
        if (updatedCount(r) === 1) return
      }
      lost++ // 100 次重试仍没抢到（极端争用）
    })
  )
  const fin = await db.collection(COL).doc(id).get()
  const v = readV(fin)
  console.log(`  最终 v=${v}（期望 ${n}）· 重试耗尽 ${lost}`)
  if (v === n) console.log('  ✅ 真库 where().update() CAS 原子·无丢更新——throttle/transition/激活码 地基成立')
  else console.log(`  ❌ 丢更新（v=${v}≠${n}）——真库 CAS 非原子，throttle 限频/激活抢占会漏！`)
  await db.collection(COL).doc(id).remove().catch(() => {})
}

// ② 规模精确：灌 seed 条假单 → count() 应===seed、aggregate 求和应精确（验破千不少算）。
async function runCapacity(db, seed) {
  console.log(`规模：灌 ${seed} 条假单到测试集合 ${COL}…`)
  const BATCH = 20 // 小批并发灌·控在环境限流以下（CAS n=20 已验安全）·比串行快一个量级
  for (let i = 0; i < seed; i += BATCH) {
    const size = Math.min(BATCH, seed - i)
    await Promise.all(
      Array.from({ length: size }, () =>
        db.collection(COL).add({ kind: 'order', status: 'paid', amount: 1, _loadtest: true })
      )
    )
  }
  const t0 = Date.now()
  const cnt = await db.collection(COL).where({ kind: 'order' }).count()
  const agg = await db
    .collection(COL)
    .aggregate()
    .match({ kind: 'order', status: 'paid' })
    .group({ _id: null, gmv: $sum(db) })
    .end()
  const ms = Date.now() - t0
  const list = agg.data || agg.list || []
  const gmv = list[0] ? list[0].gmv : 0
  console.log(`  count=${cnt.total}（期望 ${seed}）· aggregate gmv=${gmv}（期望 ${seed}）· 耗时 ${ms}ms`)
  if (cnt.total === seed && gmv === seed) console.log('  ✅ 破千仍精确（count/aggregate 不受 1000 封顶·验 #18/#18续）')
  else console.log('  ❌ 不精确——破千被封顶/漏算？')
  console.log('  清理种子…')
  await db.collection(COL).where({ _loadtest: true }).remove().catch(() => {})
}

function $sum(db) {
  return db.command.aggregate.sum('$amount')
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.env) usage('缺 --env <测试envId>')
  if (a.env === PROD_ENV) usage('拒绝：--env 是生产环境，压测只打独立测试环境')
  const db = await getDb(a.env)
  // CloudBase 不像 MongoDB 写时自动建集合——写不存在的集合即 ResourceNotFound；先确保测试集合在（已存在则忽略）
  await db.createCollection(COL).catch(() => {})
  if (a.mode === 'cas') await runCas(db, Number(a.n) || 200)
  else if (a.mode === 'capacity') await runCapacity(db, Number(a.seed) || 2000)
  else usage('--mode 须为 cas 或 capacity')
}

// 只在直接执行（node scripts/loadtest.mjs …）时跑；被 vitest import 时不触发 main
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('压测出错：', (e && e.message) || e)
    process.exit(1)
  })
}
