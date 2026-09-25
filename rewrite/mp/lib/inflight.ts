/** 在途去重：同 key 并发共享同一只 promise，只真取一次；结算（成败都）即清键——不缓存 rejection，失败下次可重试。 */
export function createInflight<V>() {
  const m = new Map<string, Promise<V>>()
  return {
    run(key: string, fn: () => Promise<V>): Promise<V> {
      const going = m.get(key)
      if (going) return going
      const p = (async () => {
        try {
          return await fn()
        } finally {
          m.delete(key)
        }
      })()
      m.set(key, p)
      return p
    },
    clear: () => m.clear(),
  }
}
