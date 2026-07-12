// 重写线小程序（M2·原生 TS + glass-easel·默认 WebView·关键页按页开 Skyline——M0 spike 已真机验证）。
// 云环境与旧线同一个（数据零迁移·ADR §23）；M2 期间壳只初始化不调用，业务调用随页面批接 app 网关。
import { registerPrivacyGate } from './lib/privacyGate'
import { trackEvent } from './api/learning'

// 错误探针（批次D·守卫 mp-smoke-wired）：封顶数组挂 globalThis，冒烟脚本 evaluate 取证 + 真机排查线索（根因#14）。
const SMOKE_ERROR_CAP = 50
function pushSmokeError(msg: unknown) {
  const g = globalThis as unknown as { __ldSmokeErrors?: string[] }
  if (!g.__ldSmokeErrors) g.__ldSmokeErrors = []
  g.__ldSmokeErrors.push(String(msg))
  if (g.__ldSmokeErrors.length > SMOKE_ERROR_CAP) g.__ldSmokeErrors.shift()
}
// 生产可观测半边（工业级完善批6·根因#14）：内存探针只有开发期冒烟能读到，真实用户设备上的全局崩溃
// 对服务端完全不可见——补 fire-and-forget 上报进 events 流水（trackEvent 自带 catch 不反噬）。会话内封顶
// 10 条防错误循环触发上报风暴（错误→上报→上报又抛错的自激回路）。
const CLIENT_ERROR_REPORT_CAP = 10
let clientErrorReportCount = 0
function reportClientError(msg: unknown) {
  if (clientErrorReportCount >= CLIENT_ERROR_REPORT_CAP) return
  clientErrorReportCount++
  trackEvent('client_error', 'app', '', { msg: String(msg).slice(0, 500) })
}
App({
  onLaunch() {
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloudbase-d4gcssqbv06865479', traceUser: true })
    }
    registerPrivacyGate() // 隐私授权闸（R27㉒·配 privacy-sheet 弹窗·守卫 rw-mp-privacy-gated）
  },
  onError(err) {
    pushSmokeError(err)
    reportClientError(err)
  },
  onUnhandledRejection(res) {
    pushSmokeError(res && res.reason)
    reportClientError(res && res.reason)
  },
})
