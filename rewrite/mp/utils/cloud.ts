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
// timeout 的既有先例。须长于 app 函数超时（以 cloudbaserc.json app.timeout 为准）：短于它，慢但仍在执行的写
// 会被先判失败、诱人重交。写路径靠云端幂等兜重交（确定性 _id/orderIdempotency/transition/反馈幂等键）；
// 迟到的真实回包被 settled 标记丢弃。
export const CALL_TIMEOUT_MS = 20_000

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
