// 云调用薄层（M5 形态单源）：用户端一律 callFunction('app', {action, data})——新线聚合网关。
// 错误规整：网络/未部署/云端异常一律收成 { ok:false, error }，页面只看 ok（不散 try/catch）。
export interface ApiResult {
  ok: boolean
  error?: string
  [k: string]: unknown
}

// 调用取证探针（镜像 app.ts __ldSmokeErrors 范式·根因#14 可观测）：封顶数组挂 globalThis，
// 记录每次 callApp 的发起时刻——供冒烟脚本 / 今后性能巡逻核实「并行发起」而非「串行等待」，不改返回语义。
const CALL_LOG_CAP = 100
function pushCallLog(action: string) {
  const g = globalThis as unknown as { __ldCallLog?: { action: string; t: number }[] }
  if (!g.__ldCallLog) g.__ldCallLog = []
  g.__ldCallLog.push({ action, t: Date.now() })
  if (g.__ldCallLog.length > CALL_LOG_CAP) g.__ldCallLog.shift()
}

export function callApp(action: string, data: Record<string, unknown> = {}): Promise<ApiResult> {
  pushCallLog(action)
  return new Promise((resolve) => {
    wx.cloud.callFunction({
      name: 'app',
      data: { action, data },
      success: (res) => {
        const r = res.result as ApiResult | undefined
        if (r && typeof r === 'object' && 'ok' in r) resolve(r)
        else resolve({ ok: false, error: 'BAD_RESULT' })
      },
      fail: () => resolve({ ok: false, error: 'CALL_FAIL' }), // 含 app 未部署（并行期真机自然落空态）
    })
  })
}
