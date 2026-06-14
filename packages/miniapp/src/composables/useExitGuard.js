/**
 * Tab 页「再按一次返回退出」拦截（仅小程序，配合模板里的 <scroll-view> + <page-container>）。
 *
 * 背景：自绘 TabBar 用 reLaunch 切页，Tab 页是栈底页 → 返回=退出小程序，易误退。
 * enableAlertBeforeUnload 拦不住栈底页退出；page-container 能拦返回手势/键，但武装时会锁「页面级滚动」。
 * 解法：页面内容套 <scroll-view>，滚动发生在 scroll-view 内部（page-container 锁不到），二者兼得。
 *
 * 机制：隐形 page-container（overlay=false）武装拦第一次返回 → 弹「再按一次退出」并解除武装，
 *   2s 内再返回则不拦、直接退出；2s 后重新武装。
 *
 * 用法（setup 内）：const { backGuard, onBackGuard } = useExitGuard()
 * 模板（仅 MP-WEIXIN，页面内容须在 <scroll-view> 里）：
 *   <page-container :show="backGuard" :overlay="false" :duration="0" @beforeleave="onBackGuard" />
 */
import { ref } from 'vue'
import { useTimers } from '@/composables/useTimers.js'

export function useExitGuard() {
  const { later } = useTimers()
  const backGuard = ref(true) // page-container show：true=武装拦第一次返回
  let rearmTimer = null
  function onBackGuard() {
    backGuard.value = false // 本次返回已被消费 → 2s 内再返回放行退出
    uni.showToast({ title: '再按一次退出', icon: 'none', duration: 2000 })
    clearTimeout(rearmTimer)
    rearmTimer = later(() => {
      backGuard.value = true // 2s 后重新武装
    }, 2000)
  }
  return { backGuard, onBackGuard }
}
