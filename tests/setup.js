// 测试环境没有 uni 全局，这里 mock 掉用到的几个 API（内存版 storage）。
// 让 persist / systemBar 等依赖 uni 的逻辑能在 node 下跑测试。
const mem = new Map()

globalThis.uni = {
  getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
  setStorageSync: (k, v) => {
    mem.set(k, v)
  },
  removeStorageSync: (k) => {
    mem.delete(k)
  },
  getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 667 }),
}

// 暴露给测试：清空 / 注入 storage（模拟旧脏数据等场景）
globalThis.__mem = mem
