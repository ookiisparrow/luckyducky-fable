<script>
// 应用根组件。生命周期钩子用 uni-app 的 onLaunch/onShow/onHide。
import logger from '@/utils/logger.js'
import { reportError } from '@/utils/report.js'
import { initCloud } from '@/utils/cloud.js'
import { useUserStore } from '@/store/user.js'
import { useProductsStore } from '@/store/products.js'
import { registerPrivacyGate } from '@/composables/usePrivacyGate.js'
import { BRAND_FONT_FAMILY, BRAND_FONTS } from '@/constants/brandFont.js'
import { SHARED_PKG_SENTINEL } from '@luckyducky/shared'

// 品牌字体远程加载（子集 WebFont·托管·不进包·守卫 font-not-in-package）：标题字 $font-display 首选
// WenYuan Rounded SC，到达前/失败时回退系统圆体（FOUT 可接受·失败不反噬启动）。
// ⚠ 绕 CORS（根因#8·2026-06-29 真机逮出）：mp 渲染层 origin=servicewechat.com，跨域字体须 CDN 发
// Access-Control-Allow-Origin，而静态托管 CDN 不发 → loadFontFace(网络URL) 渲染层 ERR_CACHE_MISS。
// 故 mp 端用 downloadFile（逻辑层·不受跨域限制·域名在 downloadFile 白名单）拉字体 → 读 base64 →
// loadFontFace(data URI·同源·无 CORS)。H5/App 无 getFileSystemManager，退回直接 loadFontFace(网络URL)
// （App 可用·H5 缺 CORS 则回退系统字·均不阻断）。
function loadBrandFonts() {
  // #ifdef MP-WEIXIN
  const fs = uni.getFileSystemManager()
  BRAND_FONTS.forEach(({ weight, url }) => {
    uni.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode !== 200) return logger.warn('font', weight, 'http', res.statusCode)
        fs.readFile({
          filePath: res.tempFilePath,
          encoding: 'base64',
          success: ({ data }) =>
            uni.loadFontFace({
              global: true,
              family: BRAND_FONT_FAMILY,
              source: `url("data:font/woff;base64,${data}")`,
              desc: { weight },
              fail: (e) => logger.warn('font', weight, 'face', e),
            }),
          fail: (e) => logger.warn('font', weight, 'read', e),
        })
      },
      fail: (e) => logger.warn('font', weight, 'dl', e),
    })
  })
  // #endif
  // #ifndef MP-WEIXIN
  BRAND_FONTS.forEach(({ weight, url }) =>
    uni.loadFontFace({
      global: true,
      family: BRAND_FONT_FAMILY,
      source: `url("${url}")`,
      desc: { weight },
      fail: (e) => logger.warn('font', weight, e),
    })
  )
  // #endif
}

export default {
  onLaunch() {
    // B0 哨兵：验证 workspace TS 包（@luckyducky/shared）被 uni 构建吃下；B3 起 shared 承载种子/常量后可删
    logger.info('shared', SHARED_PKG_SENTINEL)
    loadBrandFonts() // 品牌字体远程加载（mp 端 downloadFile→base64 绕 CORS·见函数注释·根因#8）
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
