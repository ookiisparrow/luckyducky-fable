// 后台状态反馈收口（组合式·治病根#14 admin 前端侧）。
//
// 病根：各页把「动作反馈」与「后台 reload 的加载态」共用一条 message，动作 note 设完提示随即
//   `void reload()`，reload 成功时又无条件写 message → 把刚设的成功/失败原文抹掉（伪成功/吞反馈）。
// 收口不变量：note = 动作反馈（成功绿/失败红原文）；load = 后台加载态，失败写错误，成功只收回
//   它自己上次写的那条错误——动作反馈因此不被随后的成功 reload 顶掉，重试成功也不留陈旧的失败横幅。
import { ref, type Ref } from 'vue'

export function useLoadStatus() {
  const message = ref('')
  const ok = ref(false) // 提示是成功(true·绿)还是失败(false·红)——模板 :class 双态
  // 当前 message 若是 load 写的加载错误即其原文。note 覆盖即作废（防动作失败恰与加载错误同文案时被误清）；
  // 页面直写 message 的提示与它文案不同，靠下面的相等判断保住。
  let loadErr = ''

  // 动作反馈：成功显 okText(绿)、失败显 errText(红)。
  function note(isOk: boolean, okText: string, errText: string) {
    message.value = isOk ? okText : errText
    ok.value = isOk
    loadErr = ''
  }

  function load(loadOk: boolean, errText: string) {
    if (loadOk) {
      if (loadErr && message.value === loadErr) message.value = ''
      loadErr = ''
      return
    }
    message.value = loadErr = errText
    ok.value = false
  }

  return { message, ok, note, load }
}

// 多路并行加载的分路报错：每路失败点名「X加载失败：原因」，按传入顺序用「；」连；全成功回 ''。
export const loadErrors = (parts: Array<[{ ok: boolean; error?: unknown }, string]>): string =>
  parts
    .filter(([r]) => !r.ok)
    .map(([r, name]) => `${name}加载失败：${String(r.error || '')}`)
    .join('；')

// 危险动作两步确认：第一次点只武装（armed 记下 key·按钮变确认态），同一 key 再点才放行并解除武装。
export function confirmed(armed: Ref<string>, key: string): boolean {
  if (armed.value !== key) {
    armed.value = key
    return false
  }
  armed.value = ''
  return true
}
