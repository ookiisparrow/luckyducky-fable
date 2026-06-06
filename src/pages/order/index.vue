<script setup>
/**
 * 订单状态页（待发货 / 待收货 / 已完成）。对应原型 Checkout.jsx 的 OrderStatus。
 * 由 query.status 驱动（toship/toreceive/done），数据在 data/orders.js。
 * 收货地址读地址簿默认地址（只读展示）。底部动作按钮：
 *   提醒发货/查看物流/已提醒 → Toast；确认收货 → 弹确认；再次购买 → 进详情；
 *   申请退款/评价晒单 → 暂 Toast（下一块接 售后/评价 页）。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { useAddressStore } from '@/store/address.js'
import { ORDER_CFG, COUPON, SHIP } from '@/data/orders.js'

const address = useAddressStore()
const status = ref('toship')
const cfg = computed(() => ORDER_CFG[status.value] || ORDER_CFG.toship)
const addr = computed(() => address.defaultAddress)

onLoad((q) => {
  if (q && q.status && ORDER_CFG[q.status]) status.value = q.status
})

const goods = computed(() => cfg.value.items.reduce((s, it) => s + it.price * (it.qty || 1), 0))
const pay = computed(() => Math.max(0, goods.value + SHIP - COUPON))
const money = (n) => Number(n).toFixed(2)

function back() {
  const p = getCurrentPages()
  if (p.length > 1) uni.navigateBack()
  else uni.reLaunch({ url: '/pages/me/index' })
}
function onAction(a) {
  const k = a.key
  if (k === 'confirm') {
    uni.showModal({
      title: '确认收货',
      content: '确认已收到商品吗？',
      success: (r) => {
        if (r.confirm) uni.showToast({ title: '已确认收货 · 期待你的好评~', icon: 'none' })
      },
    })
  } else if (k === 'rebuy') {
    uni.navigateTo({ url: `/pages/detail/index?id=prod-1&name=${encodeURIComponent('幸运小鸭礼盒')}` })
  } else if (k === 'remind') {
    uni.showToast({ title: '已提醒商家发货', icon: 'none' })
  } else if (k === 'logi') {
    uni.showToast({ title: '物流详情（开发中）', icon: 'none' })
  } else if (k === 'refund') {
    uni.navigateTo({ url: '/pages/aftersales/index' })
  } else if (k === 'review') {
    uni.navigateTo({ url: '/pages/review/index' })
  }
}
</script>

<template>
  <view class="co">
    <view class="co-header">
      <view class="co-nav">
        <view class="co-nav-btn" @tap="back"><Icon name="chevron-left-ink" :size="22" /></view>
        <text class="co-nav-title">{{ cfg.title }}</text>
        <view class="co-nav-spacer"></view>
      </view>
    </view>

    <view class="co-body">
      <!-- 状态横幅 -->
      <view class="coord-banner" :class="'coord-' + cfg.tint">
        <view class="coord-banner-ico"><Icon :name="cfg.icon" :size="22" /></view>
        <view class="coord-banner-text">
          <text class="coord-banner-head">{{ cfg.head }}</text>
          <text class="coord-banner-sub">{{ cfg.sub }}</text>
        </view>
      </view>

      <!-- 物流（待收货） -->
      <view v-if="cfg.logi" class="co-card coord-logi" @tap="onAction({ key: 'logi' })">
        <view class="coord-logi-ico"><Icon name="map-pin" :size="16" /></view>
        <view class="coord-logi-text">
          <text class="coord-logi-line">{{ cfg.logi.text }}</text>
          <text class="coord-logi-time">{{ cfg.logi.time }}</text>
        </view>
        <view class="co-row-chev"><Icon name="chevron-right" :size="18" /></view>
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

      <!-- 订单商品（只读 ×N） -->
      <view class="co-card">
        <view class="co-shop">
          <Icon name="store" :size="17" />
          <text class="co-shop-name">易织™小棉鸭® 官方旗舰店</text>
          <view class="co-shop-chev"><Icon name="chevron-right" :size="16" /></view>
        </view>
        <view v-for="(it, i) in cfg.items" :key="i" class="co-item">
          <view class="co-item-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="co-item-mid">
            <text class="co-item-name">{{ it.name }}</text>
            <text v-if="it.spec" class="co-item-spec">{{ it.spec }}</text>
            <view class="co-item-foot">
              <text class="co-price co-item-price"><text class="cny">￥</text>{{ money(it.price) }}</text>
              <text class="co-item-qty">×{{ it.qty || 1 }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 订单信息 -->
      <view class="co-card">
        <view v-for="(row, i) in cfg.info" :key="i" class="co-row" :class="{ divided: i > 0 }">
          <text class="co-row-key">{{ row[0] }}</text>
          <text class="co-row-val muted">{{ row[1] }}</text>
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
            <text class="co-sum-k">实付款</text>
            <text class="co-sum-b"><text class="cny">￥</text>{{ money(pay) }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-dock-total">
        <text class="co-dock-small">实付款</text>
        <text class="co-dock-amt"><text class="cny">￥</text>{{ money(pay) }}</text>
      </view>
      <view
        v-for="(a, i) in cfg.actions"
        :key="i"
        :class="a.kind === 'solid' ? 'co-submit' : 'co-cancel'"
        @tap="onAction(a)"
        >{{ a.label }}</view
      >
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

/* 状态横幅 */
.coord-banner {
  display: flex;
  align-items: center;
  border-radius: $r-md;
  padding: 18px 16px;
  margin-bottom: 12px;
}
.coord-banner.coord-lilac {
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
}
.coord-banner.coord-sage {
  background: $bg-sage;
  border: 0.5px solid #dde0d6;
}
.coord-banner-ico {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: $white;
  margin-right: 13px;
}
.coord-banner-text {
  min-width: 0;
}
.coord-banner-head {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 16px;
  color: $ink;
}
.coord-banner-sub {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  line-height: 1.5;
  margin-top: 4px;
}

/* 物流 */
.coord-logi {
  display: flex;
  align-items: center;
  padding: 14px;
}
.coord-logi-ico {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: $bg-lilac;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 11px;
}
.coord-logi-text {
  flex: 1 1 auto;
  min-width: 0;
}
.coord-logi-line {
  display: block;
  font-size: 13px;
  color: $ink;
  line-height: 1.45;
}
.coord-logi-time {
  display: block;
  font-family: $font-sans;
  font-size: 11px;
  color: $content-2;
  margin-top: 4px;
}
.co-row-chev {
  display: flex;
  flex: 0 0 auto;
}

/* 收货地址（只读，复用结算样式） */
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
