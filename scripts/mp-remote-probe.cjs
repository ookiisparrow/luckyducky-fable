/**
 * mp 真机自动化首验探针（2026-07-25·用户拍板「三个都装」B 项·打「真机走查靠人」痛点的官方路径）。
 *
 * 干什么：走真机调试通道（Tool.enableRemoteDebug）——冷启动 devtools → 触发弹码（发后即忘，
 * 该 RPC 在 Nightly 下必 10s 超时但 GUI 流程照走）→ 用户真机扫码 → 等上线（事件+platform 双信号）
 * → 真机跑八项断言，产出「真机侧能力覆盖报告」。
 *
 * ⚠️ 首验结论（2026-07-25 凌晨·Nightly 2.02.2607242·OPPO-PLP110 实测·勿在同版本重复排查）：
 * 真机扫码连接成功（GUI 面板服务正常/数据流动/Wxml 可见真机页面树），但 automator ws 通道的
 * 全部 RPC（systemInfo/pageStack/reLaunch/evaluate/page.data/element/screenshot）路由不到真机
 * 会话——8/8 一律 10s 超时（工具侧硬限）。官方库自带 remote() 在此版本更是第一步就死（它 await
 * enableRemoteDebug 回包=必超时抛错）。定性：该 Nightly 的 automation-真机桥断路，GUI 人肉真机
 * 调试不受影响。复验条件：工具更新版本后重跑本脚本，0/8 变绿即通。
 *
 * 用法：node scripts/mp-remote-probe.cjs（扫码窗口 600s）
 * 前置：同 mp-smoke.cjs（worktree 须拷 project.config.json）；真机与电脑同微信账号。
 * 工程纪律（实战教训三条已内建）：① 触发 RPC 发后即忘——await 它=必死；② 全部 race 超时配
 * process unhandledRejection 兜底——孤儿拒绝崩过一次进程（把已连上的真机会话拖断）；③ 断言
 * 失败自动重试一次——真机链路首次调用慢是常态。
 */

const automator = require('miniprogram-automator')
require('miniprogram-automator/out/MiniProgram').default.prototype.checkVersion = async function () {}
const fs = require('fs')
process.on('unhandledRejection', (e) => console.log('[孤儿拒绝·已兜住]', String((e && e.message) || e).slice(0, 90)))

const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const path = require('path')
const MP_ROOT = path.join(__dirname, '..', 'rewrite/mp')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const to = (ms, msg) => new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))

async function probe(tag, fn, report) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now()
    try {
      const detail = await Promise.race([fn(), to(30000, '30s 超时')])
      report.push({ tag, ok: true, ms: Date.now() - t0, detail: String(detail).slice(0, 140) })
      console.log(`PASS  ${tag} (${Date.now() - t0}ms)${attempt > 1 ? '（重试后过）' : ''} ${String(detail).slice(0, 120)}`)
      return
    } catch (e) {
      if (attempt === 2) {
        report.push({ tag, ok: false, ms: Date.now() - t0, detail: e.message.slice(0, 140) })
        console.log(`FAIL  ${tag} (${Date.now() - t0}ms·已重试) ${e.message.slice(0, 120)}`)
      } else {
        console.log(`……${tag} 首次未过（${e.message.slice(0, 60)}），3s 后重试`)
        await sleep(3000)
      }
    }
  }
}

async function main() {
  console.log('冷启动 devtools（launch）…')
  const mp = await automator.launch({ cliPath: CLI, projectPath: MP_ROOT, timeout: 120000 })
  console.log('launch 完成，验证模拟器就绪…')
  await Promise.race([mp.reLaunch('/pages/home/home'), to(30000, '模拟器未就绪')])
  console.log('模拟器就绪。触发真机调试（发后即忘·RPC 超时属预期，GUI 自会出二维码）…')

  mp.send('Tool.enableRemoteDebug', { auto: false }).then(
    (r) => {
      if (r && r.qrCode) {
        try {
          fs.writeFileSync('/tmp/ld-remote-qr.png', Buffer.from(String(r.qrCode).replace(/^data:image\/\w+;base64,/, ''), 'base64'))
          console.log('[意外之喜] RPC 回了 qrCode，已存 /tmp/ld-remote-qr.png')
        } catch {
          /* 忽略 */
        }
      }
    },
    (e) => console.log(`[预期内] enableRemoteDebug RPC：${e.message}（GUI 流程不受影响）`)
  )

  console.log('>>> 请扫开发者工具窗口里「真机调试」面板的二维码 <<<')
  console.log('等待真机上线（最长 600s·事件或 platform 翻转双信号）…')
  let connected = false
  mp.connection.once('Tool.onRemoteDebugConnected', () => {
    connected = true
    console.log('[事件] Tool.onRemoteDebugConnected')
  })
  const t0 = Date.now()
  while (!connected && Date.now() - t0 < 600000) {
    await sleep(3000)
    try {
      const info = await Promise.race([mp.systemInfo(), to(8000, 'x')])
      const plat = (info && info.platform) || '?'
      if (plat && plat !== 'devtools') {
        connected = true
        console.log(`[轮询] platform=${plat} ——真机已接管`)
      }
    } catch {
      /* 切换窗口期瞬断，继续 */
    }
  }
  if (!connected) {
    console.log('600s 未见真机上线，退出')
    process.exit(2)
  }
  await sleep(3000)
  console.log('真机已连接，八项断言开跑…')

  const report = []
  const consoleLog = []
  mp.on('console', (e) => consoleLog.push(e))

  await probe('systemInfo（platform/机型）', async () => {
    const i = await mp.systemInfo()
    return `platform=${i.platform} model=${i.model || '?'} system=${i.system || '?'}`
  }, report)
  await probe('pageStack 读栈', async () => {
    const st = await mp.pageStack()
    return '栈:' + st.map((p) => p.path).join('->')
  }, report)
  await probe('reLaunch 导航 about', async () => {
    await mp.reLaunch('/pages/about/about')
    await sleep(2500)
    const cur = await mp.currentPage()
    return 'currentPage=' + (cur ? cur.path : '(空)')
  }, report)
  await probe('evaluate 探针读清', async () => {
    const r = await mp.evaluate(() => {
      const arr = globalThis.__ldSmokeErrors || []
      const copy = arr.slice()
      globalThis.__ldSmokeErrors = []
      return { n: copy.length, g: typeof globalThis }
    })
    return JSON.stringify(r)
  }, report)
  await probe('page.data 读取', async () => {
    const page = await mp.currentPage()
    const d = await page.data()
    return 'keys=' + Object.keys(d || {}).slice(0, 8).join(',')
  }, report)
  await probe('element 查询', async () => {
    const page = await mp.currentPage()
    const el = await page.$('view')
    return el ? 'view 命中' : 'view 未命中'
  }, report)
  await probe('screenshot（真机支持性·重点）', async () => {
    await mp.screenshot({ path: '/tmp/ld-remote-shot.png' })
    return `落盘 ${fs.existsSync('/tmp/ld-remote-shot.png') ? fs.statSync('/tmp/ld-remote-shot.png').size : 0} 字节`
  }, report)
  await probe('回 home 还原', async () => {
    await mp.reLaunch('/pages/home/home')
    await sleep(2000)
    const cur = await mp.currentPage()
    return 'currentPage=' + (cur ? cur.path : '(空)')
  }, report)

  console.log('\n===== 真机能力覆盖报告 =====')
  for (const r of report) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.tag}  (${r.ms}ms)  ${r.detail}`)
  console.log(`console 事件 ${consoleLog.length} 条 | 通过 ${report.filter((r) => r.ok).length}/${report.length}`)
  mp.disconnect()
  process.exit(0)
}

main().catch((e) => {
  console.error('真机首验中止：', e.message)
  process.exit(1)
})
