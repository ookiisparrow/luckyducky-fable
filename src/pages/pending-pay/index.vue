<script setup>
/**
 * 待支付页。对应原型 Checkout.jsx 的 PendingPay。
 * 由「我的订单 · 待支付」进入。倒计时 + 收货地址 + 订单商品 + 金额 + 取消/去支付。
 * 「去支付」走支付成功页（无真实微信支付）；「取消」确认后返回。
 */
import { ref, computed, onUnmounted } from 'vue'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { useAddressStore } from '@/store/address.js'
import { PENDING_ORDER as O, COUPON, SHIP } from '@/data/orders.js'

const address = useAddressStore()
const addr = computed(() => address.defaultAddress)
const goods = O.price * (O.qty || 1)
const pay = Math.max(0, goods + SHIP - COUPON)
const money = (n) => Number(n).toFixed(2)

const secs = ref(15 * 60 - 1)
const timer = setInterval(() => {
  secs.value = secs.value > 0 ? secs.value - 1 : 0
}, 1000)
onUnmounted(() => clearInterval(timer))
const mmss = computed(() => {
  const m = String(Math.floor(secs.value / 60)).padStart(2, '0')
  const s = String(secs.value % 60).padStart(2, '0')
  return `${m}:${s}`
})

function back() {
  const p = getCurrentPages()
  if (p.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/me/index' })
}
function cancel() {
  uni.showModal({
    title: '取消订单',
    content: '确定要取消这个订单吗？',
    confirmText: '确定',
    cancelText: '再想想',
    success: (r) => {
      if (r.confirm) {
        uni.showToast({ title: '订单已取消', icon: 'none' })
        setTimeout(back, 300)
      }
    },
  })
}
function gopay() {
  uni.redirectTo({ url: `/pages/paysuccess/index?amount=${pay.toFixed(2)}` })
}
</script>

<template>
  <view class="co">
    <view class="co-header">
      <view class="co-nav">
        <view class="co-nav-btn" @tap="back"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="co-nav-title">待支付</text>
        <view class="co-nav-spacer"></view>
      </view>
    </view>

    <view class="co-body">
      <!-- 倒计时 -->
      <view class="copend-count">
        <Icon name="clock-orange" :size="19" />
        <text class="copend-count-text">请在 <text class="t">{{ mmss }}</text> 内完成支付</text>
        <text class="copend-count-sub">超时订单将自动取消</text>
      </view>

      <!-- 收货地址（只读） -->
      <view v-if="addr" class="co-addr">
        <view class="co-addr-main">
          <view class="co-addr-pin"><Icon name="map-pin" :size="24" /></view>
          <view class="co-addr-text">
            <view class="co-addr-line1">
              <text class="co-addr-name">{{ addr.name }}</text>
              <text class="co-addr-phone">{{ addr.phone }}</text>
            </view>
            <view class="co-addr-line2">
              <text v-if="addr.isDefault" class="co-addr-tag">默认</text>
              <text class="co-addr-detail">{{ (addr.region ? addr.region + ' ' : '') + addr.detail }}</text>
            </view>
          </view>
        </view>
        <view class="co-stitch"></view>
      </view>

      <!-- 订单商品（只读） -->
      <view class="co-card">
        <view class="co-shop">
          <Icon name="store" :size="17" />
          <text class="co-shop-name">易织™小棉鸭® 官方旗舰店</text>
          <view class="co-shop-chev"><Icon name="chevron-right" :size="16" /></view>
        </view>
        <view class="co-item">
          <view class="co-item-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="co-item-mid">
            <text class="co-item-name">{{ O.name }}</text>
            <text v-if="O.spec" class="co-item-spec">{{ O.spec }}</text>
            <view class="co-item-foot">
              <text class="co-price co-item-price"><text class="cny">￥</text>{{ money(O.price) }}</text>
              <text class="co-item-qty">×{{ O.qty || 1 }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 订单信息 -->
      <view class="co-card">
        <view class="co-row">
          <text class="co-row-key">订单编号</text>
          <text class="co-row-val muted">{{ O.no }}</text>
        </view>
        <view class="co-row divided">
          <text class="co-row-key">下单时间</text>
          <text class="co-row-val muted">{{ O.time }}</text>
        </view>
        <view class="co-row divided">
          <text class="co-row-key">支付方式</text>
          <text class="co-row-val">微信支付</text>
        </view>
      </view>

      <!-- 金额明细 -->
      <view class="co-card">
        <view class="co-summary">
          <view class="co-sum-row">
            <text class="co-sum-k">商品金额</text><text class="co-sum-b">￥{{ money(goods) }}</text>
          </view>
          <view class="co-sum-row">
            <text class="co-sum-k">运费</text><text class="co-sum-b">￥0.00（包邮）</text>
          </view>
          <view class="co-sum-row discount">
            <text class="co-sum-k">优惠券</text><text class="co-sum-b">-￥{{ money(COUPON) }}</text>
          </view>
          <view class="co-sum-div"></view>
          <view class="co-sum-row total">
            <text class="co-sum-k">需付款</text>
            <text class="co-sum-b"><text class="cny">￥</text>{{ money(pay) }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-dock-total">
        <text class="co-dock-small">需付款</text>
        <text class="co-dock-amt"><text class="cny">￥</text>{{ money(pay) }}</text>
      </view>
      <view class="co-cancel" @tap="cancel">取消订单</view>
      <view class="co-submit" @tap="gopay">去支付</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.co {
  min-height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
  color: $content;
}

/* 顶部导航 */
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

.co-body {
  padding: 12px 14px 4px;
}
.co-card {
  background: $white;
  border-radius: $r-md;
  box-shadow: $shadow-soft;
  overflow: hidden;
  margin-bottom: 12px;
}

/* 倒计时 */
.copend-count {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  background: $bg-cream;
  border: 0.5px solid $line-cream;
  border-radius: $r-md;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.copend-count-text {
  font-size: 14.5px;
  color: $ink;
  margin-left: 8px;
}
.copend-count-text .t {
  font-family: $font-sans;
  font-weight: 700;
  color: $duck-orange;
}
.copend-count-sub {
  flex: 1 1 100%;
  font-size: 12px;
  color: $content-2;
  margin-left: 27px;
  margin-top: 4px;
}

/* 收货地址（只读） */
.co-addr {
  background: $white;
  border-radius: $r-md;
  box-shadow: $shadow-soft;
  margin-bottom: 12px;
}
.co-addr-main {
  display: flex;
  align-items: center;
  padding: 18px 14px 20px;
}
.co-addr-pin {
  width: 26px;
  flex: 0 0 auto;
  display: flex;
  justify-content: center;
  margin-right: 13px;
}
.co-addr-text {
  flex: 1 1 auto;
  min-width: 0;
}
.co-addr-line1 {
  display: flex;
  align-items: baseline;
}
.co-addr-name {
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
}
.co-addr-phone {
  font-family: $font-sans;
  font-size: 14px;
  color: $content;
  margin-left: 12px;
}
.co-addr-line2 {
  font-size: 13.5px;
  color: $content-2;
  line-height: 1.5;
  margin-top: 6px;
}
.co-addr-tag {
  font-size: 10.5px;
  color: $purple;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 6px;
}
.co-stitch {
  height: 4px;
  border-radius: 0 0 $r-md $r-md;
  overflow: hidden;
  background-image: repeating-linear-gradient(
    72deg,
    $duck-orange 0 6px,
    transparent 6px 7px,
    $purple 7px 13px,
    transparent 13px 14px
  );
}

/* 店铺 + 商品 */
.co-shop {
  display: flex;
  align-items: center;
  padding: 14px 16px 4px;
}
.co-shop-name {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $ink;
  margin-left: 7px;
}
.co-shop-chev {
  margin-left: auto;
  display: flex;
}
.co-item {
  display: flex;
  padding: 14px 16px;
}
.co-item-img {
  width: 80px;
  height: 80px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.co-item-mid {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.co-item-name {
  font-size: 15px;
  color: $ink;
  line-height: 1.35;
}
.co-item-spec {
  align-self: flex-start;
  font-size: 11.5px;
  color: $content-2;
  background: $bg-grey;
  border-radius: 4px;
  padding: 3px 8px;
  margin-top: 7px;
}
.co-item-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 10px;
}
.co-price {
  font-family: $font-sans;
  font-weight: 600;
  color: $ink;
}
.co-price .cny {
  font-size: 13px;
  margin-right: 1px;
}
.co-item-price {
  font-size: 19px;
}
.co-item-qty {
  font-family: $font-sans;
  font-size: 13px;
  color: $content-2;
}

/* 订单信息行 */
.co-row {
  display: flex;
  align-items: center;
  padding: 15px 16px;
}
.co-row.divided {
  border-top: 0.5px solid $line-soft;
}
.co-row-key {
  font-size: 14.5px;
  color: $content;
  flex: 0 0 auto;
}
.co-row-val {
  flex: 1 1 auto;
  text-align: right;
  font-size: 14px;
  color: $ink;
  margin-left: 10px;
}
.co-row-val.muted {
  color: $content-2;
  font-family: $font-sans;
}

/* 金额明细 */
.co-summary {
  margin: 4px 12px 14px;
  background: $bg-faint;
  border-radius: $r-md;
  padding: 14px 16px;
}
.co-sum-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 0;
}
.co-sum-k {
  font-size: 13.5px;
  color: $content-2;
}
.co-sum-b {
  font-family: $font-sans;
  font-weight: 500;
  font-size: 14px;
  color: $content;
}
.co-sum-row.discount .co-sum-b {
  color: $red;
}
.co-sum-div {
  height: 0.5px;
  background: $line;
  margin: 7px 0;
}
.co-sum-row.total .co-sum-k {
  font-size: 14px;
  color: $ink;
}
.co-sum-row.total .co-sum-b {
  font-weight: 700;
  font-size: 18px;
  color: $ink;
}
.co-sum-row.total .cny {
  font-size: 13px;
}

/* 底部 */
.co-foot {
  height: calc(78px + env(safe-area-inset-bottom));
}
.co-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  background: $white;
  box-shadow: 0 -1px 0 $line;
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
}
.co-dock-total {
  display: flex;
  flex-direction: column;
  line-height: 1.1;
  margin-right: auto;
}
.co-dock-small {
  font-size: 11px;
  color: $content-2;
}
.co-dock-amt {
  font-family: $font-sans;
  font-weight: 700;
  font-size: 22px;
  color: $ink;
  line-height: 1;
}
.co-dock-amt .cny {
  font-size: 14px;
  font-weight: 600;
}
.co-cancel,
.co-submit {
  flex: 0 0 auto;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 14px;
  padding: 12px 20px;
  margin-left: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.co-cancel {
  background: $white;
  border: 1px solid $line-strong;
  color: $content;
}
.co-cancel:active {
  background: $bg-grey;
}
.co-submit {
  background: $purple;
  color: $white;
}
.co-submit:active {
  opacity: 0.94;
}
</style>
