<script setup>
/**
 * 首页。对应原型「主版本/首页.html」的 home Tab。
 * 组合各区块组件，并实现：点「购买」滚动定位并高亮、点搜索滚到品牌介绍、
 * 加入弹 Toast、滚动过半显示回到顶部。
 */
import { ref, watch, getCurrentInstance, nextTick } from 'vue'

// 首页专用区块组件就近放在 ./components/（CLAUDE.md §9：页内自用组件归 pages/<page>/components/）
import Hero from './components/Hero.vue'
import BrandIntro from './components/BrandIntro.vue'
import FeatureProducts from './components/FeatureProducts.vue'
import TrustStrip from './components/TrustStrip.vue'
import Reassurance from './components/Reassurance.vue'
import Reviews from './components/Reviews.vue'
import FAQ from './components/FAQ.vue'
import ClosingCTA from './components/ClosingCTA.vue'
import SiteFooter from './components/SiteFooter.vue'
// 跨页共享的基础 UI 仍在 @/components/
import TabBar from '@/components/TabBar.vue'
import Toast from '@/components/Toast.vue'
import BackTop from '@/components/BackTop.vue'
import LoadingSplash from '@/components/LoadingSplash.vue'
import LoginSheet from '@/components/LoginSheet.vue'
import { useTimers } from '@/composables/useTimers.js'
import { splashActive } from '@/composables/useSplash.js'
import { loginSheetVisible } from '@/composables/useAuthGate.js'
import { useExitGuard } from '@/composables/useExitGuard.js'
import { goProductDetail } from '@/utils/nav.js'

// section 组件是纯展示（技术债 #4），数据在页面收口；将来换云端来源只改这里
import { useContentStore } from '@/store/content.js'
import { useProductsStore } from '@/store/products.js'
import { useCartStore } from '@/store/cart.js'
import { useUserStore } from '@/store/user.js'
import { getProduct } from '@/data/catalog.js'
import { REASSURE_ITEMS } from '@/data/reassure.js'
import { REVIEWS } from '@/data/reviews.js'

const { later } = useTimers()
// 首页内容（hero 文案/信任条/FAQ）：控制台橱窗可编辑，云端无记录回退本地默认
const content = useContentStore()
content.load()
// 启动开屏遮罩据 products.loaded 提前淡出（products.load 在 App.onLaunch 触发）
const products = useProductsStore()
const cart = useCartStore()
// 加载页淡出后：未登录则自动弹登录弹窗（仍可「暂不登录」关掉继续逛，软门槛不变）
const user = useUserStore()
watch(splashActive, (active) => {
  if (!active && !user.isLogin) loginSheetVisible.value = true
})
const instance = getCurrentInstance()
const windowHeight = uni.getSystemInfoSync().windowHeight
const featureRef = ref(null) // 商品区组件实例（购买按钮调它滚到商品卡）
// 返回拦截：第一次返回弹「再按一次退出」，2s 内再返回才真退出（配模板 scroll-view + page-container）
const { backGuard, onBackGuard } = useExitGuard()

// ---- 滚动状态（内容在 scroll-view 内滚）----
const scrollTop = ref(0) // scroll-view 当前滚动量（@scroll 更新）
const scrollTopProp = ref(0) // 受控滚动位置（回到顶部 / 定位用）
const showTop = ref(false)
function onScroll(e) {
  scrollTop.value = e.detail.scrollTop
  showTop.value = e.detail.scrollTop > windowHeight * 1.2
}
// 滚到目标：先同步当前真实位置、下一拍再设目标，绕过 scroll-view「相同值不触发」
function scrollViewTo(target) {
  scrollTopProp.value = scrollTop.value
  nextTick(() => {
    scrollTopProp.value = Math.max(0, target)
  })
}
function backToTop() {
  scrollViewTo(0)
}

// ---- Toast ----
const toast = ref({ show: false, text: '' })
let toastTimer = null
function ping(text) {
  clearTimeout(toastTimer) // 新 toast 顶掉旧 toast 的隐藏计时
  toast.value = { show: true, text }
  toastTimer = later(() => {
    toast.value.show = false
  }, 1600)
}

// ---- 滚动定位到某个页面锚点 ----
function scrollToAnchor(id, offset = 0) {
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select('#' + id)
    .boundingClientRect((rect) => {
      if (!rect) return
      scrollViewTo(scrollTop.value + rect.top - offset)
    })
    .exec()
}

// ---- 高亮某个产品卡（闪一下） ----
const flashId = ref('')
function flashProduct(id) {
  flashId.value = ''
  // 下一拍再赋值，确保动画能重新触发
  later(() => {
    flashId.value = id
    later(() => (flashId.value = ''), 1600)
  }, 30)
}

// ---- 事件处理 ----
function onHeroBuy() {
  featureRef.value?.scrollToProducts(scrollTop.value) // 滚到商品卡完全可见
  flashProduct('prod-2')
}
function onExplore() {
  scrollToAnchor('anchor-intro', 12)
}
function onProductOpen(p) {
  goProductDetail(p.id, p.name)
}
function onProductAdd(p) {
  // ＋ = 加入购物车。FeatureProducts 传上来的是展示形状（价为字符串），
  // 按 id 取 canonical 商品（store 云端 / catalog 回退）再加购，价格才是数字（病根#6 假反馈防回退）。
  const prod = products.getById(p.id) || getProduct(p.id)
  if (!prod) {
    ping('该商品暂时无法加入')
    return
  }
  cart.add({ id: prod.id, name: prod.name, tag: prod.tag, price: prod.price, was: prod.was })
  ping(`已加入购物车`)
}
function onClosingBuy() {
  ping('Get Ducky Get Lucky')
}
</script>

<template>
  <view class="ld-home">
    <scroll-view
      scroll-y
      :scroll-top="scrollTopProp"
      :scroll-with-animation="true"
      :show-scrollbar="false"
      class="ld-home-scroll"
      @scroll="onScroll"
    >
      <Hero
        :title="content.hero.title"
        :tagline="content.hero.tagline"
        @buy="onHeroBuy"
        @explore="onExplore"
      />

      <view id="anchor-intro">
        <BrandIntro />
      </view>

      <view id="anchor-products">
        <FeatureProducts
          ref="featureRef"
          :flash-id="flashId"
          @open="onProductOpen"
          @add="onProductAdd"
          @scrollto="scrollViewTo"
        />
      </view>

      <TrustStrip :items="content.trust" />
      <Reassurance :items="REASSURE_ITEMS" />
      <Reviews :reviews="REVIEWS" />
      <FAQ :items="content.faq" />
      <ClosingCTA @buy="onClosingBuy" />
      <SiteFooter />
    </scroll-view>

    <!-- 浮层 -->
    <BackTop v-if="showTop" @tap="backToTop" />
    <Toast :show="toast.show" :text="toast.text" />
    <TabBar active="home" />
    <LoginSheet />
    <LoadingSplash v-if="splashActive" :ready="products.loaded" />
    <!-- #ifdef MP-WEIXIN -->
    <page-container :show="backGuard" :overlay="false" :duration="0" @beforeleave="onBackGuard" />
    <!-- #endif -->
  </view>
</template>

<style lang="scss" scoped>
.ld-home {
  height: 100vh;
  background: $white;
}
.ld-home-scroll {
  height: 100vh;
}
</style>
