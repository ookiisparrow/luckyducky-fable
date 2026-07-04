// 云调用薄层（M5 形态单源）：用户端一律 callFunction('app', {action, data})——新线聚合网关。
// 错误规整：网络/未部署/云端异常一律收成 { ok:false, error }，页面只看 ok（不散 try/catch）。
export interface ApiResult {
  ok: boolean
  error?: string
  [k: string]: unknown
}

export function callApp(action: string, data: Record<string, unknown> = {}): Promise<ApiResult> {
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
