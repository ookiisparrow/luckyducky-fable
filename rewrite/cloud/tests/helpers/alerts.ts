// 捕获 fn 执行期间每次 console.error 的首参（告警行 [LD_ALERT] 走 console.error），结束后还原 console.error。
export function captureAlerts(fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  return Promise.resolve(fn())
    .then(() => seen)
    .finally(() => {
      console.error = orig
    })
}
