<script setup>
/**
 * 求助面板 · 在线客服。微信端：快捷问题 chip + 发送均为 open-type="contact" 原生客服会话
 * （R18/⑨，接待人 mp 后台配置）；非微信端：emit('action') 由壳 toast 兜底（T1 微信原生单源）。
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
      <!-- #ifdef MP-WEIXIN -->
      <!-- 快捷问题点一下进微信原生客服会话（open-type=contact 能力按钮，§5 例外；属性被 prettier 拆多行故 convention-ok） -->
      <button
        v-for="(c, i) in SERVICE_CHIPS"
        :key="i"
        class="hs-chip hs-chip-btn"
        open-type="contact"
      >
        {{ c }}
      </button>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <view
        v-for="(c, i) in SERVICE_CHIPS"
        :key="i"
        class="hs-chip"
        @tap="emit('action', '客服请在微信小程序内使用')"
        >{{ c }}</view
      >
      <!-- #endif -->
    </view>
    <view class="hs-input">
      <input class="hs-input-field" placeholder="输入你的问题…" disabled />
      <!-- #ifdef MP-WEIXIN -->
      <button class="hs-send hs-send-btn" open-type="contact">
        <Icon name="send-w" :size="19" />
      </button>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <view class="hs-send" @tap="emit('action', '客服请在微信小程序内使用')"
        ><Icon name="send-w" :size="19"
      /></view>
      <!-- #endif -->
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
/* 微信端 chip 是原生 button（open-type=contact），归零成胶囊 */
.hs-chip-btn {
  line-height: 1.4;
}
.hs-chip-btn::after {
  border: none;
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
/* 微信端发送是原生 button（open-type=contact），归零成圆钮 */
.hs-send-btn {
  padding: 0;
  line-height: 1;
  border: none;
}
.hs-send-btn::after {
  border: none;
}
</style>
