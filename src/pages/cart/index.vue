<script setup>
/**
 * 购物车页。对应原型 Sections.jsx 的 CartScreen（方案 B 白底风格）+ CheckoutBar。
 * 状态由 store/cart.js 真实驱动：
 *   - 空车 → 空态文案 + 看看推荐
 *   - 有货 → 条目列表（选择/数量增减）+ 浮动「去结算」栏
 * 两态都展示「为你推荐」，点 ＋ 加入购物车（可借此把空车填满）。
 *
 * 图位走 MediaSlot 灰占位；强调色用 $purple（与详情页一致）。
 * 「去结算」暂为 Toast 占位 —— 结算页是下一步。
 */
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import QuantityStepper from '@/components/QuantityStepper.vue'
import TabBar from '@/components/TabBar.vue'
import { useCartStore } from '@/store/cart.js'
import { CART_RECS } from '@/data/cart.js'

const cart = useCartStore()

function goShop() {
  uni.reLaunch({ url: '/pages/index/index' })
}
function addRec(r) {
  cart.add(r)
  uni.showToast({ title: '已加入购物车', icon: 'none' })
}
// 数量减：到 1 再减 → 确认后移除（标准电商做法）
function dec(it) {
  if (it.qty <= 1) {
    uni.showModal({
      title: '移除商品',
      content: `确定从购物车移除「${it.name}」吗？`,
      confirmText: '移除',
      success: (r) => {
        if (r.confirm) cart.remove(it.id)
      },
    })
  } else {
    cart.setQty(it.id, it.qty - 1)
  }
}
function onCheckout() {
  if (cart.selectedCount === 0) {
    uni.showToast({ title: '请先选择商品', icon: 'none' })
    return
  }
  cart.prepareCheckoutFromCart()
  uni.navigateTo({ url: '/pages/checkout/index' })
}
</script>

<template>
  <view class="ld-cart">
    <view class="ld-cart-top">
      <text class="ld-cart-top-title">购物车</text>
    </view>

    <!-- 空车 -->
    <view v-if="cart.isEmpty" class="ld-cart-empty">
      <text class="ld-cart-empty-h">购物车空空的</text>
      <text class="ld-cart-empty-p">还没有心动的小棉鸭～</text>
      <view class="ld-cart-link" @tap="goShop">
        <text>看看推荐</text><Icon name="arrow-right-purple" :size="16" />
      </view>
    </view>

    <!-- 有货：条目列表 -->
    <view v-else class="ld-cart-list">
      <view v-for="it in cart.items" :key="it.id" class="ld-cart-item">
        <view class="ld-cart-check" :class="{ on: it.selected }" @tap="cart.toggle(it.id)">
          <Icon v-if="it.selected" name="check" :size="13" />
        </view>
        <view class="ld-cart-item-img"><MediaSlot ratio="1/1" :radius="9" /></view>
        <view class="ld-cart-item-mid">
          <text class="ld-cart-item-name">{{ it.name }}</text>
          <text v-if="it.tag" class="ld-cart-item-tag">{{ it.tag }}</text>
          <view class="ld-cart-item-foot">
            <view class="ld-cart-item-pricegrp">
              <text v-if="it.was" class="ld-cart-was">￥{{ it.was }}</text>
              <text class="ld-cart-item-price">￥{{ it.price }}</text>
            </view>
            <QuantityStepper
              :n="it.qty"
              size="md"
              @dec="dec(it)"
              @inc="cart.setQty(it.id, it.qty + 1)"
            />
          </view>
        </view>
      </view>
    </view>
    <view v-if="!cart.isEmpty" class="ld-cart-hr"></view>

    <!-- 为你推荐（两态共用） -->
    <text class="ld-cart-divider-label">为你推荐</text>
    <view class="ld-cart-recs">
      <view v-for="r in CART_RECS" :key="r.id" class="ld-cart-rec">
        <MediaSlot ratio="1/1" />
        <view class="ld-cart-rec-body">
          <text class="ld-cart-rec-name">{{ r.name }}</text>
          <text class="ld-cart-rec-tag">{{ r.tag }}</text>
          <view class="ld-cart-rec-foot">
            <view class="ld-cart-pricegrp">
              <text class="ld-cart-was">￥{{ r.was }}</text>
              <text class="ld-cart-now">￥{{ r.price }}</text>
            </view>
            <view class="ld-add" @tap="addRec(r)"><Icon name="plus" :size="18" /></view>
          </view>
        </view>
      </view>
    </view>

    <!-- 给 TabBar（有货时再加结算栏）让位 -->
    <view class="ld-cart-foot" :class="{ 'is-filled': !cart.isEmpty }"></view>

    <!-- 浮动结算栏 -->
    <view v-if="!cart.isEmpty" class="ld-checkbar">
      <view class="ld-selall" @tap="cart.toggleAll()">
        <view class="ld-cart-check sm" :class="{ on: cart.allSelected }">
          <Icon v-if="cart.allSelected" name="check" :size="12" />
        </view>
        <text>全选</text>
      </view>
      <view class="ld-checkbar-total">
        <text class="ld-checkbar-total-label">合计</text>
        <text class="ld-checkbar-total-num">￥{{ cart.selectedTotal }}</text>
      </view>
      <view class="ld-checkout-btn" @tap="onCheckout">去结算 ({{ cart.selectedCount }})</view>
    </view>

    <TabBar active="cart" />
  </view>
</template>

<style lang="scss" scoped>
.ld-cart {
  min-height: 100vh;
  background: $white;
  font-family: $font-cn;
}

/* 顶部标题（含状态栏安全区） */
.ld-cart-top {
  padding: calc(14px + env(safe-area-inset-top)) 20px 8px;
}
.ld-cart-top-title {
  font-family: $font-display;
  font-weight: 700;
  font-size: 22px;
  color: $ink;
}

/* ---------- 空车 ---------- */
.ld-cart-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 56px 36px 28px;
}
.ld-cart-empty-h {
  font-family: $font-display;
  font-weight: 500;
  font-size: 24px;
  color: $ink;
}
.ld-cart-empty-p {
  font-size: 14px;
  line-height: 1.65;
  color: $content-2;
  margin-top: 12px;
}
.ld-cart-link {
  display: flex;
  align-items: center;
  color: $purple;
  font-weight: 600;
  font-size: 15px;
  padding: 8px;
  margin-top: 12px;
}
.ld-cart-link text {
  margin-right: 6px;
}
.ld-cart-link:active {
  opacity: 0.55;
}

/* ---------- 有货：条目 ---------- */
.ld-cart-list {
  padding: 4px 20px 0;
}
.ld-cart-item {
  display: flex;
  align-items: center;
  margin-bottom: 14px;
}
.ld-cart-check {
  width: 21px;
  height: 21px;
  border-radius: 50%;
  border: 1.5px solid $line-strong;
  background: $white;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 12px;
}
.ld-cart-check.on {
  background: $purple;
  border-color: $purple;
}
.ld-cart-check.sm {
  width: 19px;
  height: 19px;
  margin-right: 0;
}
.ld-cart-item-img {
  width: 74px;
  height: 74px;
  border-radius: $r-md;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.ld-cart-item-mid {
  flex: 1 1 auto;
  min-width: 0;
}
.ld-cart-item-name {
  display: block;
  font-size: 15px;
  color: $ink;
  line-height: 1.3;
}
.ld-cart-item-tag {
  display: inline-block;
  font-size: 11px;
  color: $purple-meta;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
  border-radius: 4px;
  padding: 2px 7px;
  margin-top: 5px;
}
.ld-cart-item-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 9px;
}
.ld-cart-item-pricegrp {
  display: flex;
  align-items: baseline;
}
.ld-cart-item-pricegrp .ld-cart-was {
  margin-right: 7px;
}
.ld-cart-item-price {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 17px;
  color: $ink;
}
/* 数量步进器：见 components/QuantityStepper.vue（size="md"） */
.ld-cart-hr {
  height: 1px;
  background: $line;
  margin: 20px 20px 4px;
}

/* ---------- 为你推荐 ---------- */
.ld-cart-divider-label {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 18px;
  color: $ink;
  padding: 0 20px;
  margin: 6px 0 14px;
}
.ld-cart-recs {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 0 20px;
}
.ld-cart-rec {
  width: calc(50% - 6px);
  box-sizing: border-box;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-sm;
  overflow: hidden;
  margin-bottom: 12px;
}
.ld-cart-rec:active {
  transform: scale(0.985);
}
.ld-cart-rec-body {
  padding: 10px 12px 12px;
}
.ld-cart-rec-name {
  display: block;
  font-size: 14px;
  color: $ink;
  line-height: 1.3;
}
.ld-cart-rec-tag {
  display: block;
  font-size: 12px;
  color: $content-2;
  margin-top: 3px;
}
.ld-cart-rec-foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: 9px;
}
.ld-cart-pricegrp {
  display: flex;
  flex-direction: column;
  line-height: 1.05;
}
.ld-cart-was {
  font-family: $font-sans;
  font-size: 11px;
  color: $content-2;
  text-decoration: line-through;
}
.ld-cart-now {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 18px;
  color: $ink;
}
.ld-add {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: $purple;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}
.ld-add:active {
  opacity: 0.85;
}

/* ---------- 底部让位 + 浮动结算栏 ---------- */
.ld-cart-foot {
  height: calc(96px + env(safe-area-inset-bottom));
}
.ld-cart-foot.is-filled {
  height: calc(152px + env(safe-area-inset-bottom));
}
.ld-checkbar {
  position: fixed;
  left: 16px;
  right: 16px;
  bottom: calc(84px + env(safe-area-inset-bottom));
  z-index: 31;
  display: flex;
  align-items: center;
  background: $white;
  border-radius: 22px;
  box-shadow: $shadow-tab;
  padding: 9px 12px 9px 16px;
}
.ld-selall {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: $content;
}
.ld-selall text {
  margin-left: 7px;
}
.ld-checkbar-total {
  margin-left: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.05;
}
.ld-checkbar-total-label {
  font-size: 11px;
  color: $content-2;
}
.ld-checkbar-total-num {
  font-family: $font-sans;
  font-weight: 700;
  font-size: 19px;
  color: $ink;
}
.ld-checkout-btn {
  margin-left: 12px;
  background: $purple;
  color: $white;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 15px;
  padding: 12px 22px;
}
.ld-checkout-btn:active {
  opacity: 0.9;
}
</style>
