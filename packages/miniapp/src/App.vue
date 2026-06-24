<script>
// 应用根组件。生命周期钩子用 uni-app 的 onLaunch/onShow/onHide。
import logger from '@/utils/logger.js'
import { reportError } from '@/utils/report.js'
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
    // 全局错误兜底：应用级运行时错误 / 未捕获的 Promise 拒绝，不再静默。
    // 既本地分级日志（开发可见），又自动上报 events 通道（线上 bug 高发期主动收集·待办#23·运营钩子①）。
    uni.onError((err) => {
      logger.error('app', err)
      reportError('app', err)
    })
    uni.onUnhandledRejection((e) => {
      const reason = (e && e.reason) || e
      logger.error('promise', reason)
      reportError('promise', reason)
    })
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

/* —— 微动效（T-F5·克制版·纯 CSS·不引动画库；token 在 uni.scss）——
   全局工具类，元素加 class 即生效；只动 transform/opacity（合成层·mp 低端机不掉帧·根因#8）。
   已有 scoped transition/animation 的元素（如 ProductCard 根）在其 scoped 内合并，避免特异性冲突。 */
.ld-press {
  transition:
    transform $dur-press $ease-out,
    opacity $dur-press $ease-out;
}
.ld-press:active {
  transform: scale(0.97);
  opacity: 0.94;
}
/* 整宽行的点击态：只变淡不缩放（行缩放会露边显怪）——列表行/菜单行用 */
.ld-tap {
  transition: opacity $dur-press $ease-out;
}
.ld-tap:active {
  opacity: 0.6;
}
/* 列表项进场：淡入 + 轻微上移，一次性（both 保留终态）。短时长、无 stagger——避长列表逐项延迟掉帧。 */
@keyframes ld-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.ld-rise {
  animation: ld-rise $dur-rise $ease-out both;
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
