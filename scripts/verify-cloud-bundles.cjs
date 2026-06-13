/**
 * 回灌前本地验证：把 esbuild 产物（dist/<fn>/index.js）当真云函数 require 进来跑，
 * 用内存桩喂数据，断言行为保真——证明「TS → kit/shared 内联 → esbuild CJS → 真能加载并跑对」，
 * 把回灌（生产仓真部署）前的风险压到只剩「tcb 运行时」一项。
 *
 * 用法：npm run verify:cloud（先 build:cloud 产 dist）。B4 全量迁移亦复用本脚本。
 */
const { resolve } = require('node:path')
const ROOT = resolve(__dirname, '..')
const cloud = require(resolve(ROOT, 'node_modules/wx-server-sdk')) // 与产物 require 同一份内存桩
const { control } = cloud
const dist = (name) => require(resolve(ROOT, 'packages/cloud/dist', name, 'index.js'))

function assert(cond, msg) {
  if (!cond) {
    console.error('❌ 验证失败：' + msg)
    process.exit(1)
  }
}

;(async () => {
  // getProducts（catalog 只读）——回灌探针本体
  control.reset()
  control.seed('products', [
    { _id: 'p1', sort: 1 },
    { _id: 'p2', sort: 2 },
  ])
  const gp = await dist('getProducts').main()
  assert(gp.ok && gp.list.length === 2 && gp.list[0]._id === 'p1', 'getProducts 返回升序列表')

  // getMyOrders（openid 闸）——kit.withOpenId 内联是否生效
  control.reset()
  control.setOpenId('u1')
  control.seed('orders', [{ _id: 'o1', _openid: 'u1', createdAt: 1 }])
  const gmo = dist('getMyOrders')
  const r2 = await gmo.main({})
  assert(r2.ok && r2.list.length === 1, 'getMyOrders 返回本人订单')
  control.setOpenId('')
  assert((await gmo.main({})).error === 'NO_OPENID', 'getMyOrders fail-closed（无 openid 拒）')

  // payCallback（回调框架 + 条件流转）——kit.defineNotifyCallback + transition 内联是否生效
  control.reset()
  control.setOpenId('') // 工作流服务端无用户上下文
  control.seed('orders', [{ _id: 'x1', status: 'pending', amount: 5 }])
  const pc = dist('payCallback')
  const r3 = await pc.main({
    outTradeNo: 'x1',
    returnCode: 'SUCCESS',
    resultCode: 'SUCCESS',
    totalFee: 500,
    transactionId: 't1',
  })
  assert(r3.errcode === 0, 'payCallback 返回 ACK')
  assert(control.dump('orders')[0].status === 'paid', 'payCallback pending→paid 流转')
  control.setOpenId('attacker') // 客户端伪造
  await pc.main({ outTradeNo: 'x1', returnCode: 'SUCCESS', resultCode: 'SUCCESS', totalFee: 500 })
  // 防伪闸：已 paid，二次伪造调用不应再动（本就 paid，校验 transactionId 未被改写）
  assert(control.dump('orders')[0].transactionId === 't1', 'payCallback 防伪闸（伪造调用不改状态）')

  console.log('✅ 三个 esbuild 产物本地真跑全部正确（CJS 加载 + kit/shared 内联 + 行为保真）')
})().catch((e) => {
  console.error('❌', e && e.stack ? e.stack : e)
  process.exit(1)
})
