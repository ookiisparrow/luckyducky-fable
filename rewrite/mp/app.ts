// 重写线小程序（M2·原生 TS + glass-easel·默认 WebView·关键页按页开 Skyline——M0 spike 已真机验证）。
// 云环境与旧线同一个（数据零迁移·ADR §23）；M2 期间壳只初始化不调用，业务调用随页面批接 app 网关。
import { registerPrivacyGate } from './lib/privacyGate'
import { loadBrandFonts } from './utils/brandFont'

// 错误探针（批次D·守卫 mp-smoke-wired）：封顶数组挂 globalThis，冒烟脚本 evaluate 取证 + 真机排查线索（根因#14）。
const SMOKE_ERROR_CAP = 50
function pushSmokeError(msg: unknown) {
  const g = globalThis as unknown as { __ldSmokeErrors?: string[] }
  if (!g.__ldSmokeErrors) g.__ldSmokeErrors = []
  g.__ldSmokeErrors.push(String(msg))
  if (g.__ldSmokeErrors.length > SMOKE_ERROR_CAP) g.__ldSmokeErrors.shift()
}
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloudbase-d4gcssqbv06865479', traceUser: true })
    }
    registerPrivacyGate() // 隐私授权闸（R27㉒·配 privacy-sheet 弹窗·守卫 rw-mp-privacy-gated）
    loadBrandFonts() // 品牌字体远程加载（downloadFile→base64 绕 CORS·见函数注释·根因#8）
  },
  onError(err) {
    pushSmokeError(err)
  },
  onUnhandledRejection(res) {
    pushSmokeError(res && res.reason)
  },
})
