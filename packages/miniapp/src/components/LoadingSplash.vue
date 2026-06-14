<script setup>
/**
 * 启动开屏遮罩（规格 §四-1）。首页挂载即覆盖：紫渐变 + 细光点 + 白字标淡入 + 三点加载。
 * 计时：最短展示 1.3s 让动画走完；之后 ready（商品已拉到）即淡出；2.8s 兜底必关，避免卡死。
 * 淡出后置 splashActive=false 移除自身。纯 CSS 动画，无第三方依赖。
 */
import { ref, onMounted, watch } from 'vue'
import { useTimers } from '@/composables/useTimers.js'
import { splashActive } from '@/composables/useSplash.js'

const props = defineProps({
  ready: { type: Boolean, default: false }, // 商品是否已拉到（products.loaded）
})

const { later } = useTimers()
const fading = ref(false)
let minPassed = false
let done = false

function hide() {
  if (done) return
  done = true
  fading.value = true // 触发淡出
  later(() => (splashActive.value = false), 360)
}

onMounted(() => {
  later(() => {
    minPassed = true
    if (props.ready) hide()
  }, 1300)
  later(hide, 2800) // 兜底
})

watch(
  () => props.ready,
  (v) => {
    if (v && minPassed) hide()
  }
)

// 细光点：固定 12 颗，随机位置 / 时长 / 延迟，缓缓上浮
const sparks = Array.from({ length: 12 }, () => ({
  left: 8 + Math.random() * 84 + '%',
  bottom: Math.random() * 38 + '%',
  size: 3 + Math.random() * 4 + 'px',
  dur: 3 + Math.random() * 3 + 's',
  delay: Math.random() * 3 + 's',
}))
</script>

<template>
  <view class="lsp" :class="{ out: fading }">
    <view
      v-for="(s, i) in sparks"
      :key="i"
      class="lsp-spark"
      :style="{
        left: s.left,
        bottom: s.bottom,
        width: s.size,
        height: s.size,
        animationDuration: s.dur,
        animationDelay: s.delay,
      }"
    ></view>
    <view class="lsp-brand">
      <image class="lsp-logo" src="/static/logo-white.svg" mode="heightFix" />
      <text class="lsp-tag">创造幸运</text>
    </view>
    <view class="lsp-dots"><view></view><view></view><view></view></view>
  </view>
</template>

<style lang="scss" scoped>
.lsp {
  position: fixed;
  inset: 0;
  z-index: 300;
  /* 品牌紫渐变开屏（渐变不入 token；末段用 $purple-tab） */
  background: linear-gradient(160deg, #b79bea 0%, #8c6fd0 58%, $purple-tab 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: opacity 0.36s ease;
}
.lsp.out {
  opacity: 0;
}
.lsp-spark {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  opacity: 0;
  animation: lsp-float linear infinite;
}
@keyframes lsp-float {
  0% {
    transform: translateY(20px) scale(0.6);
    opacity: 0;
  }
  20% {
    opacity: 0.9;
  }
  80% {
    opacity: 0.6;
  }
  100% {
    transform: translateY(-220px) scale(1);
    opacity: 0;
  }
}
.lsp-brand {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  opacity: 0;
  animation: lsp-fade 0.7s ease 0.1s forwards;
}
.lsp-logo {
  height: 34px;
}
.lsp-tag {
  margin-top: 16px;
  color: $white;
  font-size: 13px;
  letter-spacing: 0.5em;
  text-indent: 0.5em;
}
@keyframes lsp-fade {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.lsp-dots {
  position: absolute;
  bottom: 96px;
  z-index: 2;
  display: flex;
  gap: 8px;
}
.lsp-dots view {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.95);
  animation: lsp-wave 1s ease-in-out infinite;
}
.lsp-dots view:nth-child(2) {
  animation-delay: 0.16s;
}
.lsp-dots view:nth-child(3) {
  animation-delay: 0.32s;
}
@keyframes lsp-wave {
  0%,
  100% {
    transform: translateY(0);
    opacity: 0.5;
  }
  50% {
    transform: translateY(-7px);
    opacity: 1;
  }
}
</style>
