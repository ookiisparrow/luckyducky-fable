<script setup>
/**
 * 评价晒单页。对应原型 Checkout.jsx 的 ReviewSubmit。
 * 入口：已完成订单「评价晒单」（真单带 ?orderId=，演示路径不带）。
 * 评分 + 标签 + 文字 + 晒图(灰占位，v1 不上传) + 匿名。
 * 真单「发布评价」走 submitReview 云函数（订单归属/已完成/一单一品一评，
 * 评价进详情页评价区）；演示路径保持原 Toast。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import CoSwitch from '@/components/CoSwitch.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { useOrdersStore } from '@/store/orders.js'
import { useReviewsStore } from '@/store/reviews.js'
import { submitReview } from '@/api/review.js'
import { CHECKOUT_ADDONS } from '@/data/checkout.js'
import { goBack } from '@/utils/nav.js'
import { useTimers } from '@/composables/useTimers.js'

const { later } = useTimers()

const REV_TAGS = ['教程清晰', '很可爱', '适合新手', '包装用心', '物流快', '线材好']
const REV_LABEL = ['', '非常不满', '不满意', '一般', '满意', '非常满意']
const SAMPLE_PRODUCT = { name: '微笑小鸡 · 入门套装', spec: '鹅黄' }

const ordersStore = useOrdersStore()
const reviewsStore = useReviewsStore()
const orderId = ref('')
const order = computed(() => (orderId.value ? ordersStore.getById(orderId.value) : null))
// 评价对象：订单里第一个商品条目（跳过搭配购小件，它们不在 products/详情页体系里）
const reviewItem = computed(() => {
  const items = order.value?.items || []
  return items.find((it) => !CHECKOUT_ADDONS.some((a) => a.id === it.productId)) || items[0] || null
})
const product = computed(() =>
  reviewItem.value ? { name: reviewItem.value.name, spec: reviewItem.value.spec } : SAMPLE_PRODUCT
)

onLoad(async (q) => {
  if (q && q.orderId) {
    orderId.value = q.orderId
    if (!ordersStore.getById(q.orderId)) await ordersStore.load()
  }
})

const rating = ref(5)
const tags = ref(['很可爱', '教程清晰'])
const text = ref('')
const photoCount = ref(1)
const anon = ref(false)
const submitting = ref(false)

function toggleTag(t) {
  const i = tags.value.indexOf(t)
  if (i >= 0) tags.value.splice(i, 1)
  else tags.value.push(t)
}
function addPhoto() {
  if (photoCount.value < 6) photoCount.value++
}
function rmPhoto() {
  if (photoCount.value > 0) photoCount.value--
}
const back = () => goBack('/pages/me/index')
async function publish() {
  // 演示路径（无真单）：保持原 Toast
  if (!order.value || !reviewItem.value) {
    uni.showToast({ title: '评价已发布 · 感谢分享~', icon: 'none' })
    later(back, 400)
    return
  }
  if (submitting.value) return
  submitting.value = true
  try {
    const res = await submitReview({
      orderId: order.value.id,
      // 行键（外审 P1.1）：新单 item.lineId（productId__spec）/ 旧单回退 productId——同商品多 SKU 可各自评
      lineId: reviewItem.value.lineId || reviewItem.value.productId,
      rating: rating.value,
      tags: tags.value,
      text: text.value,
      anon: anon.value,
    })
    // res 为 null = 无云（H5/App 演示），按演示成功处理
    if (res) reviewsStore.load(reviewItem.value.productId, true) // 详情页评价区即刻可见
    uni.showToast({ title: '评价已发布 · 感谢分享~', icon: 'none' })
    later(back, 400)
  } catch (e) {
    const msg =
      { REVIEWED: '这笔订单已经评价过啦', NOT_DONE: '订单完成后才能评价' }[e.message] ||
      '发布失败，请稍后再试'
    uni.showToast({ title: msg, icon: 'none' })
    submitting.value = false
  }
}
</script>

<template>
  <view class="co">
    <CoNavBar title="评价晒单" @back="back" />

    <view class="co-body">
      <!-- 商品 + 评分 -->
      <view class="co-card corev-top">
        <view class="corev-prod">
          <view class="corev-prod-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="corev-prod-mid">
            <text class="corev-prod-name">{{ product.name }}</text>
            <text v-if="product.spec" class="co-item-spec">{{ product.spec }}</text>
          </view>
        </view>
        <view class="corev-rate">
          <view class="corev-rate-stars">
            <text
              v-for="n in 5"
              :key="n"
              class="corev-star"
              :class="{ on: n <= rating }"
              @tap="rating = n"
              >★</text
            >
          </view>
          <text class="corev-rate-label">{{ REV_LABEL[rating] }}</text>
        </view>
      </view>

      <!-- 标签 -->
      <view class="co-card corev-sec">
        <text class="corev-sec-title">大家都说</text>
        <view class="corev-tags">
          <view
            v-for="t in REV_TAGS"
            :key="t"
            class="corev-tag"
            :class="{ on: tags.includes(t) }"
            @tap="toggleTag(t)"
            >{{ t }}</view
          >
        </view>
      </view>

      <!-- 文字 + 晒图 -->
      <view class="co-card corev-sec">
        <textarea
          v-model="text"
          class="corev-text"
          maxlength="500"
          placeholder="说说你的钩织体验，分享给想入坑的小伙伴吧～"
        />
        <text class="corev-count">{{ text.length }}/500</text>
        <view class="corev-photos">
          <view v-for="n in photoCount" :key="n" class="corev-photo">
            <MediaSlot ratio="1/1" />
            <view class="corev-photo-rm" @tap.stop="rmPhoto"><Icon name="x" :size="12" /></view>
          </view>
          <view v-if="photoCount < 6" class="corev-add" @tap="addPhoto">
            <Icon name="camera-meta" :size="22" />
            <text>晒图</text>
          </view>
        </view>
      </view>

      <!-- 匿名 -->
      <view class="co-card corev-anon" @tap="anon = !anon">
        <text class="corev-anon-text">匿名评价</text>
        <text class="corev-anon-sub">隐藏你的昵称与头像</text>
        <CoSwitch :on="anon" />
      </view>
    </view>

    <view class="co-foot"></view>
    <view class="co-dock">
      <view class="co-save" @tap="publish">发布评价</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 商品 + 评分 */
.corev-top {
  padding: 16px;
}
.corev-prod {
  display: flex;
  align-items: center;
  padding-bottom: 16px;
  border-bottom: 0.5px solid $line-soft;
}
.corev-prod-img {
  width: 52px;
  height: 52px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.corev-prod-mid {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.corev-prod-name {
  font-size: 15px;
  color: $ink;
  line-height: 1.3;
}
.corev-rate {
  display: flex;
  align-items: center;
  padding-top: 16px;
}
.corev-rate-stars {
  display: flex;
}
.corev-star {
  font-size: 30px;
  line-height: 1;
  color: $line-strong;
  margin-right: 6px;
}
.corev-star.on {
  color: $duck-deep;
}
.corev-rate-label {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $duck-orange;
  margin-left: 8px;
}

/* 标签 */
.corev-sec {
  padding: 16px;
}
.corev-sec-title {
  display: block;
  font-size: 13px;
  color: $content-2;
  margin-bottom: 12px;
}
.corev-tags {
  display: flex;
  flex-wrap: wrap;
}
.corev-tag {
  font-size: 13px;
  color: $content;
  background: $bg-grey;
  border: 1px solid transparent;
  border-radius: $r-pill;
  padding: 8px 15px;
  margin: 0 9px 9px 0;
}
.corev-tag.on {
  background: $bg-lilac;
  color: $purple;
  border-color: $purple-line;
}

/* 文字 + 晒图 */
.corev-text {
  width: 100%;
  min-height: 88px;
  font-size: 15px;
  line-height: 1.6;
  color: $ink;
}
.corev-count {
  display: block;
  text-align: right;
  font-family: $font-sans;
  font-size: 11px;
  color: $content-2;
  margin-top: 4px;
}
.corev-photos {
  display: flex;
  flex-wrap: wrap;
  margin-top: 14px;
}
.corev-photo {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: $r-sm;
  overflow: hidden;
  margin: 0 8px 8px 0;
}
.corev-photo-rm {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
}
.corev-add {
  width: 72px;
  height: 72px;
  border: 1px dashed $line-strong;
  border-radius: $r-sm;
  background: $bg-grey;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: $content-2;
}
.corev-add text {
  font-size: 11px;
  margin-top: 4px;
}
.corev-add:active {
  border-color: $purple;
}

/* 匿名 */
.corev-anon {
  display: flex;
  align-items: center;
  padding: 16px;
}
.corev-anon-text {
  font-size: 15px;
  color: $ink;
}
.corev-anon-sub {
  flex: 1;
  font-size: 12px;
  color: $content-2;
  margin-left: 10px;
}
</style>
