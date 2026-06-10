<script setup>
/**
 * 订单状态页（待发货 / 待收货 / 已完成）。对应原型 Checkout.jsx 的 OrderStatus。
 * 两种驱动：query.id → 真实订单（store/orders，云端/回退同一笔，关调试日志 C）；
 *           query.status → 样例配置（toship/toreceive/done，data/orders.js，「我」页入口的演示路径）。
 * 收货地址：真单读订单地址快照；样例读地址簿默认地址。底部动作按钮：
 *   提醒发货/查看物流 → Toast；确认收货 → 弹确认；再次购买 → 进详情；
 *   申请退款 → 售后页；评价晒单 → 评价页。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import AddressBlock from '@/components/AddressBlock.vue'
import OrderItem from '@/components/OrderItem.vue'
import PriceSummary from '@/components/PriceSummary.vue'
import { useAddressStore } from '@/store/address.js'
import { useOrdersStore } from '@/store/orders.js'
import { ORDER_CFG, COUPON, SHIP } from '@/data/orders.js'
import { goBack } from '@/utils/nav.js'
import { money, dateTime } from '@/utils/format.js'

const address = useAddressStore()
const ordersStore = useOrdersStore()
const status = ref('toship')
const orderId = ref('')
const order = computed(() => (orderId.value ? ordersStore.getById(orderId.value) : null))

// 真实订单（现阶段均为模拟支付的 paid = 待发货）映射成与样例同构的展示配置
function cfgFromOrder(o) {
  return {
    title: '待发货',
    icon: 'package-purple',
    tint: 'lilac',
    head: '已付款，等待商家发货',
    sub: '商家将于 48 小时内为你打包发出',
    items: o.items.map((it) => ({ name: it.name, spec: it.spec, price: it.price, qty: it.qty })),
    info: [
      ['订单编号', o.id],
      ['付款时间', dateTime(o.paidAt)],
      ['支付方式', '微信支付（模拟）'],
    ],
    actions: [
      { label: '申请退款', kind: 'ghost', key: 'refund' },
      { label: '提醒发货', kind: 'solid', key: 'remind' },
    ],
  }
}

const cfg = computed(() =>
  order.value ? cfgFromOrder(order.value) : ORDER_CFG[status.value] || ORDER_CFG.toship,
)
// 真单地址用下单时的快照；样例用地址簿默认地址
const addr = computed(() => (order.value ? order.value.address : address.defaultAddress))

onLoad(async (q) => {
  if (q && q.id) {
    orderId.value = q.id
    if (!ordersStore.getById(q.id)) await ordersStore.load()
    if (!ordersStore.getById(q.id)) {
      uni.showToast({ title: '没有找到这笔订单', icon: 'none' })
      orderId.value = ''
    }
  } else if (q && q.status && ORDER_CFG[q.status]) {
    status.value = q.status
  }
})

const goods = computed(() =>
  order.value
    ? order.value.goods
    : cfg.value.items.reduce((s, it) => s + it.price * (it.qty || 1), 0),
)
const coupon = computed(() => (order.value ? order.value.coupon : COUPON))
const ship = computed(() => (order.value ? order.value.ship : SHIP))
const pay = computed(() =>
  order.value ? order.value.amount : Math.max(0, goods.value + ship.value - coupon.value),
)
const back = () => goBack('/pages/me/index')
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
    <CoNavBar :title="cfg.title" @back="back" />

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
      <AddressBlock :address="addr" />

      <!-- 订单商品（只读 ×N） -->
      <view class="co-card">
        <view class="co-shop">
          <Icon name="store" :size="17" />
          <text class="co-shop-name">易织™小棉鸭® 官方旗舰店</text>
          <view class="co-shop-chev"><Icon name="chevron-right" :size="16" /></view>
        </view>
        <OrderItem
          v-for="(it, i) in cfg.items"
          :key="i"
          :name="it.name"
          :spec="it.spec"
          :price="it.price"
          :qty="it.qty || 1"
        />
      </view>

      <!-- 订单信息 -->
      <view class="co-card">
        <view v-for="(row, i) in cfg.info" :key="i" class="co-row" :class="{ divided: i > 0 }">
          <text class="co-row-key">{{ row[0] }}</text>
          <text class="co-row-val muted">{{ row[1] }}</text>
        </view>
      </view>

      <!-- 金额明细 -->
      <PriceSummary :goods="goods" :coupon="coupon" :ship="ship" :total="pay" />
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
@import '../../styles/co.scss';

/* 横排底部坞 */
.co-dock {
  display: flex;
  align-items: center;
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

/* 横排坞按钮（取消 / 主操作，比结算页提交按钮小） */
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
