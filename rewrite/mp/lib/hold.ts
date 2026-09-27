// 按住确认单源（v5 危险操作＝浅色键 + 红字 + 长按·设计稿 data-hold/data-ms）：购物车删行、删地址、退出登录、删除资料共用。
// 按满 ms 才触发；松手太快（<400ms）走 onQuick 提示「按住…」；onChange 驱动键上的填充进度条（true＝开始填、false＝复位）。
export interface Hold {
  start(): void
  end(): void
  cancel(): void
}

const QUICK_MS = 400

export function createHold(ms: number, onFire: () => void, opts: { onQuick?: () => void; onChange?: (holding: boolean) => void } = {}): Hold {
  let timer: ReturnType<typeof setTimeout> | null = null
  let at = 0
  const cancel = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    opts.onChange?.(false)
  }
  return {
    start() {
      cancel()
      at = Date.now()
      opts.onChange?.(true)
      timer = setTimeout(() => {
        timer = null
        opts.onChange?.(false)
        onFire()
      }, ms)
    },
    end() {
      if (!timer) return
      const quick = Date.now() - at < QUICK_MS
      cancel()
      if (quick) opts.onQuick?.()
    },
    cancel,
  }
}
