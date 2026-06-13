<script setup>
/**
 * 买家秀卡。对应原型 Sections.jsx 的 ReviewCard。
 */
import MediaSlot from './MediaSlot.vue'
import Icon from './Icon.vue'

defineProps({
  review: { type: Object, required: true },
})
</script>

<template>
  <view class="ld-review-card">
    <MediaSlot ratio="3/4" label="买家秀" />
    <view class="ld-review-body">
      <text class="ld-stars">★★★★★</text>
      <text class="ld-review-quote">{{ review.quote }}</text>
      <view class="ld-review-meta">
        <view class="ld-review-dot"></view>
        <text class="ld-review-user">{{ review.user }}</text>
        <view class="ld-verified">
          <Icon name="badge-check" :size="13" />
          <text class="ld-verified-text">已验证买家</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-review-card {
  display: inline-block;
  vertical-align: top;
  white-space: normal;
  width: 220px;
  margin-right: 14px;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
  border-radius: $r-sm;
  overflow: hidden;
  box-shadow: $shadow-card;
}
.ld-review-body {
  padding: 12px 14px 14px;
}
.ld-stars {
  display: block;
  color: $duck-deep;
  font-size: 14px;
  letter-spacing: 2px;
}
.ld-review-quote {
  display: block;
  font-size: 13.5px;
  color: $ink;
  line-height: 1.6;
  margin: 8px 0 12px;
}
.ld-review-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ld-review-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: $purple;
  flex: 0 0 auto;
}
.ld-review-user {
  font-size: 11px;
  color: $content-2;
}
.ld-verified {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
}
.ld-verified-text {
  font-size: 12px;
  color: $purple;
  white-space: nowrap;
}
</style>
