<script setup>
/** 求助面板 · 学习交流群（样例二维码/群号；复制动作 emit 给壳 toast）。 */
import Icon from '@/components/Icon.vue'

const emit = defineEmits(['action'])
</script>

<template>
  <view class="hs-detail">
    <view class="hs-group-card">
      <text class="hs-group-name">易织小棉鸭 · 新手互助群</text>
      <text class="hs-group-meta">已有 1,286 位钩织小伙伴 · 老师每日在线答疑</text>
      <view class="hs-qr"><Icon name="qr-code-ink" :size="112" /></view>
      <text class="hs-group-hint">微信扫一扫，加入群聊</text>
      <view class="hs-group-btn" @tap="emit('action', '群号已复制 · 88-Ducky')"
        >复制群号 88-Ducky</view
      >
    </view>
    <view class="hs-group-pts">
      <view class="hs-group-pt"
        ><view class="dot"></view><text>遇到问题随时提问，不卡在某一针</text></view
      >
      <view class="hs-group-pt"
        ><view class="dot"></view><text>每周钩织打卡，和大家一起完成</text></view
      >
      <view class="hs-group-pt"
        ><view class="dot"></view><text>群内专属材料补给与新手福利</text></view
      >
    </view>
  </view>
</template>

<style lang="scss" scoped>
.hs-detail {
  padding: 4px 18px 26px;
}
.hs-group-card {
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-md;
  padding: 22px 20px;
  text-align: center;
}
.hs-group-name {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 18px;
  color: $ink;
}
.hs-group-meta {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 6px;
  line-height: 1.5;
}
.hs-qr {
  width: 154px;
  height: 154px;
  margin: 18px auto 12px;
  background: $white;
  border: 1px solid $line;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 14px rgba(54, 58, 80, 0.08);
}
.hs-group-hint {
  display: block;
  font-size: 12.5px;
  color: $content-2;
}
.hs-group-btn {
  margin-top: 16px;
  height: 46px;
  border-radius: 999px;
  background: $purple-ink;
  color: $white;
  font-weight: 600;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  letter-spacing: 0.04em;
}
.hs-group-btn:active {
  opacity: 0.92;
}
.hs-group-pts {
  margin: 18px 2px 0;
}
.hs-group-pt {
  display: flex;
  align-items: flex-start;
  margin-bottom: 11px;
}
.hs-group-pt .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: $duck-deep;
  flex: 0 0 auto;
  margin: 7px 12px 0 3px;
}
.hs-group-pt text {
  font-size: 13.5px;
  color: $content;
  line-height: 1.5;
}
</style>
