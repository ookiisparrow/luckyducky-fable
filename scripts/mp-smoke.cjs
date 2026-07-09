/**
 * rewrite/mp 运行时冒烟层（批次D·根因#8「构建过≠真机能用」的机器半边）。
 * 用法：npm run smoke:mp（miniprogram-automator 已登记为 devDependencies，无需 --no-save 手装）。
 * 前置：微信开发者工具已安装于默认路径 /Applications/wechatwebdevtools.app；
 *       工具「设置 → 安全设置 → 服务端口」需开启（否则 connect/launch 均失败，见下方报错提示）。
 * 工具实例有状态（CLAUDE.md 靠人:#10）：遇怪象（RPC 不回包/白屏/component not found）先
 * `cli quit` 彻底退出后再重启，不要在僵实例上跑——本脚本的探活步骤兜第一道。
 *
 * 抓什么：逐页开验「页面开得起来、无致命运行时错误」——handler 缺失（wxml 绑定引用不存在的方法，
 * 真机必报错、静态层抓不到）、组件未注册、路由级错误、未捕获异常/Promise 拒绝（经 app.ts 探针取证）。
 * 不是全量 UI/交互验证（那层仍是人工真机走查，见 rewrite/mp/README.md）。
 *
 * 不进 pre-commit/CI 三道闸（gate-single-source 单源＝npm run check；本脚本需真实 devtools 实例，
 * 机器闸对它无感，属靠人起环境的按需层，同 visual-check.cjs/p3-verify.cjs）。
 *
 * 容忍清单（明示于此，防误判为红——均不含下方致命模式字样，天然不会被抓）：
 * - 云调用失败态 / {ok:false} 空态渲染（无云数据/未登录环境下的正常降级 UI）
 * - cloud init / 网络类平台告警（devtools 环境常见噪音，非本层职责）
 * - checkout 场景外出现的 navigateBack:fail（checkout 场景内属两段式断言覆盖的设计行为）
 */
const automator = require('miniprogram-automator')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')
const MP_ROOT = path.join(REPO_ROOT, 'rewrite/mp')
const CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'

// 致命日志模式（区分大小写宽松匹配，逐条来自批次D规格·当前批固定清单）：
// handler 缺失（本层立层动机）/ 组件未注册 / 路由级错误 / 常见运行时异常类名。
const FATAL_PATTERNS = [
  'does not have a method',
  'Component is not found',
  'Page is not found',
  'not found',
  'TypeError',
  'ReferenceError',
]

const CHECKOUT_PATH = 'pages/checkout/checkout'
const HOME_PATH = 'pages/home/home'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function timeoutReject(ms, msg) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
}

// 照抄 scripts/visual-check.cjs 已验证过的坑：connect 成功 ≠ RPC 可用（僵尸端口），
// 所以 connect 后必须先 systemInfo() 探活；连不上/探活超时才 launch 冷启动。
async function connectMp() {
  try {
    const mp = await Promise.race([
      automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }),
      timeoutReject(5000, 'connect 5s 超时'),
    ])
    await Promise.race([
      mp.systemInfo(),
      timeoutReject(5000, 'RPC 探活 5s 无响应，工具需 cli quit 后重启（靠人:#10）'),
    ])
    console.log('已连上现成实例（connect）')
    return mp
  } catch (e) {
    console.log(`connect 不可用（${e.message}），改用 automator.launch 冷启动…`)
    return automator.launch({
      cliPath: CLI_PATH,
      projectPath: MP_ROOT,
      timeout: 120000,
    })
  }
}

function fatalHit(text) {
  const lower = text.toLowerCase()
  return FATAL_PATTERNS.find((p) => lower.includes(p.toLowerCase()))
}

// 读且清空（原子 evaluate，一次往返）：app.ts 探针数组封顶 50 条、超顶 shift() 淘汰旧条目——
// 若改用「只读不清 + 按上次长度切片求差集」，一旦累计错误数摸到封顶，长度不再增长，
// slice(before.length) 的差集算法即永久失明（后续新错误被淘汰旧条目顶掉、diff 算不出增量）。
// 每页开验前后各 drain 一次，天然规避这个坑：每次读到的都是「上次 drain 以来的新增」。
async function drainProbe(mp) {
  return (
    (await mp.evaluate(() => {
      const arr = globalThis.__ldSmokeErrors || []
      const copy = arr.slice()
      globalThis.__ldSmokeErrors = []
      return copy
    })) || []
  )
}

async function main() {
  const appJson = JSON.parse(fs.readFileSync(path.join(MP_ROOT, 'app.json'), 'utf8'))
  const pagePaths = appJson.pages // 页面清单以 app.json 运行时读取为准，不硬编码页面数
  if (!Array.isArray(pagePaths) || !pagePaths.length) {
    console.error('rewrite/mp/app.json 未解析到 pages 数组，冒烟无从跑')
    process.exit(2)
  }

  const mp = await connectMp()
  const consoleLog = []
  mp.on('console', (entry) => consoleLog.push(entry))

  await drainProbe(mp) // 清空启动阶段（onLaunch/registerPrivacyGate 等）可能残留的探针条目，建立干净基线
  let fails = 0
  const results = []

  for (const p of pagePaths) {
    const route = '/' + p
    const consoleStart = consoleLog.length
    let reasons = []

    if (p === CHECKOUT_PATH) {
      // checkout 特例：先 reLaunch 首页再 navigateTo checkout，两层栈让 600ms 空草稿自动
      // 返回（checkout.ts:35 backTimer）可成功执行——两段式断言：navigateTo 后即刻（<600ms
      // 内）栈顶=checkout，等待 2s 后栈顶=home。用 callWxMethod 直调而非 mp.navigateTo()
      // 高阶封装：后者内部固定 sleep(3000) 才返回，测不出「即刻」这一段。
      await mp.reLaunch('/' + HOME_PATH)
      await mp.callWxMethod('navigateTo', { url: route })
      const immediate = await mp.pageStack()
      const immediateTop = immediate[immediate.length - 1]
      if (!immediateTop || immediateTop.path !== CHECKOUT_PATH) {
        reasons.push(
          `navigateTo 后即刻栈顶=${immediateTop ? immediateTop.path : '(空)'}，期望 ${CHECKOUT_PATH}`
        )
      }
      await sleep(2000)
      const later = await mp.pageStack()
      const laterTop = later[later.length - 1]
      if (!laterTop || laterTop.path !== HOME_PATH) {
        reasons.push(`等待 2s 后栈顶=${laterTop ? laterTop.path : '(空)'}，期望自动返回 ${HOME_PATH}`)
      }
    } else {
      await mp.reLaunch(route) // tabBar 页也通吃（reLaunch 不受 navigateTo/redirectTo 的 tabBar 限制）
      const page = await mp.currentPage()
      if (page) await page.waitFor(2000) // 每页等待约 2s 稳定
      else await sleep(2000)
      const stack = await mp.pageStack()
      const top = stack[stack.length - 1]
      if (!top || top.path !== p) {
        reasons.push(`栈顶=${top ? top.path : '(空)'}，期望 ${p}`)
      }
    }

    // 断言②：探针数组无新增条目（drain 即取即清，天然是「本页新增」，无需再对旧长度做差集）
    const newProbeEntries = await drainProbe(mp)
    if (newProbeEntries.length) {
      reasons.push(`探针捕获 ${newProbeEntries.length} 条未捕获异常：${newProbeEntries.join(' | ')}`)
    }

    // 断言③：console 无致命类日志
    const slice = consoleLog.slice(consoleStart)
    for (const entry of slice) {
      const text = JSON.stringify(entry)
      const hit = fatalHit(text)
      if (hit) reasons.push(`console 命中致命模式「${hit}」：${text.slice(0, 300)}`)
    }

    const ok = reasons.length === 0
    if (!ok) fails++
    results.push({ path: p, ok, reasons })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${p}`)
    if (!ok) for (const r of reasons) console.log(`  ✗ ${r}`)
  }

  console.log(`\n共 ${pagePaths.length} 页，PASS ${pagePaths.length - fails} / FAIL ${fails}`)
  await mp.disconnect() // 用 disconnect 而非 close：close 会留 9420 僵尸监听
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('冒烟启动/执行失败：', e.message)
  console.error('若提示端口/连接问题：开发者工具 → 设置 → 安全设置 → 开启「服务端口」后重跑。')
  process.exit(2)
})
