// 重写线小程序（M2·原生 TS + glass-easel·默认 WebView·关键页按页开 Skyline——M0 spike 已真机验证）。
// 云环境与旧线同一个（数据零迁移·ADR §23）；M2 期间壳只初始化不调用，业务调用随页面批接 app 网关。
import { registerPrivacyGate } from './lib/privacyGate'
import { trackEvent } from './api/learning'
import { loadBrandFonts } from './utils/brandFont'
import { markLaunch } from './lib/coldStart'
import { checkForUpdate } from './utils/appUpdate'

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
// 报错带页面上下文（课程链路审计 2026-07-17）：原来 page 写死 'app'——不同页面的同前缀报错在 anomalies
// 里折成一条、无法反推发生在哪个业务页。取栈顶页面 route 填入；异常极早期（栈还没建）回退 'app'。
function currentPagePath(): string {
  try {
    const stack = getCurrentPages()
    const top = stack && stack[stack.length - 1]
    return (top && (top as { route?: string }).route) || 'app'
  } catch {
    return 'app'
  }
}
function reportClientError(msg: unknown) {
  if (clientErrorReportCount >= CLIENT_ERROR_REPORT_CAP) return
  clientErrorReportCount++
  trackEvent('client_error', currentPagePath(), '', { msg: String(msg).slice(0, 500) })
}
App({
  onLaunch() {
    markLaunch() // 冷启动计时起点（R41·配 lib/coldStart.reportColdStart 在 home 首帧 onReady 算 delta 上报）
    if (wx.cloud) {
      wx.cloud.init({ env: 'cloudbase-d4gcssqbv06865479', traceUser: true })
    }
    registerPrivacyGate() // 隐私授权闸（R27㉒·配 privacy-sheet 弹窗·守卫 rw-mp-privacy-gated）
    loadBrandFonts() // 品牌字体远程加载（downloadFile→base64 绕 CORS·见函数注释·根因#8）
    checkForUpdate() // 强制更新接线（R41·wx.getUpdateManager 三段式）
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
