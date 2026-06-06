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
import { goBack } from '@/utils/nav.js'
import { money } from '@/utils/format.js'

const address = useAddressStore()
const addr = computed(() => address.defaultAddress)
const goods = O.price * (O.qty || 1)
const pay = Math.max(0, goods + SHIP - COUPON)
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
</style>
