<script setup>
/**
 * 骨架屏占位（优化批0618·T-F2）。数据页冷启 / 弱网时填充非空白占位，数据回来平滑替换，
 * 替代纯文字「加载中」或白屏（根因#8：空白态是真机冷启才暴露的体验坑）。
 *
 * 纯 CSS shimmer：动 background-position（mp-weixin 安全），不用 backdrop-filter / color-mix；
 * 占位色走 token（$bg-grey 底、$bg-faint 扫光），不写死主题色。
 *
 * 用法（基础块，按需堆叠组合出列表 / 卡片骨架）：
 *   <Skeleton w="70%" h="14px" mb="8px" />   文本行
 *   <Skeleton w="56px" h="56px" radius="10px" />  缩略图位
 *   <Skeleton circle w="26px" />            圆形（头像 / 序号位，h 自动=w）
 */
defineProps({
  w: { type: String, default: '100%' }, // 宽
  h: { type: String, default: '16px' }, // 高（circle 时忽略，取 w）
  radius: { type: String, default: '8px' }, // 圆角
  circle: { type: Boolean, default: false }, // 圆形位（头像 / 序号）
  mb: { type: String, default: '0' }, // 下间距，便于纵向堆叠
})
</script>

<template>
  <view
    class="skel"
    :style="{
      width: w,
      height: circle ? w : h,
      borderRadius: circle ? '50%' : radius,
      marginBottom: mb,
    }"
  ></view>
</template>

<style lang="scss" scoped>
.skel {
  display: block;
  /* 底 $bg-grey + 中段 $bg-faint 扫光（皆 token，非写死）；动 background-position 出流光，mp 安全 */
  background: linear-gradient(90deg, $bg-grey 25%, $bg-faint 38%, $bg-grey 54%);
  background-size: 280% 100%;
  animation: skel-shimmer 1.4s ease infinite;
}
@keyframes skel-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
</style>
