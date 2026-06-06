<script setup>
/**
 * 全部评价子页。对应原型 ProductDetail.jsx 的 ReviewsPage。
 * 由商品详情「全部 998 条」进入。评分汇总 + 标签 + 筛选 + 全部评价列表。
 * 筛选为高亮态（与原型一致，不做真实过滤）；买家秀图位走 MediaSlot 灰占位。
 */
import { ref } from 'vue'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { PRODUCT_DETAIL as PD } from '@/data/productDetail.js'
import { goBack } from '@/utils/nav.js'
import { stars } from '@/utils/format.js'

const f = ref(0)

const back = () => goBack('/pages/index/index')
</script>

<template>
  <view class="pdr">
    <view class="pdr-header">
      <view class="pdr-nav">
        <view class="pdr-nav-btn" @tap="back"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="pdr-nav-title">全部评价</text>
        <view class="pdr-nav-spacer"></view>
      </view>
    </view>

    <!-- 评分汇总 -->
    <view class="pdr-summary">
      <view class="pdp-rate-head">
        <view class="pdp-rate-score">
          <text class="pdp-rate-big">{{ PD.rating.score }}</text>
          <text class="pdp-stars">{{ stars(5) }}</text>
          <text class="pdp-rate-count">{{ PD.rating.count }} 条评价</text>
        </view>
        <view class="pdp-rate-bars">
          <view v-for="([k, v], i) in PD.rating.dist" :key="i" class="pdp-rate-bar">
            <text class="pdp-rate-k">{{ k }}</text>
            <view class="pdp-rate-track">
              <view class="pdp-rate-fill" :style="{ width: v + '%' }"></view>
            </view>
          </view>
        </view>
      </view>
      <view class="pdp-chips">
        <view v-for="([t, n], i) in PD.rating.tags" :key="i" class="pdp-chip">
          <text>{{ t }}</text><text class="pdp-chip-n">{{ n }}</text>
        </view>
      </view>
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
      <view
        v-for="(r, i) in PD.reviewsAll"
        :key="i"
        class="pdp-review"
        :class="{ divided: i > 0 }"
      >
        <view class="pdp-review-top">
          <view class="pdp-review-av"><MediaSlot ratio="1/1" :radius="14" /></view>
          <text class="pdp-review-name">{{ r.name }}</text>
          <text class="pdp-review-date">{{ r.date }}</text>
        </view>
        <text class="pdp-stars">{{ stars(r.n) }}</text>
        <text class="pdp-review-text">{{ r.text }}</text>
        <view v-if="r.photos" class="pdp-review-photos">
          <view v-for="p in r.photos" :key="p" class="pdp-review-photo">
            <MediaSlot ratio="1/1" :radius="4" />
          </view>
        </view>
      </view>
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

/* 顶部导航 */
.pdr-header {
  background: $white;
  padding: calc(6px + env(safe-area-inset-top)) 0 0;
  border-bottom: 0.5px solid $line;
}
.pdr-nav {
  display: flex;
  align-items: center;
  padding: 2px 16px 12px;
}
.pdr-nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.pdr-nav-btn:active {
  background: rgba(0, 0, 0, 0.06);
}
.pdr-nav-title {
  flex: 1;
  text-align: center;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.pdr-nav-spacer {
  width: 34px;
  flex: 0 0 auto;
}

/* 评分汇总 */
.pdr-summary {
  background: $white;
  padding-bottom: 6px;
}
.pdp-rate-head {
  display: flex;
  align-items: center;
  padding: 14px 20px 8px;
}
.pdp-rate-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 0 0 auto;
  margin-right: 20px;
}
.pdp-rate-big {
  font-family: $font-sans;
  font-size: 34px;
  font-weight: 700;
  color: $ink;
  line-height: 1;
}
.pdp-stars {
  color: $duck-deep;
  font-size: 13px;
  letter-spacing: 1.5px;
}
.pdp-rate-score .pdp-stars {
  margin-top: 4px;
}
.pdp-rate-count {
  font-size: 11px;
  color: $content-2;
  margin-top: 4px;
}
.pdp-rate-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
}
.pdp-rate-bar {
  display: flex;
  align-items: center;
  margin-bottom: 5px;
}
.pdp-rate-k {
  font-size: 11px;
  color: $content-2;
  width: 26px;
  flex: 0 0 26px;
}
.pdp-rate-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: $line;
  overflow: hidden;
  margin-left: 8px;
}
.pdp-rate-fill {
  height: 100%;
  background: $duck-deep;
  border-radius: 3px;
}
.pdp-chips {
  display: flex;
  flex-wrap: wrap;
  padding: 8px 20px 14px;
}
.pdp-chip {
  font-size: 12.5px;
  color: $content;
  background: $bg-grey;
  border-radius: $r-pill;
  padding: 6px 12px;
  margin: 0 8px 8px 0;
}
.pdp-chip-n {
  color: $content-2;
  font-family: $font-sans;
  margin-left: 3px;
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

/* 评价列表 */
.pdr-list {
  background: $white;
  margin-top: 10px;
}
.pdp-review {
  padding: 14px 20px;
}
.pdp-review.divided {
  border-top: 0.5px solid $line-soft;
}
.pdp-review-top {
  display: flex;
  align-items: center;
  margin-bottom: 9px;
}
.pdp-review-av {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 9px;
}
.pdp-review-name {
  flex: 1;
  font-size: 13px;
  color: $ink;
}
.pdp-review-date {
  font-size: 11px;
  color: $content-2;
}
.pdp-review-text {
  display: block;
  font-size: 14px;
  line-height: 1.6;
  color: $content;
  margin: 9px 0;
}
.pdp-review-photos {
  display: flex;
  flex-wrap: wrap;
}
.pdp-review-photo {
  width: 72px;
  height: 72px;
  border-radius: $r-xs;
  overflow: hidden;
  margin: 0 6px 6px 0;
}
.pdr-foot {
  height: calc(8px + env(safe-area-inset-bottom));
}
</style>
