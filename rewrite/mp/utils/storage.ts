// 本地 storage 读写（叶层·零 import）：storage 会抛（配额满/档损坏），而调用方存的都只是缓存或提示、
// 真值在服务端或下次回灌——读失败回 null 交给各自的 sanitize 落默认，写失败静默不崩。
export function readStorage(key: string): unknown {
  try {
    return wx.getStorageSync(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, v: unknown): void {
  try {
    wx.setStorageSync(key, v)
  } catch {
    /* 见文件头：存不进不崩 */
  }
}
