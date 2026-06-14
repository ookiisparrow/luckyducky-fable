<script setup>
/**
 * 底部浮动药丸 Tab 栏（自建，跨端通用，对应原型 Chrome.jsx 的 TabBar）。
 * 不用各端原生 tabBar，方便 1:1 还原浮动药丸造型并多端一致。
 * 点击切换页面用 uni.reLaunch（三个 Tab 平级）。
 */
import Icon from './Icon.vue'

defineProps({
  active: { type: String, default: 'home' }, // home | cart | me
})

const TABS = [
  { id: 'home', label: '首页', icon: 'house', path: '/pages/index/index' },
  { id: 'cart', label: '购物车', icon: 'shopping-cart', path: '/pages/cart/index' },
  { id: 'me', label: '我', icon: 'user', path: '/pages/me/index' },
]

function go(tab, active) {
  if (tab.id === active) return
  uni.reLaunch({ url: tab.path })
}
</script>

<template>
  <view class="ld-tabbar-wrap">
    <view class="ld-tabbar">
      <view
        v-for="tab in TABS"
        :key="tab.id"
        class="ld-tab"
        :class="{ active: active === tab.id }"
        @tap="go(tab, active)"
      >
        <Icon :name="active === tab.id ? `${tab.icon}-on` : tab.icon" :size="20" />
        <text class="ld-tab-label">{{ tab.label }}</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-tabbar-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  padding: 0 28px calc(8px + env(safe-area-inset-bottom));
  pointer-events: none;
}
.ld-tabbar {
  pointer-events: auto;
  background: $white;
  border-radius: 28px;
  padding: 8px;
  display: flex;
  gap: 4px;
  box-shadow: $shadow-tab;
}
.ld-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 20px;
  padding: 11px 0;
  transition:
    background 0.2s,
    color 0.2s;
}
.ld-tab.active {
  background: #f2ebfc;
}
.ld-tab-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.55);
}
.ld-tab.active .ld-tab-label {
  color: $purple-tab;
}
</style>
