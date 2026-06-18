<script setup>
/**
 * 订单列表页（全部 / 待支付 / 待发货 / 待收货 / 已完成）。
 * 数据走 store/orders.js（小程序端云端 getMyOrders，H5 / App 回退单仅会话内）；
 * 点订单卡 → 订单详情（/pages/order/index?id=，同一笔真单）。
 * 「我」页九宫格与「全部订单」入口都进这里（?tab= 预选状态）。
 * 退款/售后不设 tab（售后仍样例，P4 一并接真）。
 */
import { ref, computed } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import OrderItem from '@/components/OrderItem.vue'
import Skeleton from '@/components/Skeleton.vue'
import { useOrdersStore } from '@/store/orders.js'
import { ORDER_STATUS, orderQty } from '@/data/orders.js'
import { goBack } from '@/utils/nav.js'
import { money, dateTime } from '@/utils/format.js'

// tab key 沿用「我」页九宫格的 key；status 是订单数据里的真实状态值
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待支付', status: 'pending' },
  { key: 'toship', label: '待发货', status: 'paid' },
  { key: 'toreceive', label: '待收货', status: 'shipped' },
  { key: 'done', label: '已完成', status: 'done' },
]

const orders = useOrdersStore()
const tab = ref('all')
// tab 横滑联动（T-F4）：tab(key) 为 source；swiper :current 用 tabIndex，点 tab / 滑 swiper 都回写 tab，
// 顶部高亮（tab===key）与内容页双向一致。手势消歧交原生 swiper（不自造 touchmove·根因#8）。
const tabIndex = computed(() =>
  Math.max(
    0,
    TABS.findIndex((t) => t.key === tab.value)
  )
)
const selectTab = (i) => {
  tab.value = TABS[i].key
}
const onSwipe = (e) => {
  tab.value = TABS[e.detail.current].key
}

onLoad((q) => {
  if (q && q.tab && TABS.some((t) => t.key === q.tab)) tab.value = q.tab
})
// 每次进页强刷：下单后回来 / 后台改状态后能看到最新（load 自带 loading 防重入）
onShow(() => orders.load(true))
// 下拉刷新：列表已移入 swiper 内各 tab 的 scroll-view 滚动，页面级下拉在 mp 不触发 → 走 scroll-view
// refresher（与首页/「我」页同机制·T-F3/根因#8）。共享 refreshing：在哪个 tab 下拉都强刷同一份订单。
const refreshing = ref(false)
async function onRefresh() {
  refreshing.value = true
  try {
    await orders.load(true)
  } finally {
    refreshing.value = false // 收转圈（失败也收，不卡）
  }
}
// 触底加载更多（游标分页，根因#7：订单超首页也能翻到旧单）：scroll-view @scrolltolower 触发（替页面 onReachBottom）
const loadMore = () => orders.loadMore()

// 某 tab 的订单（all=全部，其余按 status 过滤）；5 个 swiper-item 各取一份（共享 orders.list）
const listFor = (t) => (t.status ? orders.list.filter((o) => o.status === t.status) : orders.list)
const statusLabel = (o) => (ORDER_STATUS[o.status] && ORDER_STATUS[o.status].label) || o.status

const back = () => goBack('/pages/me/index')
const open = (o) => uni.navigateTo({ url: `/pages/order/index?id=${o.id}` })
</script>

<template>
  <view class="co coorl-page">
    <CoNavBar title="我的订单" @back="back" />

    <!-- 状态 tab：点切 swiper（selectTab）·滑 swiper 回写高亮（双向联动·T-F4） -->
    <view class="coorl-tabs">
      <view
        v-for="(t, ti) in TABS"
        :key="t.key"
        class="coorl-tab"
        :class="{ on: tab === t.key }"
        @tap="selectTab(ti)"
      >
        <text>{{ t.label }}</text>
      </view>
    </view>

    <!-- tab 内容横滑：原生 swiper 包 5 个 tab，每 tab 一个竖滚 scroll-view；
         手势消歧（横滑切 tab vs 纵滚列表）交原生 swiper，不自造 touchmove（T-F4/根因#8 真机验） -->
    <swiper class="coorl-swiper" :current="tabIndex" @change="onSwipe">
      <swiper-item v-for="t in TABS" :key="t.key">
        <scroll-view
          scroll-y
          class="coorl-scroll"
          :show-scrollbar="false"
          refresher-enabled
          :refresher-triggered="refreshing"
          @refresherrefresh="onRefresh"
          @scrolltolower="loadMore"
        >
          <view class="co-body">
            <!-- 订单卡列表 -->
            <view
              v-for="o in listFor(t)"
              :key="o.id"
              class="co-card coorl-card ld-press ld-rise"
              @tap="open(o)"
            >
              <view class="coorl-head">
                <text class="coorl-time">{{ dateTime(o.createdAt) }}</text>
                <text class="coorl-status">{{ statusLabel(o) }}</text>
              </view>
              <OrderItem
                v-for="(it, i) in o.items"
                :key="i"
                :name="it.name"
                :spec="it.spec"
                :price="it.price"
                :qty="it.qty"
              />
              <view class="coorl-foot">
                <text class="coorl-count">共 {{ orderQty(o) }} 件</text>
                <text class="coorl-amt">实付 <text class="cny">￥</text>{{ money(o.amount) }}</text>
              </view>
            </view>

            <!-- 冷启 / 弱网加载骨架：列表未到时占位非空白（T-F2·根因#8）；刷新已有列表不闪骨架 -->
            <view v-if="orders.loading && !listFor(t).length">
              <view v-for="n in 3" :key="n" class="co-card coorl-card coorl-skel">
                <view class="coorl-head">
                  <Skeleton w="110px" h="12px" />
                  <Skeleton w="52px" h="13px" />
                </view>
                <view class="coorl-skel-item">
                  <Skeleton w="56px" h="56px" radius="10px" />
                  <view class="coorl-skel-lines">
                    <Skeleton w="68%" h="14px" mb="8px" />
                    <Skeleton w="38%" h="12px" />
                  </view>
                </view>
                <view class="coorl-foot">
                  <Skeleton w="96px" h="13px" />
                </view>
              </view>
            </view>

            <!-- 空态（非加载时才显，加载交给上方骨架） -->
            <view v-else-if="!listFor(t).length" class="coorl-empty">
              <view class="coorl-empty-ico"><Icon name="package" :size="26" /></view>
              <text class="coorl-empty-text">这里还没有订单</text>
              <text class="coorl-empty-sub"
                >下单后会出现在这里（模拟支付阶段，新订单直接进「待发货」）</text
              >
            </view>
          </view>

          <view class="co-foot"></view>
        </scroll-view>
      </swiper-item>
    </swiper>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 固定高度布局（T-F4）：navbar + tabs 自然高，swiper 占满剩余、内部各 tab 的 scroll-view 竖滚。
   原 .co 是 min-height:100vh 页面级滚动；改 swiper 后须定高容器，故 .coorl-page 锁 100vh 列布局。 */
.coorl-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.coorl-swiper {
  flex: 1;
  height: 0; /* flex:1 + height:0：占满剩余高度（mp 下 swiper 需确定高度·配 flex 撑开·真机验·根因#8） */
}
.coorl-scroll {
  height: 100%;
}

/* 状态 tab 行 */
.coorl-tabs {
  display: flex;
  background: $white;
  padding: 0 6px;
  border-bottom: 0.5px solid $line;
}
.coorl-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 0 10px;
  font-size: 13.5px;
  color: $content-2;
  border-bottom: 2px solid transparent;
}
.coorl-tab.on {
  color: $purple;
  font-weight: 600;
  border-bottom-color: $purple;
}

/* 订单卡（点击态/进场走全局 .ld-press/.ld-rise·T-F5） */
.coorl-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 0.5px solid $line;
  margin-bottom: 4px;
}
.coorl-time {
  font-family: $font-sans;
  font-size: 12px;
  color: $content-2;
}
.coorl-status {
  font-size: 13px;
  font-weight: 600;
  color: $purple;
}
.coorl-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-top: 10px;
  border-top: 0.5px solid $line;
  margin-top: 4px;
}
.coorl-count {
  font-size: 12px;
  color: $content-2;
  margin-right: 10px;
}
.coorl-amt {
  font-size: 13px;
  font-weight: 600;
  color: $ink;
}
.coorl-amt .cny {
  font-size: 11px;
}

/* 加载骨架（T-F2）：复用订单卡骨架，结构对齐真卡 */
.coorl-skel-item {
  display: flex;
  align-items: center;
  padding: 12px 0;
}
.coorl-skel-lines {
  flex: 1;
  margin-left: 12px;
}

/* 空态 */
.coorl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 32px;
}
.coorl-empty-ico {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: $bg-lilac;
  display: flex;
  align-items: center;
  justify-content: center;
}
.coorl-empty-text {
  font-size: 14px;
  color: $content;
  margin-top: 14px;
}
.coorl-empty-sub {
  font-size: 12px;
  color: $content-2;
  line-height: 1.6;
  margin-top: 6px;
  text-align: center;
}
</style>
