// 后台状态反馈收口（组合式·治病根#14 admin 前端侧·守卫 rw-admin-load-status-golden）。
// 沿用本仓已验的「散落副作用抽组合式收口」范式（useTimers/useAutosave·根因账本#14 留档）。
//
// 病根：各页把「动作反馈」与「后台 reload 的加载态」共用一条 message，动作 note 设完提示随即
//   `void reload()`，reload 成功时又无条件写 message → 把刚设的成功/失败原文抹掉（伪成功/吞反馈）。
// 收口不变量：note = 动作反馈（成功绿/失败红原文）；load = 后台加载态，**只在加载失败时写 message，
//   成功静默不 touch** ——动作反馈因此不被随后的成功 reload 顶掉。
import { ref } from 'vue'

export function useLoadStatus() {
  const message = ref('')
  const ok = ref(false) // 提示是成功(true·绿)还是失败(false·红)——模板 :class 双态

  // 动作反馈：成功显 okText(绿)、失败显 errText(红)。
  function note(isOk: boolean, okText: string, errText: string) {
    message.value = isOk ? okText : errText
    ok.value = isOk
  }

  // 后台加载态：失败才写错误；成功静默——不抹掉调用方刚设的动作反馈（病根#14 核心）。
  function load(loadOk: boolean, errText: string) {
    if (!loadOk) {
      message.value = errText
      ok.value = false
    }
  }

  return { message, ok, note, load }
}
