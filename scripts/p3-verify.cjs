/**
 * P3 激活闭环 · 端到端验证（开发者工具 + 真实 openid）。
 * 用法：node scripts/p3-verify.cjs <激活码>
 * 前置：工具已用 `cli auto --auto-port 9420` 起好（见 visual-check.cjs 头注）。
 * 步骤：activateCourse(新码) → confirmEnter → getMyCourses 含该课 →
 *       重扫同码 = mine → 目录页章节可见（无锁卡）→ 播放页可进（鉴权通过）。
 * 注意：CODE_TAKEN（他人扫已激活码）需第二个微信账号，工具端无法模拟，真机验收覆盖。
 */
const automator = require('miniprogram-automator')

const code = process.argv[2]
if (!code) {
  console.error('用法：node scripts/p3-verify.cjs <激活码>')
  process.exit(1)
}

// 在小程序 App 上下文调云函数（evaluate 不支持直接返回 promise，轮询取结果）
async function callFn(mp, name, data) {
  await mp.evaluate(
    (name, data) => {
      globalThis.__p3 = null
      wx.cloud
        .callFunction({ name, data })
        .then((r) => (globalThis.__p3 = { done: true, result: r.result }))
        .catch((e) => (globalThis.__p3 = { done: true, error: String(e) }))
    },
    name,
    data,
  )
  for (let i = 0; i < 40; i++) {
    const r = await mp.evaluate(() => globalThis.__p3)
    if (r && r.done) {
      if (r.error) throw new Error(`${name} 调用失败：${r.error}`)
      return r.result
    }
    await new Promise((s) => setTimeout(s, 250))
  }
  throw new Error(`${name} 10s 无响应`)
}

const assert = (cond, msg) => {
  if (!cond) throw new Error('断言失败：' + msg)
  console.log('  ✓ ' + msg)
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
  await mp.systemInfo() // RPC 探活（见 visual-check 注释）

  console.log('— 云函数链路（真实 openid）')
  const a1 = await callFn(mp, 'activateCourse', { code })
  assert(a1.ok && a1.state === 'activated', `首扫激活成功 state=activated（${JSON.stringify(a1)}）`)

  const c1 = await callFn(mp, 'confirmEnter', { code })
  assert(c1.ok && c1.enteredAt > 0, `确认成功 enteredAt=${c1.enteredAt} revoked=${JSON.stringify(c1.revoked)}`)

  const m1 = await callFn(mp, 'getMyCourses', {})
  assert(
    m1.ok && m1.list.some((x) => x.courseId === a1.courseId),
    `getMyCourses 含已解锁课程 ${a1.courseId}`,
  )

  const a2 = await callFn(mp, 'activateCourse', { code })
  assert(a2.ok && a2.state === 'mine', '重扫同码 → mine（继续学习）')

  const bad = await callFn(mp, 'activateCourse', { code: 'LDNOTEXIST00' })
  assert(bad.ok === false && bad.error === 'INVALID_CODE', '无效码 → INVALID_CODE')

  console.log('— 页面权限')
  await mp.reLaunch('/pages/catalog/index')
  await new Promise((s) => setTimeout(s, 2500))
  let page = await mp.currentPage()
  const lock = await page.$('.vc-lock')
  const chap = await page.$('.vc-chapter')
  assert(!lock && chap, '目录页已解锁：章节可见、无锁卡')

  await mp.reLaunch('/pages/player/index?id=l3')
  await new Promise((s) => setTimeout(s, 2500))
  page = await mp.currentPage()
  assert(page.path === 'pages/player/index', '播放页鉴权通过（未被弹回目录）')
  const bar = await page.$('.vp-topbar')
  assert(!!bar, '播放页控件渲染正常')

  console.log('\n全部通过 ✓')
  await mp.disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('\n✗ ' + e.message)
  process.exit(1)
})
