import type { App } from 'vue'

// 坐席台前端错误上报（批 B7·治病根#14 client-error 通道 web 半边·与 admin 版同构：不建跨包共享模块——
// agent package.json 不依赖 @ldrw/shared 也不依赖 admin，两包各自独立部署，同构副本沿用本仓既有先例即
// rewrite/agent/src/api/client.ts 对 admin client.ts 的「同构小副本」写法，见其文件头注。两文件各 ~60 行，
// Rule of Three 未到，不值得为此新开一个 rewrite/web-shared 包）。行为细节见 admin 版 lib/errorReporter.ts
// 头注：三件套捕获 → 打 adminApi `reportClientError` action → 落 anomalies 账本，会话内去重+封顶 MAX_REPORTS=20。
// 与 admin 版唯一差异：source 写死 'agent'。

export interface ReportableClient {
  hasSession(): boolean
  post(action: string, data?: Record<string, unknown>): Promise<unknown>
}

// 会话内客户端封顶：与服务端 reportClientError 的 throttleHit max 同取 20——两层防御没必要各自发明新魔数。
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
    cli.post('reportClientError', { msg: text, source: 'agent', page }).catch(() => {}) // .catch 兜底：网络失败不再变成新的 unhandledrejection
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
