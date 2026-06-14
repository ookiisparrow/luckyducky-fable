<script setup>
/**
 * 首页。对应原型「主版本/首页.html」的 home Tab。
 * 组合各区块组件，并实现：点「购买」滚动定位并高亮、点搜索滚到品牌介绍、
 * 加入弹 Toast、滚动过半显示回到顶部。
 */
import { ref, watch, getCurrentInstance } from 'vue'
import { onPageScroll } from '@dcloudio/uni-app'

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

// section 组件是纯展示（技术债 #4），数据在页面收口；将来换云端来源只改这里
import { useContentStore } from '@/store/content.js'
import { useProductsStore } from '@/store/products.js'
import { useUserStore } from '@/store/user.js'
import { REASSURE_ITEMS } from '@/data/reassure.js'
import { REVIEWS } from '@/data/reviews.js'

const { later } = useTimers()
// 首页内容（hero 文案/信任条/FAQ）：控制台橱窗可编辑，云端无记录回退本地默认
const content = useContentStore()
content.load()
// 启动开屏遮罩据 products.loaded 提前淡出（products.load 在 App.onLaunch 触发）
const products = useProductsStore()
// 加载页淡出后：未登录则自动弹登录弹窗（仍可「暂不登录」关掉继续逛，软门槛不变）
const user = useUserStore()
watch(splashActive, (active) => {
  if (!active && !user.isLogin) loginSheetVisible.value = true
})
const instance = getCurrentInstance()
const windowHeight = uni.getSystemInfoSync().windowHeight
const featureRef = ref(null) // 商品区组件实例（购买按钮调它滚到商品卡）

// ---- 滚动状态：回到顶部按钮 ----
const scrollTop = ref(0)
const showTop = ref(false)
onPageScroll((e) => {
  scrollTop.value = e.scrollTop
  showTop.value = e.scrollTop > windowHeight * 1.2
})
function backToTop() {
  uni.pageScrollTo({ scrollTop: 0, duration: 300 })
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
      uni.pageScrollTo({
        scrollTop: scrollTop.value + rect.top - offset,
        duration: 320,
      })
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
  // 详情按 id 从商品总表(catalog)取数据，这里只需带 id（name 作兜底）
  uni.navigateTo({ url: `/pages/detail/index?id=${p.id}&name=${encodeURIComponent(p.name)}` })
}
function onProductAdd(p) {
  ping(`已收藏 ${p.name}`)
}
function onClosingBuy() {
  ping('Get Ducky Get Lucky')
}
</script>

<template>
  <view class="ld-home">
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
      />
    </view>

    <TrustStrip :items="content.trust" />
    <Reassurance :items="REASSURE_ITEMS" />
    <Reviews :reviews="REVIEWS" />
    <FAQ :items="content.faq" />
    <ClosingCTA @buy="onClosingBuy" />
    <SiteFooter />

    <!-- 浮层 -->
    <BackTop v-if="showTop" @tap="backToTop" />
    <Toast :show="toast.show" :text="toast.text" />
    <TabBar active="home" />
    <LoginSheet />
    <LoadingSplash v-if="splashActive" :ready="products.loaded" />
  </view>
</template>

<style lang="scss" scoped>
.ld-home {
  background: $white;
}
</style>
