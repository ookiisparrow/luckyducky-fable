/**
 * 组件内一次性定时器（自动清理版）。
 * 背景：多页有 `setTimeout(back, …)` 这类"toast 后延迟返回"，组件提前卸载时
 * 回调仍会执行（审核 v0.1 P3 #10）。统一改用本组合式：onUnmounted 自动清掉未触发的。
 *
 * 用法（setup 内）：
 *   const { later } = useTimers()
 *   later(back, 300)
 * 返回的 id 仍可手动 clearTimeout（如"新 toast 顶掉旧 toast"的场景）。
 */
import { onUnmounted } from 'vue'

export function useTimers() {
  const ids = new Set()

  function later(fn, ms) {
    const id = setTimeout(() => {
      ids.delete(id)
      fn()
    }, ms)
    ids.add(id)
    return id
  }

  onUnmounted(() => {
    ids.forEach((id) => clearTimeout(id))
    ids.clear()
  })

  return { later }
}
