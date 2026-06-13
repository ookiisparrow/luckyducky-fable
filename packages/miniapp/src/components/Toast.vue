<script setup>
/**
 * 轻提示。对应原型 Chrome.jsx 的 Toast。
 * 用自建组件而非 uni.showToast，以保持与设计一致的样式。
 */
import Icon from './Icon.vue'

defineProps({
  show: { type: Boolean, default: false },
  text: { type: String, default: '' },
})
</script>

<template>
  <view class="ld-toast" :class="{ show }">
    <Icon name="check" :size="18" />
    <text class="ld-toast-text">{{ text }}</text>
  </view>
</template>

<style lang="scss" scoped>
.ld-toast {
  position: fixed;
  left: 50%;
  top: 46%;
  transform: translate(-50%, -50%) scale(0.9);
  background: rgba(0, 0, 0, 0.82);
  border-radius: 12px;
  padding: 14px 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.2s,
    transform 0.2s;
  z-index: 60;
}
.ld-toast.show {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.ld-toast-text {
  color: $white;
  font-size: 14px;
  white-space: nowrap;
}
</style>
