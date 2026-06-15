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
import { ref, computed } from 'vue'
import { onLoad, onShareAppMessage, onShareTimeline } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import RatingSummary from '@/components/RatingSummary.vue'
import ReviewItem from '@/components/ReviewItem.vue'
import DetailGallery from './components/DetailGallery.vue'
import DetailParams from './components/DetailParams.vue'
import DetailKit from './components/DetailKit.vue'
import DetailRecs from './components/DetailRecs.vue'
import DetailDock from './components/DetailDock.vue'
import { PRODUCT_DETAIL as PD } from '@/data/productDetail.js'
import { getProduct } from '@/data/catalog.js'
import { useCartStore } from '@/store/cart.js'
import { useProductsStore } from '@/store/products.js'
import { useReviewsStore } from '@/store/reviews.js'
import { goBack } from '@/utils/nav.js'
import { getSystemBarVars } from '@/utils/systemBar.js'
import { timeAgo } from '@/utils/format.js'
import { buildProductShare } from '@/utils/share.js'

// 浮层按钮避状态栏/胶囊：动态值经 CSS 变量进 scoped（scoped 拿不到 JS 值）
const barVars = getSystemBarVars()

const cart = useCartStore()
const products = useProductsStore()
// 商品身份优先从商品 store 取（小程序端云端 / 其它端本地回退）；取不到退回 catalog 再退回 PD 样例。
// 描述性内容（规格/评价/图文/套装）云端有则覆盖，否则共用样例。
const pid = ref('prod-1')
const title = ref(PD.title)
const price = ref(PD.price)
const was = ref(PD.was)
const tag = ref(PD.tag)
const imgs = ref([]) // 真实图（封面+其余，上架商品才有；空则灰占位）
const skus = ref([]) // 真实规格（控制台配置；样例商品为空走原占位行为）
// 图文详情三块：云端有则覆盖（段落配图自动取第②步其余图的第 N 张），否则共用样例
const dparams = ref(PD.params)
const dsections = ref(PD.detailSections)
const dkit = ref(PD.kit)
const selSku = ref(null) // 当前选中规格

// 为你推荐：从样例推荐位排除当前商品自己（占位清单 ⑯：避免推荐到正在看的这款）
const recs = computed(() => (PD.recs || []).filter((r) => r && r.id !== pid.value))

// 评价：云端有真实评价则覆盖（汇总 + 前 2 条），否则共用样例（与图文三块同模式）
const reviewsStore = useReviewsStore()
const realReviews = computed(() => reviewsStore.forProduct(pid.value))
const rating = computed(() => (realReviews.value ? realReviews.value.summary : PD.rating))
const shownReviews = computed(() =>
  realReviews.value
    ? realReviews.value.list.slice(0, 2).map((r) => ({
        name: r.name,
        date: timeAgo(r.createdAt),
        n: r.rating,
        text: r.text,
        photos: 0,
      }))
    : PD.reviews
)

onLoad(async (q) => {
  const id = (q && q.id) || pid.value
  pid.value = id
  reviewsStore.load(id) // 真实评价（有则覆盖样例），不阻塞商品加载
  // store 未就绪时 load 一次（幂等）；再按 id 取，最后退回本地 catalog 兜底。
  await products.load()
  const p = products.getById(id) || getProduct(id)
  if (p) {
    title.value = p.name
    price.value = p.price
    was.value = p.was
    tag.value = p.tag
    imgs.value = [p.cover, ...(p.images || [])].filter(Boolean)
    skus.value = Array.isArray(p.skus) ? p.skus.filter((s) => s && s.name) : []
    if (Array.isArray(p.params) && p.params.length) dparams.value = p.params
    if (Array.isArray(p.detailSections) && p.detailSections.length) {
      dsections.value = p.detailSections.map((d, i) => ({ ...d, img: (p.images || [])[i] || '' }))
    }
    if (Array.isArray(p.kit) && p.kit.length) dkit.value = p.kit
    if (skus.value.length) {
      selSku.value = skus.value[0]
      price.value = Number(selSku.value.price) || p.price
    }
  } else if (q && q.name) {
    title.value = decodeURIComponent(q.name)
  }
})

// 分享（R29/占位⑩）：转发给好友 + 朋友圈。微信只允许用户主动触发（胶囊菜单或
// open-type="share" 按钮），故这里只声明分享内容，按钮在模板里。卡片由 utils/share 纯函数构造。
onShareAppMessage(() =>
  buildProductShare({ id: pid.value, name: title.value, image: imgs.value[0] })
)
onShareTimeline(() => {
  const s = buildProductShare({ id: pid.value, name: title.value, image: imgs.value[0] })
  return { title: s.title, query: `id=${encodeURIComponent(pid.value)}`, imageUrl: s.imageUrl }
})

// 选规格：有真实 SKU 时弹原生选择（跨端），更新价格与已选显示
function chooseSpec() {
  if (!skus.value.length) return uni.showToast({ title: '选择规格（敬请期待）', icon: 'none' })
  uni.showActionSheet({
    itemList: skus.value.map((s) => `${s.name} ￥${s.price}`),
    success: (r) => {
      selSku.value = skus.value[r.tapIndex]
      price.value = Number(selSku.value.price) || price.value
    },
  })
}
// 加入购物车：真正写进 cart store（用按 id 取到的身份 + 所选规格）
function addToCart() {
  cart.add({
    id: pid.value,
    sku: selSku.value?.name || '',
    name: title.value,
    tag: selSku.value ? selSku.value.name : tag.value,
    price: price.value,
    was: was.value,
  })
  uni.showToast({ title: '已加入购物车', icon: 'none' })
}
// 立即购买：单件进结算草稿，直接去结算页（不影响购物车）
function buyNow() {
  cart.prepareBuyNow({
    id: pid.value,
    sku: selSku.value?.name || '',
    name: title.value,
    tag: selSku.value ? selSku.value.name : tag.value,
    price: price.value,
    was: was.value,
  })
  uni.navigateTo({ url: '/pages/checkout/index' })
}

const back = () => goBack('/pages/index/index')
function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
function goReviews() {
  uni.navigateTo({ url: `/pages/reviews/index?id=${pid.value}` })
}
// 点「为你推荐」里的商品 → 跳该商品详情（带 id，详情按 id 取数据）。
// 用 navigateTo 叠加新详情页、返回键逐级退回；与首页产品卡进详情写法一致。
function onRecPick(p) {
  uni.navigateTo({ url: `/pages/detail/index?id=${p.id}&name=${encodeURIComponent(p.name)}` })
}
</script>

<template>
  <view class="pdp" :style="barVars">
    <!-- 浮层头：返回 / 分享（盖在画廊上，含安全区） -->
    <view class="pdp-float">
      <view class="pdp-float-btn" @tap="back"><Icon name="chevron-left" :size="22" /></view>
      <!-- #ifdef MP-WEIXIN -->
      <button class="pdp-float-btn pdp-share-btn" open-type="share">
        <Icon name="share-2" :size="20" />
      </button>
      <!-- #endif -->
      <!-- #ifndef MP-WEIXIN -->
      <view class="pdp-float-btn" @tap="toast('分享请在微信小程序内使用')">
        <Icon name="share-2" :size="20" />
      </view>
      <!-- #endif -->
    </view>

    <!-- 画廊 -->
    <DetailGallery :count="PD.galleryCount" :imgs="imgs" />

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
      <view class="pdp-row" @tap="chooseSpec">
        <text class="pdp-row-key">已选</text>
        <text class="pdp-row-val">{{ selSku ? selSku.name + ' · 1 件' : PD.spec }}</text>
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
          <text>全部 {{ rating.count }} 条</text><Icon name="chevron-right" :size="14" />
        </view>
      </view>
      <RatingSummary :rating="rating" />
      <ReviewItem v-for="(r, i) in shownReviews" :key="i" :review="r" divided />
    </view>

    <!-- 图文详情 -->
    <view class="pdp-sec">
      <view class="pdp-sec-head"><text class="pdp-sec-title">商品详情</text></view>
      <DetailParams :params="dparams" :sections="dsections" />
    </view>

    <!-- 套装包含 -->
    <view class="pdp-sec">
      <view class="pdp-sec-head"><text class="pdp-sec-title">套装包含</text></view>
      <DetailKit :kit="dkit" />
    </view>

    <!-- 为你推荐 -->
    <view class="pdp-sec pdp-sec-last">
      <view class="pdp-sec-head"><text class="pdp-sec-title">为你推荐</text></view>
      <DetailRecs :recs="recs" @pick="onRecPick" />
    </view>

    <!-- 固定底部购买坞（含给 fixed 坞让位的占位） -->
    <DetailDock
      @service="toast('正在接入人工客服…')"
      @favorite="toast('已收藏')"
      @cart="addToCart"
      @buy="buyNow"
    />
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
  left: 12px;
  /* 小程序：与胶囊同一水平带（按钮 36px 在导航带内垂直居中），右端为胶囊让位 */
  /* #ifdef MP-WEIXIN */
  top: calc(var(--sbh, 0px) + (var(--navh, 44px) - 36px) / 2);
  right: calc(12px + var(--gap, 0px));
  /* #endif */
  /* #ifndef MP-WEIXIN */
  top: calc(14px + env(safe-area-inset-top));
  right: 12px;
  /* #endif */
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
/* 分享按钮在微信端是原生 button（open-type=share），样式归零、只当圆形热区用 */
.pdp-share-btn {
  padding: 0;
  margin: 0;
  line-height: 1;
}
.pdp-share-btn::after {
  border: none;
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
</style>
