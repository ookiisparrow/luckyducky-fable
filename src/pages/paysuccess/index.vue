<script setup>
/**
 * 支付成功页。对应原型 Checkout.jsx 的 PaySuccess。
 * 由结算页 redirectTo 进入（带 amount）。成功标 + 实付 + 订单信息 + 两个出口。
 * 「返回首页」reLaunch 回首页；「查看订单」暂 Toast（订单中心在「个人中心」步骤再做）。
 * 入场动画按项目「暂不做渐显动画」的决定省略。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'

const amount = ref('0.00')
const orderNo = ref('')

onLoad((q) => {
  if (q && q.amount) amount.value = q.amount
  orderNo.value = '202606061430' + String(Math.floor(Math.random() * 9000) + 1000)
})

function home() {
  uni.reLaunch({ url: '/pages/index/index' })
}
function orders() {
  uni.showToast({ title: '订单中心（开发中）', icon: 'none' })
}
</script>

<template>
  <view class="cosuc">
    <view class="co-header">
      <view class="co-nav">
        <view class="co-nav-spacer"></view>
        <text class="co-nav-title">支付结果</text>
        <view class="co-nav-btn" @tap="home"><Icon name="x-ink" :size="22" /></view>
      </view>
    </view>

    <view class="cosuc-body">
      <view class="cosuc-hero">
        <view class="cosuc-check"><Icon name="check" :size="40" /></view>
        <text class="cosuc-title">支付成功</text>
        <text class="cosuc-amount"><text class="cny">￥</text>{{ amount }}</text>
        <text class="cosuc-sub">幸运已下单 · 我们会尽快为你打包发出</text>
      </view>

      <view class="cosuc-info">
        <view class="cosuc-info-row">
          <text class="cosuc-info-k">订单编号</text>
          <text class="cosuc-info-v num">{{ orderNo }}</text>
        </view>
        <view class="cosuc-info-row divided">
          <text class="cosuc-info-k">配送方式</text>
          <text class="cosuc-info-v">顺丰速运 · 包邮</text>
        </view>
        <view class="cosuc-info-row divided">
          <text class="cosuc-info-k">预计送达</text>
          <text class="cosuc-info-v">48 小时内发出 · 次日达</text>
        </view>
      </view>

      <view class="cosuc-actions">
        <view class="cosuc-btn ghost" @tap="orders">查看订单</view>
        <view class="cosuc-btn solid" @tap="home">返回首页</view>
      </view>

      <view class="cosuc-tip">
        <Icon name="sparkles-purple" :size="15" />
        <text>开盒就能跟着视频钩出第一只小鸭，Get Ducky Get Lucky</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.cosuc {
  min-height: 100vh;
  background: $white;
  font-family: $font-cn;
  color: $content;
}

/* 顶部导航（与结算页同款） */
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

.cosuc-body {
  padding: 18px 20px 8px;
}
.cosuc-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 30px 12px 26px;
}
.cosuc-check {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: $purple;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 28px rgba(123, 92, 175, 0.32);
}
.cosuc-title {
  font-family: $font-display;
  font-weight: 700;
  font-size: 24px;
  color: $ink;
  margin-top: 20px;
}
.cosuc-amount {
  font-family: $font-sans;
  font-weight: 700;
  font-size: 34px;
  color: $ink;
  margin-top: 10px;
}
.cosuc-amount .cny {
  font-size: 20px;
  font-weight: 600;
  margin-right: 2px;
}
.cosuc-sub {
  font-size: 14px;
  color: $content-2;
  line-height: 1.6;
  margin-top: 12px;
  max-width: 260px;
}

.cosuc-info {
  background: $bg-faint;
  border-radius: $r-md;
  padding: 6px 16px;
  margin-top: 6px;
}
.cosuc-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
}
.cosuc-info-row.divided {
  border-top: 0.5px solid $line;
}
.cosuc-info-k {
  font-size: 13.5px;
  color: $content-2;
}
.cosuc-info-v {
  font-weight: 500;
  font-size: 14px;
  color: $ink;
}
.cosuc-info-v.num {
  font-family: $font-sans;
}

.cosuc-actions {
  display: flex;
  margin-top: 26px;
}
.cosuc-btn {
  flex: 1;
  height: 48px;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cosuc-btn.ghost {
  background: $white;
  border: 1px solid $purple;
  color: $purple;
  margin-right: 12px;
}
.cosuc-btn.solid {
  background: $purple;
  color: $white;
}
.cosuc-btn:active {
  opacity: 0.94;
}

.cosuc-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  margin: 22px auto 0;
  max-width: 280px;
}
.cosuc-tip text {
  font-size: 12.5px;
  color: $purple-meta;
  line-height: 1.5;
  margin-left: 7px;
}
</style>
