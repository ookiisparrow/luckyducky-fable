import { reactive } from 'vue'

// 统一操作反馈（替原生 alert/confirm·全站一致·非阻塞）。由 <FeedbackHost> 渲染、App.vue 挂一次。
// 与 admin/utils/ui.js 同形（坐席台复用同一反馈范式）。
//  · toast(msg, type)：右上角淡出提示。type ∈ 'ok'|'err'|'info'。
//  · confirmDialog(opts)：样式化确认弹窗，返回 Promise<boolean>（确定=true / 取消=false）。

export const toasts = reactive([])
let seq = 0
export function toast(message, type = 'ok', ms = 2800) {
  const t = { id: ++seq, message: String(message), type }
  toasts.push(t)
  setTimeout(() => dismissToast(t.id), ms)
  return t.id
}
export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}

export const confirmState = reactive({
  open: false,
  title: '确认操作',
  message: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  _resolve: null,
})
export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    Object.assign(confirmState, { open: true, title, message, confirmText, cancelText, danger, _resolve: resolve })
  })
}
export function resolveConfirm(ok) {
  const r = confirmState._resolve
  confirmState.open = false
  confirmState._resolve = null
  if (r) r(!!ok)
}
