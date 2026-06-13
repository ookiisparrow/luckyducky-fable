<script setup>
/**
 * 单条买家评价（头像/昵称/日期/星级/正文/晒图）。商品详情与「全部评价」共用。
 * 此前 pdp-review 的 markup + 样式在 detail / reviews 各复制一份，现收口。
 * （与首页买家秀的 ReviewCard.vue 结构不同，故另起一个组件。）
 */
import MediaSlot from './MediaSlot.vue'
import { stars } from '@/utils/format.js'

defineProps({
  review: { type: Object, required: true }, // { name, date, n, text, photos:数量 }
  divided: { type: Boolean, default: false }, // 顶部分隔线（列表位置控制）
})
</script>

<template>
  <view class="pdp-review" :class="{ divided }">
    <view class="pdp-review-top">
      <view class="pdp-review-av"><MediaSlot ratio="1/1" :radius="14" /></view>
      <text class="pdp-review-name">{{ review.name }}</text>
      <text class="pdp-review-date">{{ review.date }}</text>
    </view>
    <text class="pdp-stars">{{ stars(review.n) }}</text>
    <text class="pdp-review-text">{{ review.text }}</text>
    <view v-if="review.photos" class="pdp-review-photos">
      <view v-for="p in review.photos" :key="p" class="pdp-review-photo">
        <MediaSlot ratio="1/1" :radius="4" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
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
.pdp-stars {
  color: $duck-deep;
  font-size: 13px;
  letter-spacing: 1.5px;
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
</style>
