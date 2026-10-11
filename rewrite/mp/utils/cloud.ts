// 云调用薄层（单源）：用户端一律 callFunction('app', {action, data})——聚合网关。
// 错误规整：网络/未部署/云端异常一律收成 { ok:false, error }，页面只看 ok（不散 try/catch）。
export interface ApiResult {
  ok: boolean
  error?: string
  [k: string]: unknown
}

// 弱网下 callFunction 何时回 fail 由微信决定、可能很久，页面会一直转圈——到点就收成 ok:false 走失败提示。
// 超时后云端可能其实成功了：写路径云端都幂等，用户重试不会双写；迟到的回包被 settled 丢弃。
const CALL_TIMEOUT_MS = 12_000

export function callApp(action: string, data: Record<string, unknown> = {}): Promise<ApiResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: ApiResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, error: 'CALL_TIMEOUT' }), CALL_TIMEOUT_MS)
    wx.cloud.callFunction({
      name: 'app',
      data: { action, data },
      success: (res) => {
        const r = res.result as ApiResult | undefined
        if (r && typeof r === 'object' && 'ok' in r) done(r)
        else done({ ok: false, error: 'BAD_RESULT' })
      },
      fail: () => done({ ok: false, error: 'CALL_FAIL' }), // 含 app 函数未部署
    })
  })
}
