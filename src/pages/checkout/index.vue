<script setup>
/**
 * 提交订单（结算）页。对应原型 Checkout.jsx。
 * 入口：购物车「去结算」(多件) 或 详情页「立即购买」(单件)，
 * 下单清单由 cart store 的「结算草稿」(checkoutItems) 传入，本页快照到本地可改数量。
 *
 * 结构：地址 → 店铺+订单商品 → 搭配购买 → 配送/优惠/积分/备注 → 金额明细 → 固定提交坞。
 * 金额随商品数量、搭配勾选实时联动。
 *
 * 图位走 MediaSlot 灰占位；强调色用 $purple。公共 co- 样式见 styles/co.scss。
 * 收货地址来自地址簿（store/address.js）：无地址→空态引导添加。
 * 配送/优惠券/积分/备注 暂为展示 + Toast 占位。
 */
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { useCartStore } from '@/store/cart.js'
import { useAddressStore } from '@/store/address.js'
import { CHECKOUT_ADDONS, COUPON, SHIP } from '@/data/checkout.js'
import { goBack } from '@/utils/nav.js'
import { money } from '@/utils/format.js'

const cart = useCartStore()
const address = useAddressStore()
const addr = computed(() => address.defaultAddress) // 来自地址簿（可能为 null）

// 下单清单：从草稿快照（本地改数量不回写购物车）；草稿为空时给个兜底样例
const fallback = [{ id: 'prod-1', name: '幸运小鸭礼盒 · 零基础钩织套装', tag: '经典暖黄', price: 198, qty: 1 }]
const list = ref(
  (cart.checkoutItems.length ? cart.checkoutItems : fallback).map((it) => ({ ...it, qty: it.qty || 1 })),
)
const addons = ref(CHECKOUT_ADDONS.map((a) => ({ ...a, qty: 1 })))

const infoRows = [
  { key: '配送方式', val: '顺丰速运 · 包邮', cls: '' },
  { key: '优惠券', val: '-￥20.00', cls: 'accent' },
  { key: '幸运积分', val: '可用 320 · 暂不使用', cls: 'muted' },
  { key: '订单备注', val: '选填，给商家留言', cls: 'muted' },
]

const goods = computed(
  () =>
    list.value.reduce((s, it) => s + it.price * it.qty, 0) +
    addons.value.reduce((s, a) => s + (a.on ? a.price * a.qty : 0), 0),
)
const pay = computed(() => Math.max(0, goods.value + SHIP - COUPON))
const count = computed(
  () =>
    list.value.reduce((s, it) => s + it.qty, 0) +
    addons.value.reduce((s, a) => s + (a.on ? a.qty : 0), 0),
)
function setItemQty(i, v) {
  list.value[i].qty = Math.max(1, v)
}
function toggleAddon(i) {
  addons.value[i].on = !addons.value[i].on
}
function setAddonQty(i, v) {
  addons.value[i].qty = Math.max(1, v)
}
const back = () => goBack('/pages/index/index')
function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
// 地址：有默认地址→去地址管理(选/改)；无→去新增
function goAddress() {
  uni.navigateTo({ url: addr.value ? '/pages/address/index' : '/pages/address-edit/index' })
}
function onSubmit() {
  if (!addr.value) {
    uni.showToast({ title: '请先添加收货地址', icon: 'none' })
    uni.navigateTo({ url: '/pages/address-edit/index' })
    return
  }
  const amount = pay.value
  cart.finishCheckout() // 来自购物车的条目从车里移除
  uni.redirectTo({ url: `/pages/paysuccess/index?amount=${amount.toFixed(2)}` })
}
</script>

<template>
  <view class="co">
    <CoNavBar title="提交订单" @back="back" />

    <view class="co-body">
      <!-- 收货地址（来自地址簿；无则空态引导添加） -->
      <view class="co-addr">
        <view v-if="addr" class="co-addr-main" @tap="goAddress">
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
          <view class="co-addr-chev"><Icon name="chevron-right" :size="19" /></view>
        </view>
        <view v-else class="co-addr-main" @tap="goAddress">
          <view class="co-addr-pin"><Icon name="map-pin" :size="24" /></view>
          <view class="co-addr-text">
            <text class="co-addr-empty-title">添加收货地址</text>
            <text class="co-addr-empty-sub">请先填写收货人、手机号与详细地址</text>
          </view>
          <view class="co-addr-chev"><Icon name="chevron-right" :size="19" /></view>
        </view>
        <view class="co-stitch"></view>
      </view>

      <!-- 店铺 + 订单商品 -->
      <view class="co-card">
        <view class="co-shop">
          <Icon name="store" :size="17" />
          <text class="co-shop-name">易织™小棉鸭® 官方旗舰店</text>
          <view class="co-shop-chev"><Icon name="chevron-right" :size="16" /></view>
        </view>
        <view v-for="(it, i) in list" :key="it.id" class="co-item">
          <view class="co-item-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="co-item-mid">
            <text class="co-item-name">{{ it.name }}</text>
            <text v-if="it.tag" class="co-item-spec">{{ it.tag }}</text>
            <view class="co-item-foot">
              <text class="co-price co-item-price"><text class="cny">￥</text>{{ money(it.price) }}</text>
              <view class="co-stepper">
                <view class="co-step-btn" @tap="setItemQty(i, it.qty - 1)">−</view>
                <text class="co-step-n">{{ it.qty }}</text>
                <view class="co-step-btn" @tap="setItemQty(i, it.qty + 1)">＋</view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 搭配购买 -->
      <view class="co-card">
        <view class="co-addon-head">
          <text class="co-addon-title">搭配购买</text>
          <text class="co-addon-sub">一起买更划算</text>
        </view>
        <view v-for="(a, i) in addons" :key="a.id" class="co-addon" :class="{ divided: i > 0 }">
          <view class="co-radio" :class="{ on: a.on }" @tap="toggleAddon(i)">
            <Icon v-if="a.on" name="check" :size="12" />
          </view>
          <view class="co-addon-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="co-addon-mid">
            <text class="co-addon-name">{{ a.name }}</text>
            <view class="co-addon-foot">
              <text class="co-price co-addon-price"><text class="cny">￥</text>{{ money(a.price) }}</text>
              <view class="co-stepper">
                <view class="co-step-btn" @tap="setAddonQty(i, a.qty - 1)">−</view>
                <text class="co-step-n">{{ a.qty }}</text>
                <view class="co-step-btn" @tap="setAddonQty(i, a.qty + 1)">＋</view>
              </view>
            </view>
          </view>
        </view>
      </view>

      <!-- 配送 / 优惠券 / 积分 / 备注 -->
      <view class="co-card">
        <view
          v-for="(r, i) in infoRows"
          :key="r.key"
          class="co-row"
          :class="{ divided: i > 0 }"
          @tap="toast('（开发中）')"
        >
          <text class="co-row-key">{{ r.key }}</text>
          <text class="co-row-val" :class="r.cls">{{ r.val }}</text>
          <view class="co-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
      </view>

      <!-- 金额明细 -->
      <view class="co-card">
        <view class="co-summary">
          <view class="co-sum-row">
            <text class="co-sum-k">商品金额</text><text class="co-sum-b">￥{{ money(goods) }}</text>
          </view>
          <view class="co-sum-row">
            <text class="co-sum-k">运费</text>
            <text class="co-sum-b">{{ SHIP === 0 ? '￥0.00（包邮）' : '￥' + money(SHIP) }}</text>
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

    <!-- 给提交坞让位 -->
    <view class="co-foot"></view>

    <!-- 固定提交坞 -->
    <view class="co-dock">
      <view class="co-dock-total">
        <text class="co-dock-small">合计</text>
        <view class="co-dock-amount">
          <text class="co-dock-amt"><text class="cny">￥</text>{{ money(pay) }}</text>
          <text class="co-dock-count">共 {{ count }} 件</text>
        </view>
      </view>
      <view class="co-submit" @tap="onSubmit">提交订单</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 横排底部坞（提交按钮靠右） */
.co-dock {
  display: flex;
  align-items: center;
}
.co-dock-amount {
  display: flex;
  align-items: baseline;
}
.co-dock-count {
  font-size: 12px;
  color: $content-2;
  font-family: $font-sans;
  margin-left: 8px;
}
.co-submit {
  margin-left: auto;
  flex: 0 0 auto;
  background: $purple;
  color: $white;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 16px;
  padding: 14px 34px;
}
.co-submit:active {
  opacity: 0.94;
}

/* 信息行 · 优惠券强调（红色） */
.co-row-val.accent {
  color: $red;
  font-family: $font-sans;
  font-weight: 600;
}

/* 数量步进器（文字 −/＋，跨端稳） */
.co-stepper {
  display: flex;
  align-items: center;
  border: 0.5px solid $line-strong;
  border-radius: $r-pill;
  overflow: hidden;
  height: 26px;
}
.co-step-btn {
  width: 30px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  color: $ink;
}
.co-step-btn:active {
  background: $bg-grey;
}
.co-step-n {
  min-width: 34px;
  text-align: center;
  font-family: $font-sans;
  font-size: 14px;
  color: $ink;
  line-height: 26px;
  border-left: 0.5px solid $line-strong;
  border-right: 0.5px solid $line-strong;
}

/* 搭配购买 */
.co-addon-head {
  display: flex;
  align-items: baseline;
  padding: 14px 16px 2px;
}
.co-addon-title {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $ink;
}
.co-addon-sub {
  font-size: 12px;
  color: $duck-orange;
  margin-left: 8px;
}
.co-addon {
  display: flex;
  align-items: center;
  padding: 12px 16px;
}
.co-addon.divided {
  border-top: 0.5px solid $line-soft;
}
.co-radio {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid $line-strong;
  background: $white;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
}
.co-radio.on {
  background: $purple;
  border-color: $purple;
}
.co-addon-img {
  width: 56px;
  height: 56px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.co-addon-mid {
  flex: 1 1 auto;
  min-width: 0;
}
.co-addon-name {
  font-size: 14px;
  color: $ink;
  line-height: 1.3;
}
.co-addon-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 9px;
}
.co-addon-price {
  font-size: 15px;
}
</style>
