<script setup>
/**
 * 商品详情 · 图文详情（参数表 + 分段图文）。从 detail 页拆出。
 * 外层 pdp-sec 白卡与标题仍在父页；本组件只管内容与自己的样式。
 */
import MediaSlot from '@/components/MediaSlot.vue'

defineProps({
  params: { type: Array, default: () => [] }, // [[k, v], ...]
  sections: { type: Array, default: () => [] }, // [{ lead, body }, ...]
})
</script>

<template>
  <view class="pdp-detail">
    <view class="pdp-param">
      <view
        v-for="([k, v], i) in params"
        :key="i"
        class="pdp-param-row"
        :class="{ last: i === params.length - 1 }"
      >
        <text class="pdp-param-dt">{{ k }}</text>
        <text class="pdp-param-dd">{{ v }}</text>
      </view>
    </view>

    <view v-for="(d, i) in sections" :key="i">
      <text class="pdp-detail-lead">{{ d.lead }}</text>
      <text class="pdp-detail-p">{{ d.body }}</text>
      <view class="pdp-detail-img"><MediaSlot ratio="4/3" :radius="5" label="放入图片" :src="d.img || ''" /></view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pdp-detail {
  padding: 4px 20px 22px;
}
.pdp-param {
  border: 1px solid $line;
  border-radius: $r-md;
  overflow: hidden;
  margin: 12px 0 18px;
}
.pdp-param-row {
  display: flex;
  font-size: 13.5px;
  border-bottom: 1px solid $line-soft;
}
.pdp-param-row.last {
  border-bottom: none;
}
.pdp-param-dt {
  width: 92px;
  flex: 0 0 92px;
  background: $bg-faint;
  color: $content-2;
  padding: 11px 14px;
}
.pdp-param-dd {
  flex: 1;
  color: $ink;
  padding: 11px 14px;
}
.pdp-detail-lead {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
  margin: 18px 0 8px;
}
.pdp-detail-p {
  display: block;
  font-size: 14.5px;
  line-height: 1.75;
  color: $content;
}
.pdp-detail-img {
  margin: 14px 0;
}

/* 套装包含（2 列卡片，跨端用 flex 不用 grid） */
</style>
