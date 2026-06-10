<script setup>
/**
 * 求助面板 · 在线客服。现为样例对话（toast 模拟），上线方案见设计规格（建议微信客服）。
 * 副作用（toast）上提：本组件只 emit('action', 提示文案)，由壳统一弹。
 */
import Icon from '@/components/Icon.vue'
import { SERVICE_CHIPS } from './data.js'

const emit = defineEmits(['action'])
</script>

<template>
  <view class="hs-detail">
    <view class="hs-svc-hero">
      <view class="hs-svc-av"><Icon name="headphones-amber" :size="25" /></view>
      <view>
        <text class="hs-svc-name">小鸭客服 · 暖暖</text>
        <view class="hs-svc-status"
          ><view class="dot"></view><text>在线 · 通常 1 分钟内回复</text></view
        >
      </view>
    </view>
    <text class="hs-bubble"
      >你好呀~ 我是你的钩织小帮手。遇到任何问题，直接告诉我就好，我们一针一针来解决。</text
    >
    <text class="hs-clabel">常见求助，点一下快速发送</text>
    <view class="hs-chips">
      <view
        v-for="(c, i) in SERVICE_CHIPS"
        :key="i"
        class="hs-chip"
        @tap="emit('action', '已为你转接客服 · ' + c)"
        >{{ c }}</view
      >
    </view>
    <view class="hs-input">
      <input class="hs-input-field" placeholder="输入你的问题…" disabled />
      <view class="hs-send" @tap="emit('action', '消息已送达 · 客服马上回复你~')"
        ><Icon name="send-w" :size="19"
      /></view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.hs-detail {
  padding: 4px 18px 26px;
}
.hs-svc-hero {
  display: flex;
  align-items: center;
  padding: 4px 0 16px;
}
.hs-svc-av {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #f5b030;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 12px;
}
.hs-svc-name {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.hs-svc-status {
  display: flex;
  align-items: center;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 3px;
}
.hs-svc-status .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #2fbf71;
  margin-right: 6px;
}
.hs-bubble {
  display: block;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: 4px 16px 16px 16px;
  padding: 13px 15px;
  font-size: 14.5px;
  line-height: 1.6;
  color: $content;
}
.hs-clabel {
  display: block;
  font-size: 13px;
  color: $content-2;
  margin: 20px 0 11px;
}
.hs-chips {
  display: flex;
  flex-wrap: wrap;
}
.hs-chip {
  border: 1px solid $line-strong;
  background: $white;
  color: $ink;
  border-radius: 999px;
  padding: 9px 15px;
  font-size: 13.5px;
  margin: 0 9px 9px 0;
}
.hs-chip:active {
  background: $bg-grey;
}
.hs-input {
  display: flex;
  align-items: center;
  margin-top: 22px;
  background: $white;
  border: 1px solid $line-strong;
  border-radius: 999px;
  padding: 5px 5px 5px 16px;
}
.hs-input-field {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  color: $ink;
}
.hs-send {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: $purple;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-left: 10px;
}
</style>
