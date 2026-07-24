/**
 * mp 真机自动化首验探针（2026-07-25·用户拍板「三个都装」B 项·打「真机走查靠人」痛点的官方路径）。
 *
 * 干什么：走 miniprogram-automator 的真机调试通道（Tool.enableRemoteDebug）——弹二维码 → 用户
 * 真机微信扫码 → 后续 automator 断言在**真机**上执行。本脚本跑一遍最小断言集，产出「真机侧
 * 能力覆盖报告」：哪些断言原语（导航/页面栈/evaluate 探针/data 读取/截图）真机可用、哪些不行
 * ——官方文档对真机侧 API 覆盖面语焉不详（根因#8「拿到≠用通」），只有实测才算数。
 *
 * 用法：node scripts/mp-remote-probe.cjs
 *   二维码 PNG 落 /tmp/ld-remote-qr.png 并自动 open 弹出，等扫码最长 5 分钟。
 * 前置：同 mp-smoke.cjs（devtools 实例/服务端口/worktree 须拷 project.config.json）；
 *   真机与电脑同微信账号，小程序基础库 ≥2.7.3。
 * 边界：真机调试会话会接管 devtools 状态（靠人#10）——跑完若工具异常先 cli quit；
 *   本脚本只读+导航，不触发任何提交/支付类交互。
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// 同 mp-smoke.cjs 的 Nightly Tool.getInfo 形状变化猴补（2026-07-24 U 案）
require('miniprogram-automator/out/MiniProgram').default.prototype.checkVersion = async function () {}

const REPO_ROOT = path.join(__dirname, '..')
const MP_ROOT = path.join(REPO_ROOT, 'rewrite/mp')
const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const QR_PNG = '/tmp/ld-remote-qr.png'
const HOME_PATH = 'pages/home/home'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const timeoutReject = (ms, msg) => new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))

async function connectMp() {
  try {
    const mp = await Promise.race([
      automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }),
      timeoutReject(5000, 'connect 5s 超时'),
    ])
    await Promise.race([mp.systemInfo(), timeoutReject(5000, '信息道探活超时')])
    await Promise.race([mp.reLaunch('/' + HOME_PATH), timeoutReject(15000, '导航道探活超时（半僵态）')])
    console.log('已连上现成实例')
    return mp
  } catch (e) {
    console.log(`connect 不可用（${e.message}），cli quit 后冷启动…`)
    try {
      execSync(`"${CLI_PATH}" quit`, { stdio: 'ignore', timeout: 30000 })
    } catch {
      /* 无实例可退＝quit 报错，无妨 */
    }
    await sleep(5000)
    return automator.launch({ cliPath: CLI_PATH, projectPath: MP_ROOT, timeout: 120000 })
  }
}

// 每条断言独立 try/catch——报告要的就是「哪条行哪条不行」，一条失败不中止全局
async function probe(tag, fn, report) {
  const t0 = Date.now()
  try {
    const detail = await Promise.race([fn(), timeoutReject(20000, '20s 超时')])
    report.push({ tag, ok: true, ms: Date.now() - t0, detail: String(detail).slice(0, 120) })
    console.log(`✅ ${tag} (${Date.now() - t0}ms) ${String(detail).slice(0, 100)}`)
  } catch (e) {
    report.push({ tag, ok: false, ms: Date.now() - t0, detail: e.message.slice(0, 120) })
    console.log(`❌ ${tag} (${Date.now() - t0}ms) ${e.message.slice(0, 100)}`)
  }
}

async function main() {
  const mp = await connectMp()

  console.log('请求真机调试二维码（Tool.enableRemoteDebug）…')
  const { qrCode } = await Promise.race([
    mp.send('Tool.enableRemoteDebug', { auto: false }),
    timeoutReject(30000, 'enableRemoteDebug 30s 无响应'),
  ])
  if (!qrCode) throw new Error('未返回 qrCode——真机调试通道未开启')
  const b64 = String(qrCode).replace(/^data:image\/\w+;base64,/, '')
  fs.writeFileSync(QR_PNG, Buffer.from(b64, 'base64'))
  console.log(`二维码已存 ${QR_PNG}，自动弹出——请用真机微信扫码`)
  try {
    execSync(`open ${QR_PNG}`)
  } catch {
    /* open 失败不致命——用户可手动打开 PNG */
  }

  console.log('等待真机扫码连接（最长 300s）…')
  await Promise.race([
    new Promise((resolve) => mp.connection.once('Tool.onRemoteDebugConnected', resolve)),
    timeoutReject(300000, '300s 内未收到真机连接——用户未扫码或连接失败'),
  ])
  await sleep(3000) // 官方 remote() 收到事件后固定缓冲 1s，真机链路留足 3s
  console.log('🎉 真机已连接，开始最小断言集…')

  const report = []
  const consoleLog = []
  mp.on('console', (e) => consoleLog.push(e))

  await probe('systemInfo（platform 应为 ios/android 而非 devtools）', async () => {
    const info = await mp.systemInfo()
    return `platform=${info.platform} model=${info.model || '?'} version=${info.version || '?'}`
  }, report)
  await probe('pageStack 读栈', async () => {
    const st = await mp.pageStack()
    return '栈:' + st.map((p) => p.path).join('->')
  }, report)
  await probe('reLaunch 导航到 about', async () => {
    await mp.reLaunch('/pages/about/about')
    await sleep(2000)
    const cur = await mp.currentPage()
    return 'currentPage=' + (cur ? cur.path : '(空)')
  }, report)
  await probe('evaluate 探针读清（globalThis）', async () => {
    const r = await mp.evaluate(() => {
      const arr = globalThis.__ldSmokeErrors || []
      const copy = arr.slice()
      globalThis.__ldSmokeErrors = []
      return { n: copy.length, hasGlobal: typeof globalThis !== 'undefined' }
    })
    return JSON.stringify(r)
  }, report)
  await probe('page.data 读取', async () => {
    const page = await mp.currentPage()
    const d = await page.data()
    return 'data keys=' + Object.keys(d || {}).slice(0, 8).join(',')
  }, report)
  await probe('element 查询（about 页任意 view）', async () => {
    const page = await mp.currentPage()
    const el = await page.$('view')
    return el ? 'view 命中 tagName=' + (await el.tagName) : 'view 未命中'
  }, report)
  await probe('screenshot（官方文档未写真机是否支持·重点实测项）', async () => {
    const shot = '/tmp/ld-remote-shot.png'
    await mp.screenshot({ path: shot })
    const size = fs.existsSync(shot) ? fs.statSync(shot).size : 0
    return `落盘 ${size} 字节`
  }, report)
  await probe('回 home 还原', async () => {
    await mp.reLaunch('/' + HOME_PATH)
    await sleep(1500)
    const cur = await mp.currentPage()
    return 'currentPage=' + (cur ? cur.path : '(空)')
  }, report)

  console.log(`\n===== 真机能力覆盖报告 =====`)
  for (const r of report) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.tag}  (${r.ms}ms)  ${r.detail}`)
  console.log(`console 事件收到 ${consoleLog.length} 条`)
  console.log(`通过 ${report.filter((r) => r.ok).length}/${report.length}`)

  await mp.disconnect()
  process.exit(report.every((r) => r.ok) ? 0 : 1)
}

main().catch((e) => {
  console.error('真机首验中止：', e.message)
  process.exit(2)
})
