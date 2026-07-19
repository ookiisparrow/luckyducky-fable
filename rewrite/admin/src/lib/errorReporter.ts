import type { App } from 'vue'

// 前端错误上报（批 B7·治病根#14 client-error 通道 web 半边）：window.onerror + unhandledrejection +
// Vue app.config.errorHandler 三件套捕获 → 打 adminApi `reportClientError` action → 落 kit/anomaly.ts
// 的 anomalies 账本（服务端 hashSig 避开 mp 侧 anomalyFingerprint 对非 ASCII 字符剥空可能导致的中文报错
// 坍缩坑，见 rewrite/cloud/src/functions/adminApi/actions/ops.ts 头注）。会话内同指纹去重 + 封顶
// MAX_REPORTS=20（防错误风暴自激：上报本身失败又抛错、被自己的监听器再捕一次形成自激环）；无会话不外呼
// （不为上报开未鉴权口子）。agent 端 lib/errorReporter.ts 是本文件的同构小副本（两包各自独立部署，不新开
// 共享包——Rule of Three 未到，见该文件头注）。

export interface ReportableClient {
  hasSession(): boolean
  post(action: string, data?: Record<string, unknown>): Promise<unknown>
}

// 会话内客户端封顶：与服务端 reportClientError 的 throttleHit max 同取 20——两层防御没必要各自发明新魔数，
// 同一圆整值降认知负担（非精调结果）。
const MAX_REPORTS = 20
const seen = new Set<string>()
let sent = 0

function currentPage(): string {
  try {
    return typeof location !== 'undefined' ? location.pathname : ''
  } catch {
    return ''
  }
}

/** 上报一条前端错误（fail-soft：内部异常绝不外溢——不能让「报错本身报错」形成自激环）。 */
export function reportError(cli: ReportableClient, msg: unknown, page = currentPage()): void {
  try {
    if (!cli.hasSession()) return // 无会话不外呼——不为上报建未鉴权端点
    const text = String(msg).slice(0, 500)
    const fingerprint = text.slice(0, 200)
    if (seen.has(fingerprint)) return // 会话内同指纹去重：同一报错反复触发不刷屏
    if (sent >= MAX_REPORTS) return // 会话内封顶：防错误风暴把请求打爆
    seen.add(fingerprint)
    sent++
    cli.post('reportClientError', { msg: text, source: 'admin', page }).catch(() => {}) // .catch 兜底：网络失败不再变成新的 unhandledrejection
  } catch {
    /* fail-soft：上报器自身绝不抛错 */
  }
}

/** 装三件套：window.onerror + unhandledrejection + Vue errorHandler。接管 app.config.errorHandler 后
 *  必须自己重打 console，否则本地开发丢失 Vue 默认的错误可见性。 */
export function installErrorReporter(app: App, cli: ReportableClient): void {
  if (typeof window !== 'undefined') {
    window.onerror = (message) => {
      reportError(cli, message)
      return false // 保留浏览器默认控制台输出
    }
    window.addEventListener('unhandledrejection', (event) => {
      reportError(cli, event.reason)
    })
  }
  app.config.errorHandler = (err, _instance, info) => {
    reportError(cli, err)
    console.error(err, info) // 接管后必须自己重打 console，否则本地开发丢失 Vue 默认的错误可见性
  }
}
