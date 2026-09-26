// 云调用薄层（单源）：用户端一律 callFunction('app', {action, data})——聚合网关。
// 错误规整：网络/未部署/云端异常一律收成 { ok:false, error }，页面只看 ok（不散 try/catch）。
export interface ApiResult {
  ok: boolean
  error?: string
  [k: string]: unknown
}

// 客户端显式超时兜底（根因#14）：弱网下 wx.cloud.callFunction 何时回 fail 完全
// 由微信网络层决定（可能远超用户耐心），调用方的骨架屏/按钮 dim 会无限期挂着——超时即收敛成 ok:false，
// 让既有失败反馈路径（toast/重试入口）在可控时限内出现。参照 utils/brandFont.ts 对 downloadFile 显式设
// timeout 的既有先例。幂等性：写路径均有云端幂等保障（确定性 _id/orderIdempotency/transition），超时后
// 用户重试不产生双写；迟到的真实回包被 settled 标记丢弃。
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
      fail: () => done({ ok: false, error: 'CALL_FAIL' }), // 含 app 未部署（真机落空态）
    })
  })
}
