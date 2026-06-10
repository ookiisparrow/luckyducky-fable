/**
 * 沉浸页顶部按钮 vs 微信胶囊 · 自动化视觉验证（可复用，改 PAGES 即可验证其他页面）。
 * 用法：npm i --no-save miniprogram-automator && node scripts/visual-check.cjs
 * 前置：微信开发者工具已登录，且 设置→安全设置→服务端口 已开启；
 *       先用工具打开过 dist/build/mp-weixin 项目（或留给 launch 冷启动，较慢且偶发握手挂死）。
 * 产出：/tmp/ld-visual/*.png 截图 + 终端里的矩形对比报告（撞胶囊/撞状态栏即 FAIL）。
 */
const automator = require('miniprogram-automator')
const fs = require('fs')

const OUT = '/tmp/ld-visual'
const PAGES = [
  { name: 'detail', route: '/pages/detail/index?id=p1', sels: ['.pdp-float .pdp-float-btn'] },
  { name: 'catalog', route: '/pages/catalog/index', sels: ['.vc-back', '.vc-fav'] },
  { name: 'welcome', route: '/pages/welcome/index', sels: ['.wel-close'] },
  { name: 'player', route: '/pages/player/index?id=l3', sels: ['.vp-topbar .vp-icbtn'] },
]

const overlap = (a, b) =>
  !(a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top)

// launch 的握手 promise 在本机偶发不回包（连接 ESTABLISHED 但初始化无响应），
// 所以优先 connect 已起的实例，连不上才走 launch 冷启动。
// 注意：connect 成功 ≠ RPC 可用——中途用 cli open 重开过项目会把 9420 留成僵尸端口
// （握手能成、RPC 永不回包），所以 connect 后必须先探活；卡死的解法是
// `cli quit` 彻底退出工具后 `cli auto --project <dist> --auto-port 9420` 重启。
async function getMp() {
  try {
    const mp = await Promise.race([
      automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('connect 5s 超时')), 5000)),
    ])
    // RPC 探活：5s 无响应按僵尸端口处理（见上方注释）
    await Promise.race([
      mp.systemInfo(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('RPC 探活 5s 无响应，工具需 cli quit 后 cli auto 重启')), 5000),
      ),
    ])
    console.log('已连上现成实例（connect）')
    return mp
  } catch (e) {
    console.log(`connect 不可用（${e.message}），改用 automator.launch 冷启动…`)
    return automator.launch({
      cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
      projectPath: __dirname + '/../dist/build/mp-weixin',
      timeout: 120000,
    })
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const mp = await getMp()

  const sys = await mp.systemInfo()
  // 不用 callWxMethod：同步 API 在本机 devtools 上挂死不回包，evaluate 正常
  const cap = await mp.evaluate(() => wx.getMenuButtonBoundingClientRect())
  console.log(`statusBarHeight=${sys.statusBarHeight}  胶囊=`, cap)

  let fails = 0
  for (const p of PAGES) {
    const page = await mp.reLaunch(p.route)
    await page.waitFor(1200)
    console.log(`\n— ${p.name} (${p.route})`)
    for (const sel of p.sels) {
      const els = await page.$$(sel)
      if (!els.length) {
        console.log(`  ✗ 没找到 ${sel}`)
        fails++
        continue
      }
      for (let i = 0; i < els.length; i++) {
        const off = await els[i].offset()
        const size = await els[i].size()
        const r = {
          left: off.left,
          top: off.top,
          right: off.left + size.width,
          bottom: off.top + size.height,
        }
        const cy = (r.top + r.bottom) / 2
        const capCy = (cap.top + cap.bottom) / 2
        const hitCapsule = overlap(r, cap)
        const hitStatus = r.top < sys.statusBarHeight - 0.5
        const centered = Math.abs(cy - capCy) <= 3
        const ok = !hitCapsule && !hitStatus
        if (!ok) fails++
        console.log(
          `  ${ok ? '✓' : '✗'} ${sel}[${i}] top=${r.top.toFixed(1)} right=${r.right.toFixed(1)}` +
            ` 中线差=${(cy - capCy).toFixed(1)}px` +
            (hitCapsule ? ' 【撞胶囊】' : '') +
            (hitStatus ? ' 【撞状态栏】' : '') +
            (centered ? ' 与胶囊同带居中' : '')
        )
      }
    }
    await mp.screenshot({ path: `${OUT}/${p.name}.png` })
    console.log(`  截图 → ${OUT}/${p.name}.png`)
  }

  console.log(`\n${fails === 0 ? '全部通过 ✓' : `FAIL ×${fails}`}`)
  // 用 disconnect 而非 close：close 会留下 9420 僵尸监听，且保留实例便于复跑/眼校
  await mp.disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('启动失败：', e.message)
  console.error('若提示端口/连接问题：开发者工具 → 设置 → 安全设置 → 开启「服务端口」后重跑。')
  process.exit(2)
})
