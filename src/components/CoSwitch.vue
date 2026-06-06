<script setup>
/**
 * 开关（圆角轨 + 滑块）。地址编辑「设为默认」、评价「匿名」共用。
 * 纯展示：点击交互由外层整行 @tap 控制（保留整行可点的大热区），这里只按 on 显示开/关。
 * 此前 co-switch 的 markup + 样式在 co.scss，被各页直接写 view 复用；现收口成组件。
 */
defineProps({
  on: { type: Boolean, default: false },
})
</script>

<template>
  <view class="co-switch" :class="{ on }"><view class="co-switch-dot"></view></view>
</template>

<style lang="scss" scoped>
.co-switch {
  width: 44px;
  height: 26px;
  border-radius: $r-pill;
  background: $line-strong;
  flex: 0 0 auto;
  position: relative;
  transition: background 0.2s;
}
.co-switch.on {
  background: $purple;
}
.co-switch-dot {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: $white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s;
}
.co-switch.on .co-switch-dot {
  transform: translateX(18px);
}
</style>
