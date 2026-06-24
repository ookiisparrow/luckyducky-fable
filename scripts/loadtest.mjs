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
 *   ③ 频控端到端：复刻 throttle.ts bumpWindowed 并发路径（首写 add 撞号竞争 + 窗内 CAS 计数）→
 *      N 并发命中同 key 应恰 max 放行、无泄漏（验「频控只桩绿」那条·根因#13 并发面）。
 *
 * 前置：① 独立测试环境（非生产）② npm i -D @cloudbase/node-sdk ③ 本地 export
 *   TCB_SECRETID/TCB_SECRETKEY（经典 CAM 密钥·别进仓库/聊天）。
 * 用法：
 *   node scripts/loadtest.mjs --env <测试envId> --mode cas --n 200
 *   node scripts/loadtest.mjs --env <测试envId> --mode capacity --seed 2000
 *   node scripts/loadtest.mjs --env <测试envId> --mode throttle --n 20 --max 10
 * 安全闸：--env 等于生产 envId 直接退出。跑完自动清理 _loadtest 数据。
 */

import { fileURLToPath } from 'node:url'
import { PROD_ENV } from './lib/env.mjs' // 生产 env id 单源（病根#5·债#30①）·禁压
const COL = 'loadtest' // 专用集合·与业务集合隔离·跑完清空

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1]
  return a
}
function usage(msg) {
  if (msg) console.error('✗ ' + msg)
  console.error('用法：node scripts/loadtest.mjs --env <测试envId> --mode <cas|capacity|throttle|stock> [--n 200] [--seed 2000] [--max 10] [--stockN 10]')
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
export function readDoc(res) {
  const d = res && res.data
  return Array.isArray(d) ? d[0] : d
}
export function readV(res) {
  const doc = readDoc(res)
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

// ③ 频控端到端（债#19·根因#13/#8）：忠实复刻 throttle.ts 的 bumpWindowed 并发关键路径——
//    N 并发「命中」同一 key（大窗口、测试期不翻滚）：首写靠 add({_id}) 撞号即失败（恰一胜、其余
//    转 update）+ 窗内 CAS 自增 where({_id,旧窗,旧计数}).update。验真库下**恰 max 放行、无丢更新、
//    无泄漏**——allowed>max 即丢更新让超额请求漏过频控（这正是「频控只桩绿」要证伪的真风险）。
//    throttle.ts 逻辑本身已 throttleConcurrency.test.js 桩证；本跑补「真库对这套操作的并发行为」。
//    fails/锁定走同一 bumpWindowed 核（只差字段名+达阈动作），故验 hits 即验核。
async function runThrottle(db, n, max) {
  const id = 'throttle-probe'
  const COUNT = 'hits'
  const WINDOW = 'hitWindowStart'
  const windowMs = 600000 // 10min·测试期不翻滚（专测并发计数、非窗口翻滚）
  const _ = db.command
  await db.collection(COL).doc(id).remove().catch(() => {}) // 起点干净
  console.log(`频控 throttle：${n} 并发命中同一 key（max=${max}）·验恰 ${max} 放行 + 无丢更新 + 无泄漏…`)
  let allowed = 0
  let denied = 0
  let exhausted = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const now = Date.now()
        const rec = readDoc(await db.collection(COL).doc(id).get().catch(() => null))
        const within = !!rec && typeof rec[WINDOW] === 'number' && now - rec[WINDOW] < windowMs
        const count = (within ? rec[COUNT] || 0 : 0) + 1
        const patch = within ? { [COUNT]: count } : { [COUNT]: count, [WINDOW]: now }
        if (!rec) {
          // 首写：add({_id}) 撞号即失败 → 恰一胜，败者转 update 路径（throttle.ts:56-63 同范式）
          const r = await db.collection(COL).add({ _id: id, createdAt: now, ...patch }).catch(() => null)
          if (r && !r.code) {
            count > max ? denied++ : allowed++
            return
          }
          continue // 撞号/失败 → 重读转 update
        }
        const cond = { _id: id }
        if (within) {
          cond[WINDOW] = rec[WINDOW]
          cond[COUNT] = rec[COUNT] || 0
        } else {
          cond[WINDOW] = typeof rec[WINDOW] === 'number' ? rec[WINDOW] : _.exists(false)
        }
        const r = await db.collection(COL).where(cond).update(patch).catch(() => null)
        if (updatedCount(r) === 1) {
          count > max ? denied++ : allowed++
          return
        }
        // updated=0：并发抢先改过 → 重读重试
      }
      exhausted++
    })
  )
  const finalCount = (readDoc(await db.collection(COL).doc(id).get().catch(() => null)) || {})[COUNT] || 0
  console.log(`  放行 ${allowed}（期望 ${max}）· 拒 ${denied}· 最终 hits=${finalCount}（期望 ${n}）· 重试耗尽 ${exhausted}`)
  if (allowed === max && finalCount === n && exhausted === 0)
    console.log('  ✅ 真库频控并发安全：恰 max 放行·无丢更新·无泄漏（首写 add 撞号竞争 + 窗内 CAS 计数 都原子）')
  else if (allowed > max)
    console.log(`  ❌ 泄漏：放行 ${allowed} > max ${max}——丢更新让超额请求漏过频控！`)
  else console.log(`  ⚠️ 待查：allowed=${allowed}/finalCount=${finalCount}/exhausted=${exhausted}（贴回排查·限流或重试耗尽？）`)
  await db.collection(COL).doc(id).remove().catch(() => {})
}

// ④ 库存防超卖（库存#1·根因#1/#2/#8）：真库验 reserveStock 乐观 CAS——n 并发抢同 SKU、库存仅 stockN，
//    复刻 kit/inventory casDecrement（读 stock→where({_id,stock:旧}).update(stock-1)·撞改重试·stock<1 拒）。
//    应恰 stockN 扣成、余者缺货拒、最终 stock===0——扣成 > stockN 或 stock 穿底即超卖（丢更新让多扣）。
async function runStock(db, n, stockN) {
  const id = 'stock-probe'
  await db.collection(COL).doc(id).set({ stock: stockN, _loadtest: true })
  console.log(`库存防超卖：${n} 并发抢同 SKU（库存 ${stockN}）·验恰 ${stockN} 扣成 + 最终 stock=0 + 无超卖…`)
  let ok = 0
  let short = 0
  let exhausted = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (let i = 0; i < 30; i++) {
        const cur = readDoc(await db.collection(COL).doc(id).get().catch(() => null))
        const stock = cur && typeof cur.stock === 'number' ? cur.stock : 0
        if (stock < 1) {
          short++
          return
        }
        const r = await db.collection(COL).where({ _id: id, stock }).update({ stock: stock - 1 }).catch(() => null)
        if (updatedCount(r) === 1) {
          ok++
          return
        }
        // updated=0：并发抢先改过 → 重读重试
      }
      exhausted++
    })
  )
  const fin = readDoc(await db.collection(COL).doc(id).get().catch(() => null))
  const stockFin = fin && typeof fin.stock === 'number' ? fin.stock : -1
  console.log(`  扣成 ${ok}（期望 ${stockN}）· 拒(缺货) ${short}· 最终 stock=${stockFin}（期望 0）· 重试耗尽 ${exhausted}`)
  if (ok === stockN && stockFin === 0 && exhausted === 0)
    console.log('  ✅ 真库库存 CAS 无超卖：恰库存数扣成·余者缺货拒·stock 见底不穿底——下单预留防超卖成立（库存#1）')
  else if (ok > stockN || stockFin < 0)
    console.log(`  ❌ 超卖：扣成 ${ok} > 库存 ${stockN} 或 stock 穿底 ${stockFin}——丢更新让多扣穿底！`)
  else console.log(`  ⚠️ 待查：ok=${ok}/stock=${stockFin}/exhausted=${exhausted}（限流或重试耗尽？贴回排查）`)
  await db.collection(COL).doc(id).remove().catch(() => {})
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
  else if (a.mode === 'throttle') await runThrottle(db, Number(a.n) || 20, Number(a.max) || 10)
  else if (a.mode === 'stock') await runStock(db, Number(a.n) || 50, Number(a.stockN) || 10)
  else usage('--mode 须为 cas / capacity / throttle / stock')
}

// 只在直接执行（node scripts/loadtest.mjs …）时跑；被 vitest import 时不触发 main
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error('压测出错：', (e && e.message) || e)
    process.exit(1)
  })
}
