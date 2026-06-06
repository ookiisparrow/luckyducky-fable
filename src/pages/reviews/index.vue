<script setup>
/**
 * 全部评价子页。对应原型 ProductDetail.jsx 的 ReviewsPage。
 * 由商品详情「全部 998 条」进入。评分汇总 + 标签 + 筛选 + 全部评价列表。
 * 筛选为高亮态（与原型一致，不做真实过滤）；评分汇总/单条评价复用组件。
 */
import { ref } from 'vue'
import CoNavBar from '@/components/CoNavBar.vue'
import RatingSummary from '@/components/RatingSummary.vue'
import ReviewItem from '@/components/ReviewItem.vue'
import { PRODUCT_DETAIL as PD } from '@/data/productDetail.js'
import { goBack } from '@/utils/nav.js'

const f = ref(0)

const back = () => goBack('/pages/index/index')
</script>

<template>
  <view class="pdr">
    <CoNavBar title="全部评价" @back="back" />

    <!-- 评分汇总 -->
    <view class="pdr-summary">
      <RatingSummary :rating="PD.rating" />
    </view>

    <!-- 筛选 -->
    <view class="pdr-filter">
      <view
        v-for="([t, n], i) in PD.reviewFilters"
        :key="i"
        class="pdr-filter-btn"
        :class="{ on: i === f }"
        @tap="f = i"
        >{{ t }}<text class="pdr-filter-n"> {{ n }}</text></view
      >
    </view>

    <!-- 评价列表 -->
    <view class="pdr-list">
      <ReviewItem v-for="(r, i) in PD.reviewsAll" :key="i" :review="r" :divided="i > 0" />
    </view>

    <view class="pdr-foot"></view>
  </view>
</template>

<style lang="scss" scoped>
.pdr {
  min-height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
  color: $content;
}

/* 评分汇总（pdp-rate- / pdp-chip- 样式见 components/RatingSummary.vue） */
.pdr-summary {
  background: $white;
  padding-bottom: 6px;
}

/* 筛选 */
.pdr-filter {
  display: flex;
  padding: 12px 20px;
  background: $white;
  border-top: 0.5px solid $line-soft;
  overflow-x: auto;
  white-space: nowrap;
}
.pdr-filter-btn {
  flex: 0 0 auto;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: $r-pill;
  background: $bg-grey;
  color: $content;
  margin-right: 8px;
}
.pdr-filter-btn.on {
  background: $purple-ink;
  color: $white;
}
.pdr-filter-n {
  font-family: $font-sans;
}

/* 评价列表（pdp-review- 样式见 components/ReviewItem.vue） */
.pdr-list {
  background: $white;
  margin-top: 10px;
}
.pdr-foot {
  height: calc(8px + env(safe-area-inset-bottom));
}
</style>
