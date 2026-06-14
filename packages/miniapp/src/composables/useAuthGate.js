/**
 * 登录软门槛（规格 §四-1）。属页面编排（读登录态 + 弹登录），放 composables 不放 utils
 * （CLAUDE §7「utils 不依赖 store」+ T4 依赖方向）。进「我」/ 下单 / 继续学习等需身份处调用。
 *
 * 登录是<半屏弹窗>（components/LoginSheet.vue，不跳页——小程序页面盖不住上一页）。
 * ensureLogin()：已登录 → 放行返回 true；未登录 → 打开登录弹窗并返回 false，调用方据此中止本次动作。
 * 浏览类页面（首页 / 详情 / 购物车）不调用——可先逛后登录，不强制启动前置授权（合微信规范）。
 *
 * loginSheetVisible 是模块级单例（Vue ref），各页 <LoginSheet/> 与本闸共享同一开关。
 */
import { ref } from 'vue'
import { useUserStore } from '@/store/user.js'

export const loginSheetVisible = ref(false)

export function ensureLogin() {
  if (useUserStore().isLogin) return true
  loginSheetVisible.value = true
  return false
}
