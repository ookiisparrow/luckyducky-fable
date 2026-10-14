import type { Directive } from 'vue'

// 复刻小程序 hover-class：按下加类，松手后保留 100ms（hover-stay-time="100"）再撤。
export const press: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    const cls = binding.value
    if (!cls) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const down = () => {
      clearTimeout(timer)
      el.classList.add(cls)
    }
    const up = () => {
      clearTimeout(timer)
      timer = setTimeout(() => el.classList.remove(cls), 100)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', up)
    el.addEventListener('pointercancel', up)
  },
}
