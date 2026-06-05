<script setup>
/**
 * 回到顶部按钮。对应原型 Chrome.jsx 的 BackTop。
 * 是否显示由父页面控制（滚动过半才挂载）。
 */
import Icon from './Icon.vue'
const emit = defineEmits(['tap'])
</script>

<template>
  <view class="ld-backtop" @tap="emit('tap')">
    <Icon name="chevron-up" :size="18" />
    <text class="ld-backtop-text">顶部</text>
  </view>
</template>

<style lang="scss" scoped>
.ld-backtop {
  position: fixed;
  right: 18px;
  bottom: 96px;
  z-index: 25;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: $white;
  box-shadow: 0 6px 20px rgba(123, 92, 175, 0.28);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: ld-fade-up 0.22s ease both;
}
@keyframes ld-fade-up {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.ld-backtop-text {
  font-size: 9px;
  color: $purple-meta;
}
</style>
