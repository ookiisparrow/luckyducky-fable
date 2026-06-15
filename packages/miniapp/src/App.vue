<script>
// 应用根组件。生命周期钩子用 uni-app 的 onLaunch/onShow/onHide。
import logger from '@/utils/logger.js'
import { initCloud } from '@/utils/cloud.js'
import { useUserStore } from '@/store/user.js'
import { useProductsStore } from '@/store/products.js'
import { registerPrivacyGate } from '@/composables/usePrivacyGate.js'
import { SHARED_PKG_SENTINEL } from '@luckyducky/shared'

export default {
  onLaunch() {
    // B0 哨兵：验证 workspace TS 包（@luckyducky/shared）被 uni 构建吃下；B3 起 shared 承载种子/常量后可删
    logger.info('shared', SHARED_PKG_SENTINEL)
    initCloud() // 微信云开发初始化（仅小程序端生效；环境 ID 在 utils/cloud.js）
    registerPrivacyGate() // 挂微信隐私授权回调（onNeedPrivacyAuthorization，仅小程序端；R27㉒）
    useUserStore().login() // 静默登录:用 openid upsert users 建档（仅小程序端）
    useProductsStore().load() // 拉商品列表（小程序端走云函数；其它端回退本地 catalog）
    // 全局错误兜底：应用级运行时错误 / 未捕获的 Promise 拒绝，不再静默
    uni.onError((err) => logger.error('app', err))
    uni.onUnhandledRejection((e) => logger.error('promise', (e && e.reason) || e))
    // 以后可在此做：读取本地登录态、初始化全局配置等。
  },
  onShow() {},
  onHide() {},
}
</script>

<style lang="scss">
/* 全局公共样式。设计 token（颜色/圆角/间距/字号）集中在 uni.scss，
   会被自动注入到每个组件的 <style lang="scss"> 中，这里只放真正全局的基础样式。 */

page {
  background: $bg;
  color: $content;
  font-family: $font-cn;
  font-size: $fs-body;
  line-height: 1.5;
  /* 隐藏滚动条（与设计稿一致，内容区不显示滚动条） */
  -webkit-overflow-scrolling: touch;
}

/* 跨端通用：去掉部分元素默认外边距 */
view,
text,
image,
scroll-view {
  box-sizing: border-box;
}

/* 文本截断工具类（多端通用） */
.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
