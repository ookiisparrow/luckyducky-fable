import { ref, watch, onBeforeUnmount } from 'vue'

/**
 * 控制台「编辑即防抖自动保存」的通用封装（原 StepVideos / StepCards 各抄一份，现收口）。
 *
 * 监听 source 深变化 → 防抖 delay → saveFn(深拷贝快照) → afterSave?(快照)；
 * saveState 状态机（'saving' | 'saved' | 'error'）供模板显示保存状态；
 * 离开页面时把还在防抖窗口内、尚未落盘的最后一次编辑立即补存（flush）——
 * 否则快速切步骤/退出会丢最后一次改动（见 调试日志 / 定向审核 B-2）。
 *
 * 注：Showcase 的「排序+首页文案」是两条保存路径共享一个 saveState（其一为命令式
 * 触发、非深监听），形状不同，未套用本封装（强行统一反而更绕）。
 *
 * @param {import('vue').Ref} source 监听的 ref（如 course / card），值为 null 时不触发
 * @param {(snapshot:any)=>Promise<boolean>} saveFn 保存函数，返回是否成功
 * @param {{delay?:number, ready?:()=>boolean, afterSave?:(snapshot:any)=>any}} [options]
 *   delay 防抖毫秒（默认 700）；ready 返回 false 时跳过（如加载中）；afterSave 保存成功后的副作用
 * @returns {{ saveState: import('vue').Ref<string> }}
 */
export function useAutosave(source, saveFn, { delay = 700, ready = () => true, afterSave } = {}) {
  const saveState = ref('') // '' | saving | saved | error
  let timer = null
  const snapshot = () => JSON.parse(JSON.stringify(source.value))

  watch(
    source,
    () => {
      if (source.value == null || !ready()) return
      saveState.value = 'saving'
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const snap = snapshot()
        const ok = await saveFn(snap)
        saveState.value = ok ? 'saved' : 'error'
        if (afterSave) await afterSave(snap)
      }, delay)
    },
    { deep: true },
  )

  onBeforeUnmount(() => {
    clearTimeout(timer)
    if (saveState.value === 'saving' && source.value != null) saveFn(snapshot())
  })

  return { saveState }
}
