<script setup>
/**
 * 通用顶部导航条（结算/订单/地址/资料/售后/评价/支付结果 等页共用）。
 * 此前这段 markup + CSS 在 9~10 个页面里各躺一份，现收口成一个组件。
 *
 * mode='back'（默认）：左返回 + 居中标题 + 右占位，点返回 emit('back')
 * mode='close'：左占位 + 居中标题 + 右关闭，点关闭 emit('close')
 */
import Icon from './Icon.vue'

defineProps({
  title: { type: String, default: '' },
  mode: { type: String, default: 'back' }, // back | close
})
const emit = defineEmits(['back', 'close'])
</script>

<template>
  <view class="co-header">
    <view class="co-nav">
      <template v-if="mode === 'close'">
        <view class="co-nav-spacer"></view>
        <text class="co-nav-title">{{ title }}</text>
        <view class="co-nav-btn" @tap="emit('close')"><Icon name="x-ink" :size="22" /></view>
      </template>
      <template v-else>
        <view class="co-nav-btn" @tap="emit('back')"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="co-nav-title">{{ title }}</text>
        <view class="co-nav-spacer"></view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.co-header {
  background: $white;
  padding: calc(6px + env(safe-area-inset-top)) 0 0;
  border-bottom: 0.5px solid $line;
}
.co-nav {
  display: flex;
  align-items: center;
  padding: 2px 16px 12px;
}
.co-nav-btn {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.co-nav-btn:active {
  background: rgba(0, 0, 0, 0.06);
}
.co-nav-title {
  flex: 1;
  text-align: center;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.co-nav-spacer {
  width: 34px;
  flex: 0 0 auto;
}
</style>
