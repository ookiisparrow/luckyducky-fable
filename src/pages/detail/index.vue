<script setup>
/**
 * 商品详情页（方案 A 经典电商）。对应原型 主版本/ProductDetail.jsx。
 * 由首页产品卡点击进入（uni.navigateTo，带 id/name）。
 *
 * 结构：浮层返回/分享（盖在画廊上）→ 画廊+缩略 → 价格卡 → 规格/服务
 *      → 难度/耗时 → 评价（评分分布+标签+前2条）→ 图文详情 → 套装包含
 *      → 为你推荐 → 固定底部购买坞。
 *
 * 图位一律走 MediaSlot 灰占位（项目约定：非 hero 全灰占位）。
 * 数据来自 src/data/productDetail.js（现为样例；以后换 api/shop.js）。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import RatingSummary from '@/components/RatingSummary.vue'
import ReviewItem from '@/components/ReviewItem.vue'
import { PRODUCT_DETAIL as PD } from '@/data/productDetail.js'
import { getProduct } from '@/data/catalog.js'
import { useCartStore } from '@/store/cart.js'
import { goBack } from '@/utils/nav.js'

const cart = useCartStore()
const sel = ref(0) // 当前选中的画廊图
// 商品身份按 id 从总表(catalog)取，单一来源；取不到时退回 PD 样例兜底。
// 描述性内容（规格/评价/图文/套装）仍是共用样例。
const pid = ref('prod-1')
const title = ref(PD.title)
const price = ref(PD.price)
const was = ref(PD.was)
const tag = ref(PD.tag)

onLoad((q) => {
  const id = (q && q.id) || pid.value
  pid.value = id
  const p = getProduct(id)
  if (p) {
    title.value = p.name
    price.value = p.price
    was.value = p.was
    tag.value = p.tag
  } else if (q && q.name) {
    title.value = decodeURIComponent(q.name)
  }
})

// 加入购物车：真正写进 cart store（用按 id 取到的身份）
function addToCart() {
  cart.add({ id: pid.value, name: title.value, tag: tag.value, price: price.value, was: was.value })
  uni.showToast({ title: '已加入购物车', icon: 'none' })
}
// 立即购买：单件进结算草稿，直接去结算页（不影响购物车）
function buyNow() {
  cart.prepareBuyNow({ id: pid.value, name: title.value, tag: tag.value, price: price.value, was: was.value })
  uni.navigateTo({ url: '/pages/checkout/index' })
}

const back = () => goBack('/pages/index/index')
function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
function goReviews() {
  uni.navigateTo({ url: '/pages/reviews/index' })
}
</script>

<template>
  <view class="pdp">
    <!-- 浮层头：返回 / 分享（盖在画廊上，含安全区） -->
    <view class="pdp-float">
      <view class="pdp-float-btn" @tap="back"><Icon name="chevron-left" :size="22" /></view>
      <view class="pdp-float-btn" @tap="toast('分享（敬请期待）')">
        <Icon name="share-2" :size="20" />
      </view>
    </view>

    <!-- 画廊 -->
    <view class="pdp-gallery">
      <view class="pdp-gallery-scrim"></view>
      <MediaSlot ratio="1/1" label="放入图片" />
      <text class="pdp-count">{{ sel + 1 }}/{{ PD.galleryCount }}</text>
      <view class="pdp-thumbs">
        <view
          v-for="i in PD.galleryCount"
          :key="i"
          class="pdp-thumb"
          :class="{ on: sel === i - 1 }"
          @tap="sel = i - 1"
        >
          <MediaSlot ratio="1/1" :radius="5" />
        </view>
      </view>
    </view>

    <!-- 价格卡 -->
    <view class="pdp-card pdp-price">
      <view class="pdp-price-row">
        <text class="pdp-price-now"><text class="cny">￥</text>{{ price }}</text>
        <text class="pdp-price-was">￥{{ was }}</text>
        <text class="pdp-badge-ship">{{ PD.ship }}</text>
      </view>
      <text class="pdp-title">{{ title }}</text>
      <text class="pdp-sub">{{ PD.sub }}</text>
      <view class="pdp-meta">
        <view v-for="(m, i) in PD.meta" :key="i" class="pdp-meta-cell">
          <text class="pdp-meta-v">{{ m.v }}</text>
          <text class="pdp-meta-k">{{ m.k }}</text>
        </view>
      </view>
    </view>

    <!-- 规格 + 服务 -->
    <view class="pdp-card pdp-rows">
      <view class="pdp-row" @tap="toast('选择规格（敬请期待）')">
        <text class="pdp-row-key">已选</text>
        <text class="pdp-row-val">{{ PD.spec }}</text>
        <Icon name="chevron-right" :size="18" />
      </view>
      <view class="pdp-row" @tap="toast('服务说明（敬请期待）')">
        <text class="pdp-row-key">服务</text>
        <view class="pdp-svc">
          <view v-for="(s, i) in PD.services" :key="i" class="pdp-svc-item">
            <Icon name="check-on" :size="14" /><text>{{ s }}</text>
          </view>
        </view>
        <Icon name="chevron-right" :size="18" />
      </view>
    </view>

    <!-- 难度 / 耗时 / 适合人群 -->
    <view class="pdp-card pdp-stats">
      <view class="pdp-stat">
        <text class="pdp-stat-label">{{ PD.difficulty.label }}</text>
        <view class="pdp-dots">
          <view
            v-for="d in PD.difficulty.total"
            :key="d"
            class="pdp-dot"
            :class="{ on: d <= PD.difficulty.dots }"
          ></view>
        </view>
        <text class="pdp-stat-val">{{ PD.difficulty.val }}</text>
      </view>
      <view v-for="(s, i) in PD.stats" :key="i" class="pdp-stat">
        <Icon :name="s.icon" :size="19" />
        <text class="pdp-stat-label">{{ s.label }}</text>
        <text class="pdp-stat-val">{{ s.val }}</text>
      </view>
    </view>

    <!-- 评价 -->
    <view class="pdp-sec">
      <view class="pdp-sec-head">
        <text class="pdp-sec-title">用户评价</text>
        <view class="pdp-sec-more" @tap="goReviews">
          <text>全部 {{ PD.rating.count }} 条</text><Icon name="chevron-right" :size="14" />
        </view>
      </view>
      <RatingSummary :rating="PD.rating" />
      <ReviewItem v-for="(r, i) in PD.reviews" :key="i" :review="r" divided />
    </view>

    <!-- 图文详情 -->
    <view class="pdp-sec">
      <view class="pdp-sec-head"><text class="pdp-sec-title">商品详情</text></view>
      <view class="pdp-detail">
        <view class="pdp-param">
          <view
            v-for="([k, v], i) in PD.params"
            :key="i"
            class="pdp-param-row"
            :class="{ last: i === PD.params.length - 1 }"
          >
            <text class="pdp-param-dt">{{ k }}</text>
            <text class="pdp-param-dd">{{ v }}</text>
          </view>
        </view>

        <view v-for="(d, i) in PD.detailSections" :key="i">
          <text class="pdp-detail-lead">{{ d.lead }}</text>
          <text class="pdp-detail-p">{{ d.body }}</text>
          <view class="pdp-detail-img"><MediaSlot ratio="4/3" :radius="5" label="放入图片" /></view>
        </view>
      </view>
    </view>

    <!-- 套装包含 -->
    <view class="pdp-sec">
      <view class="pdp-sec-head"><text class="pdp-sec-title">套装包含</text></view>
      <view class="pdp-kit">
        <view v-for="(k, i) in PD.kit" :key="i" class="pdp-kit-cell">
          <view class="pdp-kit-ico"><Icon :name="k.icon" :size="19" /></view>
          <view class="pdp-kit-text">
            <text class="pdp-kit-name">{{ k.name }}</text>
            <text class="pdp-kit-qty">{{ k.qty }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 为你推荐 -->
    <view class="pdp-sec pdp-sec-last">
      <view class="pdp-sec-head"><text class="pdp-sec-title">为你推荐</text></view>
      <view class="pdp-recs">
        <view
          v-for="(p, i) in PD.recs"
          :key="i"
          class="pdp-rec"
          @tap="toast(`${p.name}（敬请期待）`)"
        >
          <MediaSlot ratio="1/1" />
          <view class="pdp-rec-body">
            <text class="pdp-rec-name">{{ p.name }}</text>
            <view class="pdp-rec-foot">
              <text class="pdp-rec-now">￥{{ p.price }}</text>
              <text class="pdp-rec-was">￥{{ p.was }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 给固定购买坞让位 -->
    <view class="pdp-foot"></view>

    <!-- 固定底部购买坞 -->
    <view class="pdp-dock">
      <view class="pdp-buy-ico" @tap="toast('正在接入人工客服…')">
        <Icon name="headphones" :size="21" /><text>客服</text>
      </view>
      <view class="pdp-buy-ico" @tap="toast('已收藏')">
        <Icon name="star" :size="21" /><text>收藏</text>
      </view>
      <view class="pdp-buy-actions">
        <view class="pdp-btn pdp-btn-cart" @tap="addToCart">加入购物车</view>
        <view class="pdp-btn pdp-btn-buy" @tap="buyNow">立即购买</view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pdp {
  position: relative;
  min-height: 100vh;
  background: $bg-grey; // 浅灰底，衬出白色区块卡
  font-family: $font-cn;
  color: $content;
}

/* ---------- 浮层头 ---------- */
.pdp-float {
  position: absolute;
  top: calc(14px + env(safe-area-inset-top));
  left: 12px;
  right: 12px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pdp-float-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pdp-float-btn:active {
  background: rgba(0, 0, 0, 0.5);
}

/* ---------- 画廊 ---------- */
.pdp-gallery {
  position: relative;
  background: $white;
}
.pdp-gallery-scrim {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 150px;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.42), rgba(0, 0, 0, 0));
}
.pdp-count {
  position: absolute;
  right: 14px;
  bottom: 88px;
  background: rgba(0, 0, 0, 0.5);
  color: $white;
  font-family: $font-sans;
  font-size: 12px;
  padding: 4px 11px;
  border-radius: $r-pill;
  letter-spacing: 0.03em;
}
.pdp-thumbs {
  display: flex;
  padding: 12px 16px 16px;
  overflow-x: auto;
  white-space: nowrap;
}
.pdp-thumb {
  box-sizing: border-box;
  width: 60px;
  height: 60px;
  flex: 0 0 auto;
  margin-right: 8px;
  border-radius: $r-sm;
  border: 2px solid transparent;
  overflow: hidden;
}
.pdp-thumb.on {
  border-color: $purple;
}

/* ---------- 区块卡通用 ---------- */
.pdp-card {
  background: $white;
  margin-bottom: 10px;
}

/* 价格卡 */
.pdp-price {
  padding: 18px 20px 16px;
}
.pdp-price-row {
  display: flex;
  align-items: flex-end;
}
.pdp-price-now {
  font-family: $font-sans;
  font-weight: 700;
  font-size: 30px;
  color: $ink;
  line-height: 1;
}
.pdp-price-now .cny {
  font-size: 18px;
  font-weight: 600;
}
.pdp-price-was {
  font-family: $font-sans;
  font-size: 14px;
  color: $content-2;
  text-decoration: line-through;
  margin-left: 10px;
  padding-bottom: 2px;
}
.pdp-badge-ship {
  margin-left: auto;
  align-self: center;
  font-size: 12px;
  color: $duck-orange;
  background: $bg-cream;
  border: 0.5px solid $line-cream;
  border-radius: $r-xs;
  padding: 4px 9px;
}
.pdp-title {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 21px;
  line-height: 1.35;
  color: $ink;
  margin-top: 12px;
}
.pdp-sub {
  display: block;
  font-size: 13.5px;
  color: $content-2;
  line-height: 1.5;
  margin-top: 7px;
}
.pdp-meta {
  display: flex;
  margin-top: 14px;
  padding-top: 13px;
  border-top: 0.5px dashed $line;
}
.pdp-meta-cell {
  display: flex;
  flex-direction: column;
  margin-right: 18px;
}
.pdp-meta-v {
  font-family: $font-sans;
  font-size: 15px;
  font-weight: 600;
  color: $ink;
}
.pdp-meta-k {
  font-size: 11px;
  color: $content-2;
  margin-top: 2px;
}

/* 规格 / 服务行 */
.pdp-rows {
  padding: 0 20px;
}
.pdp-row {
  display: flex;
  align-items: center;
  padding: 16px 0;
  border-bottom: 0.5px solid $line-soft;
}
.pdp-row:last-child {
  border-bottom: none;
}
.pdp-row-key {
  width: 56px;
  flex: 0 0 56px;
  font-size: 14px;
  color: $content-2;
}
.pdp-row-val {
  flex: 1;
  font-size: 15px;
  color: $ink;
}
.pdp-svc {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
}
.pdp-svc-item {
  display: flex;
  align-items: center;
  margin-right: 16px;
  font-size: 12.5px;
  color: $content;
}
/* 图标在子组件内，跨端不能从父穿透；把间距放在原生 text 上 */
.pdp-svc-item text {
  margin-left: 5px;
}

/* 难度 / 耗时 / 适合人群 */
.pdp-stats {
  display: flex;
  padding: 16px 14px;
}
.pdp-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pdp-stat + .pdp-stat {
  border-left: 1px solid $line;
}
.pdp-stat-label {
  font-size: 11px;
  color: $content-2;
  margin-top: 7px;
}
.pdp-stat-val {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $ink;
  margin-top: 7px;
}
.pdp-dots {
  display: flex;
  margin-top: 7px;
}
.pdp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: $line-strong;
  margin-right: 3px;
}
.pdp-dot.on {
  background: $duck-deep;
}

/* ---------- 区块（白卡 + 标题） ---------- */
.pdp-sec {
  background: $white;
  margin-bottom: 10px;
}
.pdp-sec-last {
  margin-bottom: 0;
}
.pdp-sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 18px 20px 4px;
}
.pdp-sec-title {
  font-family: $font-display;
  font-weight: 700;
  font-size: 19px;
  color: $ink;
}
.pdp-sec-more {
  display: flex;
  align-items: center;
  font-size: 13px;
  color: $content-2;
}
.pdp-sec-more text {
  margin-right: 2px;
}

/* 评价相关样式已移到 components/RatingSummary.vue + ReviewItem.vue */

/* 图文详情 */
.pdp-detail {
  padding: 4px 20px 22px;
}
.pdp-param {
  border: 1px solid $line;
  border-radius: $r-md;
  overflow: hidden;
  margin: 12px 0 18px;
}
.pdp-param-row {
  display: flex;
  font-size: 13.5px;
  border-bottom: 1px solid $line-soft;
}
.pdp-param-row.last {
  border-bottom: none;
}
.pdp-param-dt {
  width: 92px;
  flex: 0 0 92px;
  background: $bg-faint;
  color: $content-2;
  padding: 11px 14px;
}
.pdp-param-dd {
  flex: 1;
  color: $ink;
  padding: 11px 14px;
}
.pdp-detail-lead {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 17px;
  color: $ink;
  margin: 18px 0 8px;
}
.pdp-detail-p {
  display: block;
  font-size: 14.5px;
  line-height: 1.75;
  color: $content;
}
.pdp-detail-img {
  margin: 14px 0;
}

/* 套装包含（2 列卡片，跨端用 flex 不用 grid） */
.pdp-kit {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 6px 20px 18px;
}
.pdp-kit-cell {
  width: calc(50% - 6px);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  background: $white;
  border: 1px solid $line-soft;
  border-radius: $r-md;
  padding: 14px;
  margin-bottom: 12px;
}
.pdp-kit-ico {
  width: 34px;
  height: 34px;
  border-radius: $r-xs;
  background: $bg-lilac;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 11px;
}
.pdp-kit-name {
  display: block;
  font-size: 14px;
  color: $ink;
  line-height: 1.3;
}
.pdp-kit-qty {
  display: block;
  font-size: 11px;
  color: $content-2;
  font-family: $font-sans;
  margin-top: 2px;
}

/* 为你推荐（2 列） */
.pdp-recs {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 10px 20px 20px;
}
.pdp-rec {
  width: calc(50% - 6px);
  box-sizing: border-box;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-sm;
  overflow: hidden;
  margin-bottom: 12px;
}
.pdp-rec:active {
  transform: scale(0.985);
}
.pdp-rec-body {
  padding: 10px 12px 12px;
}
.pdp-rec-name {
  display: block;
  font-size: 13.5px;
  color: $ink;
  line-height: 1.3;
}
.pdp-rec-foot {
  display: flex;
  align-items: baseline;
  margin-top: 7px;
}
.pdp-rec-now {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 16px;
  color: $ink;
}
.pdp-rec-was {
  font-family: $font-sans;
  font-size: 11px;
  color: $content-2;
  text-decoration: line-through;
  margin-left: 6px;
}

/* ---------- 底部购买坞 ---------- */
.pdp-foot {
  height: calc(78px + env(safe-area-inset-bottom));
}
.pdp-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: $white;
  border-top: 0.5px solid $line;
}
.pdp-buy-ico {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: $content;
  padding: 4px 6px;
  flex: 0 0 auto;
}
.pdp-buy-ico text {
  font-size: 10px;
  margin-top: 2px;
}
.pdp-buy-actions {
  flex: 1;
  display: flex;
  margin-left: 4px;
}
.pdp-btn {
  flex: 1;
  height: 46px;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 15px;
  color: $white;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pdp-btn:active {
  transform: translateY(1px);
}
.pdp-btn-cart {
  background: $purple-ink;
  margin-right: 9px;
}
.pdp-btn-buy {
  background: $purple;
}
</style>
