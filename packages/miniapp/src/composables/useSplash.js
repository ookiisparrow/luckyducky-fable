/**
 * 启动开屏遮罩开关（模块级单例）。App 冷启动时为 true，首页 LoadingSplash 据此显示；
 * 静默登录 + 商品拉取完成（或超时兜底）后淡出置 false。模块态随 App 实例存活——
 * 返回首页不再现（已 false）；下次冷启动模块重建即恢复 true。只首页用，深链页（扫码进课）不挡。
 */
import { ref } from 'vue'

export const splashActive = ref(true)
