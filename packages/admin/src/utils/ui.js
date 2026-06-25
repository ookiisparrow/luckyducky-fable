import { reactive } from 'vue'

// 统一操作反馈（替原生 alert/confirm·全站一致·非阻塞）。由 <FeedbackHost> 渲染、App.vue 挂一次。
//  · toast(msg, type)：右上角淡出提示。type ∈ 'ok'|'err'|'info'。
//  · confirmDialog(opts)：样式化确认弹窗，返回 Promise<boolean>（确定=true / 取消=false）。
//    用法：if (!(await confirmDialog({ message, danger:true }))) return

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
  prompt: false, // true=输入框模式（替原生 prompt）
  inputValue: '',
  placeholder: '',
  _resolve: null,
})
export function confirmDialog({ title = '确认操作', message = '', confirmText = '确定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    Object.assign(confirmState, { open: true, title, message, confirmText, cancelText, danger, prompt: false, _resolve: resolve })
  })
}
// 输入弹窗（替原生 prompt）：返回 Promise<string|null>（确定=输入值 / 取消=null）
export function promptDialog({ title = '输入', message = '', defaultValue = '', placeholder = '', confirmText = '确定' } = {}) {
  return new Promise((resolve) => {
    Object.assign(confirmState, {
      open: true,
      title,
      message,
      confirmText,
      cancelText: '取消',
      danger: false,
      prompt: true,
      inputValue: String(defaultValue ?? ''),
      placeholder,
      _resolve: resolve,
    })
  })
}
export function resolveConfirm(ok) {
  const r = confirmState._resolve
  const isPrompt = confirmState.prompt
  const val = confirmState.inputValue
  confirmState.open = false
  confirmState.prompt = false
  confirmState._resolve = null
  if (r) r(isPrompt ? (ok ? val : null) : !!ok)
}
