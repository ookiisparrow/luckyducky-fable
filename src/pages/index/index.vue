<script setup>
/**
 * 首页。对应原型「主版本/首页.html」的 home Tab。
 * 组合各区块组件，并实现：点「购买」滚动定位并高亮、点搜索滚到品牌介绍、
 * 加入弹 Toast、滚动过半显示回到顶部。
 */
import { ref, getCurrentInstance } from 'vue'
import { onPageScroll } from '@dcloudio/uni-app'

import Hero from '@/components/Hero.vue'
import BrandIntro from '@/components/BrandIntro.vue'
import FeatureProducts from '@/components/FeatureProducts.vue'
import TrustStrip from '@/components/TrustStrip.vue'
import Reassurance from '@/components/Reassurance.vue'
import Reviews from '@/components/Reviews.vue'
import FAQ from '@/components/FAQ.vue'
import ClosingCTA from '@/components/ClosingCTA.vue'
import SiteFooter from '@/components/SiteFooter.vue'
import TabBar from '@/components/TabBar.vue'
import Toast from '@/components/Toast.vue'
import BackTop from '@/components/BackTop.vue'

const instance = getCurrentInstance()
const windowHeight = uni.getSystemInfoSync().windowHeight

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
  clearTimeout(toastTimer)
  toast.value = { show: true, text }
  toastTimer = setTimeout(() => {
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
  setTimeout(() => {
    flashId.value = id
    setTimeout(() => (flashId.value = ''), 1600)
  }, 30)
}

// ---- 事件处理 ----
function onHeroBuy() {
  scrollToAnchor('anchor-products', 80)
  flashProduct('prod-2')
}
function onExplore() {
  scrollToAnchor('anchor-intro', 12)
}
function onProductOpen(p) {
  uni.navigateTo({
    url: `/pages/detail/index?id=${p.id}&name=${encodeURIComponent(p.name)}`,
  })
}
function onProductAdd(p) {
  ping(`已收藏 ${p.name}`)
}
function onClosingBuy() {
  ping('Get Ducky Get Lucky')
}
function onReviewsMore() {
  ping('全部买家秀（敬请期待）')
}
</script>

<template>
  <view class="ld-home">
    <Hero @buy="onHeroBuy" @explore="onExplore" />

    <view id="anchor-intro">
      <BrandIntro />
    </view>

    <view id="anchor-products">
      <FeatureProducts :flash-id="flashId" @open="onProductOpen" @add="onProductAdd" />
    </view>

    <TrustStrip />
    <Reassurance />
    <Reviews @more="onReviewsMore" />
    <FAQ />
    <ClosingCTA @buy="onClosingBuy" />
    <SiteFooter />

    <!-- 浮层 -->
    <BackTop v-if="showTop" @tap="backToTop" />
    <Toast :show="toast.show" :text="toast.text" />
    <TabBar active="home" />
  </view>
</template>

<style lang="scss" scoped>
.ld-home {
  background: $white;
}
</style>
