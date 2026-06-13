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
import { useOrdersStore } from '@/store/orders.js'
import { ORDER_STATUS } from '@/data/orders.js'
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

onLoad((q) => {
  if (q && q.tab && TABS.some((t) => t.key === q.tab)) tab.value = q.tab
})
// 每次进页强刷：下单后回来 / 后台改状态后能看到最新（load 自带 loading 防重入）
onShow(() => orders.load(true))

const list = computed(() => {
  const cur = TABS.find((t) => t.key === tab.value)
  return cur && cur.status ? orders.list.filter((o) => o.status === cur.status) : orders.list
})
const statusLabel = (o) => (ORDER_STATUS[o.status] && ORDER_STATUS[o.status].label) || o.status
const qtyOf = (o) => o.items.reduce((s, it) => s + it.qty, 0)

const back = () => goBack('/pages/me/index')
const open = (o) => uni.navigateTo({ url: `/pages/order/index?id=${o.id}` })
</script>

<template>
  <view class="co">
    <CoNavBar title="我的订单" @back="back" />

    <!-- 状态 tab -->
    <view class="coorl-tabs">
      <view
        v-for="t in TABS"
        :key="t.key"
        class="coorl-tab"
        :class="{ on: tab === t.key }"
        @tap="tab = t.key"
      >
        <text>{{ t.label }}</text>
      </view>
    </view>

    <view class="co-body">
      <!-- 订单卡列表 -->
      <view v-for="o in list" :key="o.id" class="co-card coorl-card" @tap="open(o)">
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
          <text class="coorl-count">共 {{ qtyOf(o) }} 件</text>
          <text class="coorl-amt"
            >实付 <text class="cny">￥</text>{{ money(o.amount) }}</text
          >
        </view>
      </view>

      <!-- 空态 / 加载中 -->
      <view v-if="!list.length" class="coorl-empty">
        <view class="coorl-empty-ico"><Icon name="package" :size="26" /></view>
        <text class="coorl-empty-text">{{ orders.loading ? '订单加载中…' : '这里还没有订单' }}</text>
        <text v-if="!orders.loading" class="coorl-empty-sub"
          >下单后会出现在这里（模拟支付阶段，新订单直接进「待发货」）</text
        >
      </view>
    </view>

    <view class="co-foot"></view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

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

/* 订单卡 */
.coorl-card:active {
  opacity: 0.92;
}
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
