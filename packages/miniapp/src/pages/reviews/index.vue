<script setup>
/**
 * 全部评价子页。对应原型 ProductDetail.jsx 的 ReviewsPage。
 * 由商品详情「全部 N 条」进入（?id=商品）。云端有真实评价则覆盖
 * （汇总 + 全部列表，筛选只剩「全部」真实计数），否则维持原样例
 * （筛选为高亮态，不做真实过滤）；评分汇总/单条评价复用组件。
 */
import { ref, computed } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom } from '@dcloudio/uni-app'
import CoNavBar from '@/components/CoNavBar.vue'
import RatingSummary from '@/components/RatingSummary.vue'
import ReviewItem from '@/components/ReviewItem.vue'
import { PRODUCT_DETAIL as PD } from '@/data/productDetail.js'
import { useReviewsStore } from '@/store/reviews.js'
import { goBack } from '@/utils/nav.js'
import { timeAgo } from '@/utils/format.js'

const f = ref(0)
const pid = ref('')
const reviewsStore = useReviewsStore()

onLoad((q) => {
  if (q && q.id) {
    pid.value = q.id
    reviewsStore.load(q.id)
  }
})
// 下拉刷新：强拉该商品最新评价（无 pid 则只收转圈），finally 防卡转圈（根因#8）
onPullDownRefresh(async () => {
  try {
    if (pid.value) await reviewsStore.load(pid.value, true)
  } finally {
    uni.stopPullDownRefresh()
  }
})
// 触底续页（债#13·根因#7）：评价过多时翻下一页追加，云端有真实评价才翻（样例不分页）
onReachBottom(() => {
  if (pid.value) reviewsStore.loadMore(pid.value)
})

const real = computed(() => (pid.value ? reviewsStore.forProduct(pid.value) : null))
const rating = computed(() => (real.value ? real.value.summary : PD.rating))
const filters = computed(() =>
  real.value ? [['全部', real.value.summary.count]] : PD.reviewFilters
)
const list = computed(() =>
  real.value
    ? real.value.list.map((r) => ({
        name: r.name,
        date: timeAgo(r.createdAt),
        n: r.rating,
        text: r.text,
        photos: 0,
      }))
    : PD.reviewsAll
)

// 触底提示：仅云端真实评价显示（样例列表不分页）
const footText = computed(() => {
  if (!real.value) return ''
  if (real.value.loadingMore) return '加载中…'
  if (real.value.done) return list.value.length ? '没有更多了' : ''
  return ''
})

const back = () => goBack('/pages/index/index')
</script>

<template>
  <view class="pdr">
    <CoNavBar title="全部评价" @back="back" />

    <!-- 评分汇总 -->
    <view class="pdr-summary">
      <RatingSummary :rating="rating" />
    </view>

    <!-- 筛选 -->
    <view class="pdr-filter">
      <view
        v-for="([t, n], i) in filters"
        :key="i"
        class="pdr-filter-btn"
        :class="{ on: i === f }"
        @tap="f = i"
        >{{ t }}<text class="pdr-filter-n"> {{ n }}</text></view
      >
    </view>

    <!-- 评价列表 -->
    <view class="pdr-list">
      <ReviewItem v-for="(r, i) in list" :key="i" :review="r" :divided="i > 0" />
    </view>

    <view v-if="footText" class="pdr-more">{{ footText }}</view>

    <view class="pdr-foot"></view>
  </view>
</template>

<style lang="scss" scoped>
.pdr {
  min-height: 100vh;
  background: $bg-grey;
  font-family: $font-cn;
  color: $content;
}

/* 评分汇总（pdp-rate- / pdp-chip- 样式见 components/RatingSummary.vue） */
.pdr-summary {
  background: $white;
  padding-bottom: 6px;
}

/* 筛选 */
.pdr-filter {
  display: flex;
  padding: 12px 20px;
  background: $white;
  border-top: 0.5px solid $line-soft;
  overflow-x: auto;
  white-space: nowrap;
}
.pdr-filter-btn {
  flex: 0 0 auto;
  font-size: 13px;
  padding: 7px 14px;
  border-radius: $r-pill;
  background: $bg-grey;
  color: $content;
  margin-right: 8px;
}
.pdr-filter-btn.on {
  background: $purple-ink;
  color: $white;
}
.pdr-filter-n {
  font-family: $font-sans;
}

/* 评价列表（pdp-review- 样式见 components/ReviewItem.vue） */
.pdr-list {
  background: $white;
  margin-top: 10px;
}
.pdr-more {
  padding: 14px 0;
  text-align: center;
  font-size: 12px;
  color: $content;
}
.pdr-foot {
  height: calc(8px + env(safe-area-inset-bottom));
}
</style>
