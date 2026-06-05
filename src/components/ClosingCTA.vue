<script setup>
/**
 * 结尾召唤区。对应原型 Sections.jsx 的 ClosingCTA。
 * 背景为灰色占位（以后可换大图/视频），上叠标题 + 标语按钮。
 */
defineProps({
  title: { type: String, default: '创造幸运' },
  tagline: { type: String, default: 'Get ducky get lucky' },
})
const emit = defineEmits(['buy'])
</script>

<template>
  <view class="ld-closing">
    <view class="ld-closing-sizer"></view>
    <view class="ld-closing-bg"></view>
    <view class="ld-closing-copy">
      <text class="ld-closing-title">{{ title }}</text>
      <view class="ld-closing-btn" @tap="emit('buy')">
        <text class="ld-closing-btn-text">{{ tagline }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-closing {
  position: relative;
  width: 100%;
  background: $white;
  overflow: hidden;
}
.ld-closing-sizer {
  width: 100%;
  padding-bottom: 61.8%; /* 黄金比 1 : 0.618 */
}
.ld-closing-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: $bg-sage;
}
.ld-closing-copy {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.ld-closing-title {
  @include ld-display;
  font-size: 40px; /* 比 hero 略小 */
}
.ld-closing-btn {
  margin-top: 22px;
  background: $purple-ink;
  border-radius: $r-pill;
  padding: 15px 32px;
  box-shadow: $shadow-float;
}
.ld-closing-btn:active {
  background: $purple-ink-active;
}
.ld-closing-btn-text {
  color: $white;
  font-size: 17px;
}
</style>
