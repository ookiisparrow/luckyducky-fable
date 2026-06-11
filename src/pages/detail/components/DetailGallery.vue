<script setup>
/**
 * 商品详情 · 画廊（主图 + 缩略图选择）。从 detail 页拆出。
 * 自带「当前选中图」状态 sel —— 这是把它单独成组件的主要原因（封装局部状态）。
 * 图位仍走 MediaSlot 灰占位；缩略图数量由 count 传入。
 */
import { ref, computed } from 'vue'
import MediaSlot from '@/components/MediaSlot.vue'

const props = defineProps({
  count: { type: Number, default: 1 },
  // 真实图列表（控制台上架商品的 封面图+其余图，云存储 fileID）；空则全灰占位
  imgs: { type: Array, default: () => [] },
})
const sel = ref(0)
const total = computed(() => props.imgs.length || props.count)
</script>

<template>
  <view class="pdp-gallery">
    <view class="pdp-gallery-scrim"></view>
    <MediaSlot ratio="1/1" label="放入图片" :src="imgs[sel] || ''" />
    <text class="pdp-count">{{ sel + 1 }}/{{ total }}</text>
    <view class="pdp-thumbs">
      <view
        v-for="i in total"
        :key="i"
        class="pdp-thumb"
        :class="{ on: sel === i - 1 }"
        @tap="sel = i - 1"
      >
        <MediaSlot ratio="1/1" :radius="5" :src="imgs[i - 1] || ''" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pdp-gallery {
  position: relative;
  background: $white;
}
.pdp-gallery-scrim {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 150px;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0));
}
.pdp-count {
  position: absolute;
  right: 14px;
  bottom: 88px;
  background: rgba(0, 0, 0, 0.5);
  color: $white;
  font-family: $font-sans;
  font-size: 12px;
  padding: 4px 11px;
  border-radius: $r-pill;
  letter-spacing: 0.03em;
}
.pdp-thumbs {
  display: flex;
  padding: 12px 16px 16px;
  overflow-x: auto;
  white-space: nowrap;
}
.pdp-thumb {
  box-sizing: border-box;
  width: 60px;
  height: 60px;
  flex: 0 0 auto;
  margin-right: 8px;
  border-radius: $r-sm;
  border: 2px solid transparent;
  overflow: hidden;
}
.pdp-thumb.on {
  border-color: $purple;
}

</style>
