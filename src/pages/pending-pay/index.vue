<script setup>
/**
 * 待支付页。对应原型 Checkout.jsx 的 PendingPay。
 * 由「我的订单 · 待支付」进入。倒计时 + 收货地址 + 订单商品 + 金额 + 取消/去支付。
 * 「去支付」走支付成功页（无真实微信支付）；「取消」确认后返回。
 */
import { ref, computed, onUnmounted } from 'vue'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import AddressBlock from '@/components/AddressBlock.vue'
import OrderItem from '@/components/OrderItem.vue'
import PriceSummary from '@/components/PriceSummary.vue'
import { useAddressStore } from '@/store/address.js'
import { PENDING_ORDER as O, COUPON, SHIP } from '@/data/orders.js'
import { goBack } from '@/utils/nav.js'
import { money } from '@/utils/format.js'
import { useTimers } from '@/composables/useTimers.js'

const { later } = useTimers()
const address = useAddressStore()
const addr = computed(() => address.defaultAddress)
const goods = O.price * (O.qty || 1)
const pay = Math.max(0, goods + SHIP - COUPON)
const secs = ref(15 * 60 - 1)
const expired = ref(false)
const timer = setInterval(() => {
  if (secs.value > 0) {
    secs.value -= 1
  } else {
    // 倒计时归零：兑现「超时订单将自动取消」的文案 —— 停表、置过期态、禁支付、提示并返回
    clearInterval(timer)
    expired.value = true
    uni.showToast({ title: '订单已超时取消', icon: 'none' })
    later(back, 1500)
  }
}, 1000)
onUnmounted(() => clearInterval(timer))
const mmss = computed(() => {
  const m = String(Math.floor(secs.value / 60)).padStart(2, '0')
  const s = String(secs.value % 60).padStart(2, '0')
  return `${m}:${s}`
})

const back = () => goBack('/pages/me/index')
function cancel() {
  uni.showModal({
    title: '取消订单',
    content: '确定要取消这个订单吗？',
    confirmText: '确定',
    cancelText: '再想想',
    success: (r) => {
      if (r.confirm) {
        uni.showToast({ title: '订单已取消', icon: 'none' })
        later(back, 300)
      }
    },
  })
}
function gopay() {
  if (expired.value) return
  uni.redirectTo({ url: `/pages/paysuccess/index?amount=${pay.toFixed(2)}` })
}
</script>

<template>
  <view class="co">
    <CoNavBar title="待支付" @back="back" />

    <view class="co-body">
      <!-- 倒计时 -->
      <view class="copend-count">
        <Icon name="clock-orange" :size="19" />
        <text class="copend-count-text">请在 <text class="t">{{ mmss }}</text> 内完成支付</text>
        <text class="copend-count-sub">超时订单将自动取消</text>
      </view>

      <!-- 收货地址（只读） -->
      <AddressBlock :address="addr" />

      <!-- 订单商品（只读） -->
      <view class="co-card">
        <view class="co-shop">
          <Icon name="store" :size="17" />
          <text class="co-shop-name">易织™小棉鸭® 官方旗舰店</text>
          <view class="co-shop-chev"><Icon name="chevron-right" :size="16" /></view>
        </view>
        <OrderItem :name="O.name" :spec="O.spec" :price="O.price" :qty="O.qty || 1" />
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
      <PriceSummary :goods="goods" :coupon="COUPON" :total="pay" total-label="需付款" />
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-dock-total">
        <text class="co-dock-small">需付款</text>
        <text class="co-dock-amt"><text class="cny">￥</text>{{ money(pay) }}</text>
      </view>
      <view class="co-cancel" @tap="cancel">取消订单</view>
      <view class="co-submit" :class="{ disabled: expired }" @tap="gopay">{{ expired ? '已超时' : '去支付' }}</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 横排底部坞 */
.co-dock {
  display: flex;
  align-items: center;
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

/* 横排坞按钮 */
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
.co-submit.disabled {
  background: $line-strong;
  color: $content-2;
}
</style>
