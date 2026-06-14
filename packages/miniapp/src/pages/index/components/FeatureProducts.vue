<script setup>
/**
 * 「入门钩织的妙趣方案」+ 横滑产品。对应原型 Sections.jsx 的 Friends。
 */
import { computed, getCurrentInstance } from 'vue'
import MediaSlot from '@/components/MediaSlot.vue'
import ProductCard from '@/components/ProductCard.vue'
import { useProductsStore } from '@/store/products.js'
import { yuan } from '@/utils/format.js'

defineProps({
  flashId: { type: String, default: '' }, // 命中要高亮的产品 id
})
const emit = defineEmits(['open', 'add', 'scrollto'])
const instance = getCurrentInstance()

// 购买按钮触发：滚到商品卡——让卡片行（rail）在屏幕垂直居中。
// 商品区顶部是全屏方图 + 文案，卡片在更下面，故直接定位 rail（方图高度随屏宽变、固定偏移对不准）。
// currentScrollTop 由首页传入（当前滚动量），rect.top/height 是 rail 相对视口的位置与高度。
function scrollToProducts(currentScrollTop = 0) {
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select('#ld-prod-rail')
    .boundingClientRect((rect) => {
      if (!rect) return
      const winH = uni.getSystemInfoSync().windowHeight
      const top = Math.max(0, (winH - rect.height) / 2) // 卡片行垂直居中
      emit('scrollto', currentScrollTop + rect.top - top) // 父页 scroll-view 滚到此位置（不再页面级 pageScrollTo）
    })
    .exec()
}
defineExpose({ scrollToProducts })

// 首页横滑商品来自商品 store（小程序端云端 / 其它端回退本地）。
// store 是 canonical 形状（price/was 数字）；这里映射成 ProductCard 需要的字符串价形状。
const products = useProductsStore()
const list = computed(() =>
  products.featured.map((p) => ({
    id: p.id,
    name: p.name,
    tag: p.tag,
    was: yuan(p.was),
    now: yuan(p.price),
    img: p.cover || '', // 控制台上架的封面图（云存储 fileID，小程序 <image> 原生支持；本地回退无图走灰占位）
  }))
)
</script>

<template>
  <view class="ld-friends">
    <MediaSlot ratio="1/1" :radius="9" label="放入图片" />

    <view class="ld-feature-copy">
      <text class="ld-feature-title">入门钩织的妙趣方案</text>
      <text class="ld-feature-body">为了让钩织入门更轻松、更有趣，我们精心设计了这些小家伙。</text>
    </view>

    <scroll-view id="ld-prod-rail" scroll-x class="ld-prod-rail" :show-scrollbar="false">
      <ProductCard
        v-for="p in list"
        :key="p.id"
        :product="p"
        :flash="flashId === p.id"
        @open="emit('open', p)"
        @add="emit('add', p)"
      />
      <view class="ld-rail-end"></view>
    </scroll-view>
  </view>
</template>

<style lang="scss" scoped>
.ld-friends {
  padding: 24px $pad-page 36px;
}
.ld-feature-copy {
  margin-top: 68px;
}
.ld-feature-title {
  display: block;
  @include ld-h2;
  line-height: 1.25;
}
.ld-feature-body {
  display: block;
  font-size: 15px;
  line-height: 1.65;
  color: $content;
  margin-top: 12px;
  max-width: 75%;
}
.ld-prod-rail {
  margin-top: 12px;
  white-space: nowrap;
  /* 让卡片可以越过 .ld-friends 的右内边距一直滑到边缘 */
  margin-right: -#{$pad-page};
}
.ld-rail-end {
  display: inline-block;
  width: 8px;
}
</style>
