<script setup>
/**
 * 产品卡（横滑列表中的一项）。对应原型 Sections.jsx 的 ProductCard。
 * - 点卡片：emit('open')（以后跳商品详情）
 * - 点 ＋：emit('add')（加入；现仅弹 Toast）
 * - flash：被「购买」定位命中时高亮闪一下
 */
import MediaSlot from './MediaSlot.vue'
import Icon from './Icon.vue'

defineProps({
  product: { type: Object, required: true },
  flash: { type: Boolean, default: false },
})
const emit = defineEmits(['open', 'add'])
</script>

<template>
  <view :id="product.id" class="ld-prod-card" :class="{ 'is-flash': flash }" @tap="emit('open')">
    <MediaSlot ratio="1/1" label="放入产品照片" />
    <view class="ld-prod-body">
      <text class="ld-prod-name">{{ product.name }}</text>
      <text class="ld-prod-tag">{{ product.tag }}</text>
      <view class="ld-prod-foot">
        <view class="ld-price-group">
          <text class="ld-price-was">{{ product.was }}</text>
          <text class="ld-price">{{ product.now }}</text>
        </view>
        <view class="ld-add" @tap.stop="emit('add')">
          <Icon name="plus" :size="18" />
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-prod-card {
  display: inline-block;
  vertical-align: top;
  white-space: normal;
  width: 220px;
  margin-right: $gutter;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-sm;
  overflow: hidden;
  transition: box-shadow 0.2s ease;
}
.is-flash {
  animation: ld-prod-flash 1.5s ease;
}
@keyframes ld-prod-flash {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(163, 113, 234, 0);
  }
  18%,
  62% {
    box-shadow: 0 0 0 3px $brand;
  }
}
.ld-prod-body {
  padding: 11px 14px 14px;
}
.ld-prod-name {
  display: block;
  font-size: 16px;
  color: $ink;
  line-height: 1.35;
}
.ld-prod-tag {
  display: block;
  font-size: 14px;
  color: $content-2;
  margin-top: 4px;
}
.ld-prod-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 11px;
}
.ld-price-group {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}
.ld-price-was {
  font-family: $font-sans;
  font-size: 13px;
  color: $content-2;
  text-decoration: line-through;
}
.ld-price {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 21px;
  color: $ink;
}
.ld-add {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: $brand;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ld-add:active {
  background: $brand-active;
}
</style>
