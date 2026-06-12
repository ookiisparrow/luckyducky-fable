<script setup>
/**
 * 订单状态页（待支付 / 待发货 / 待收货 / 已完成 / 已关闭）。对应原型 Checkout.jsx 的 OrderStatus。
 * 只由 query.id 驱动真实订单（store/orders，云端/回退同一笔，关调试日志 C；
 * banner/动作按 ORDER_STATUS 单一来源映射真实 status）。样例 ?status= 演示路径已删
 * （P4 支付接真后清账，技术债 #8）。收货地址读订单地址快照。底部动作按钮：
 *   查看物流 → 真单复制运单号（shipping 快照来自控制台发货）/ 样例 Toast；
 *   确认收货 → 真单走 confirmReceive 云函数（shipped → done）/ 样例 Toast；
 *   提醒发货 → Toast；再次购买 → 进详情；申请退款 → 售后页；评价晒单 → 评价页。
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import AddressBlock from '@/components/AddressBlock.vue'
import OrderItem from '@/components/OrderItem.vue'
import PriceSummary from '@/components/PriceSummary.vue'
import { useOrdersStore } from '@/store/orders.js'
import { ORDER_STATUS } from '@/data/orders.js'
import { goBack } from '@/utils/nav.js'
import { money, dateTime, mmss } from '@/utils/format.js'

const ordersStore = useOrdersStore()
const orderId = ref('')
const order = computed(() => (orderId.value ? ordersStore.getById(orderId.value) : null))

// 待支付倒计时：真单 pending 才跑，15 分钟与云端关单同口径；timer 必清理（代码标准）
const PAY_WINDOW_MS = 15 * 60 * 1000
const nowTick = ref(Date.now())
let payTimer = null
watch(
  () => order.value && order.value.status,
  (s) => {
    if (s === 'pending' && !payTimer) {
      payTimer = setInterval(() => {
        nowTick.value = Date.now()
      }, 1000)
    } else if (s !== 'pending' && payTimer) {
      clearInterval(payTimer)
      payTimer = null
    }
  },
  { immediate: true },
)
onUnmounted(() => payTimer && clearInterval(payTimer))
const payRemainMs = computed(() =>
  order.value && order.value.status === 'pending'
    ? Math.max(0, order.value.createdAt + PAY_WINDOW_MS - nowTick.value)
    : 0,
)

// 真实订单按 status 映射展示配置（ORDER_STATUS 单一来源；未知状态兜底按待发货）
function cfgFromOrder(o) {
  const v = ORDER_STATUS[o.status] || ORDER_STATUS.paid
  const info = [
    ['订单编号', o.id],
    o.paidAt ? ['付款时间', dateTime(o.paidAt)] : ['下单时间', dateTime(o.createdAt)],
    // 真实支付的单带 transactionId（支付回调写入）；其余是模拟支付产物
    ['支付方式', o.transactionId ? '微信支付' : '微信支付（模拟）'],
  ]
  if (o.doneAt) info.push(['成交时间', dateTime(o.doneAt)])
  // 待支付横幅副文案换成实时倒计时（与云端 15 分钟关单同口径）
  const sub =
    o.status === 'pending'
      ? payRemainMs.value > 0
        ? `请在 ${mmss(Math.ceil(payRemainMs.value / 1000))} 内完成支付，超时订单自动关闭`
        : '订单已超时，即将自动关闭'
      : v.sub
  return {
    title: v.label,
    icon: v.icon,
    tint: v.tint,
    head: v.head,
    sub,
    // 控制台发货后订单带 shipping 快照（公司 + 运单号），物流卡显示真实信息
    logi: o.shipping
      ? {
          text: `${o.shipping.company} · 运单号 ${o.shipping.trackingNo}`,
          time: o.shippedAt ? '发货时间 ' + dateTime(o.shippedAt) : '',
        }
      : null,
    items: o.items.map((it) => ({ name: it.name, spec: it.spec, price: it.price, qty: it.qty })),
    info,
    actions: v.actions,
  }
}

const cfg = computed(() => (order.value ? cfgFromOrder(order.value) : null))
// 地址用下单时的快照
const addr = computed(() => (order.value ? order.value.address : null))

onLoad(async (q) => {
  if (q && q.id) {
    orderId.value = q.id
    if (!ordersStore.getById(q.id)) await ordersStore.load()
  }
  if (!orderId.value || !ordersStore.getById(orderId.value)) {
    uni.showToast({ title: '没有找到这笔订单', icon: 'none' })
    orderId.value = ''
  }
})

const goods = computed(() => (order.value ? order.value.goods : 0))
const coupon = computed(() => (order.value ? order.value.coupon : 0))
const ship = computed(() => (order.value ? order.value.ship : 0))
const pay = computed(() => (order.value ? order.value.amount : 0))
const back = () => goBack('/pages/me/index')

// 继续支付（pending 单）：成功置 paid 横幅响应式切换；取消留单；超时云端关单本地同步 closed
const paying = ref(false)
async function payNow() {
  if (paying.value) return
  paying.value = true
  try {
    await ordersStore.pay(order.value.id)
    uni.showToast({ title: '支付成功', icon: 'success' })
  } catch (e) {
    const msg = e && e.message
    const tips = {
      ORDER_CLOSED: '订单已超时关闭',
      PAY_CANCELLED: '支付未完成，订单已保留',
      PAY_NOT_ENABLED: '支付通道尚未开通，请稍后再试',
    }
    uni.showToast({ title: tips[msg] || '支付失败，请稍后再试', icon: 'none' })
  } finally {
    paying.value = false
  }
}

function onAction(a) {
  const k = a.key
  if (k === 'confirm') {
    uni.showModal({
      title: '确认收货',
      content: '确认已收到商品吗？',
      success: async (r) => {
        if (!r.confirm) return
        // 云函数流转 shipped → done（横幅/动作随 status 响应式切换）
        try {
          await ordersStore.confirmReceive(order.value.id)
        } catch {
          uni.showToast({ title: '确认失败，请稍后再试', icon: 'none' })
          return
        }
        uni.showToast({ title: '已确认收货 · 期待你的好评~', icon: 'none' })
      },
    })
  } else if (k === 'rebuy') {
    uni.navigateTo({ url: `/pages/detail/index?id=prod-1&name=${encodeURIComponent('幸运小鸭礼盒')}` })
  } else if (k === 'remind') {
    uni.showToast({ title: '已提醒商家发货', icon: 'none' })
  } else if (k === 'pay') {
    let canPay = false
    // #ifdef MP-WEIXIN
    canPay = true
    // #endif
    if (canPay) payNow()
    else uni.showToast({ title: '请在微信小程序内完成支付', icon: 'none' })
  } else if (k === 'logi') {
    // 物流卡只在有 shipping 快照时渲染：复制运单号（去快递 App / 公众号查询）
    if (order.value.shipping) {
      uni.setClipboardData({
        data: order.value.shipping.trackingNo,
        success: () => uni.showToast({ title: '运单号已复制', icon: 'none' }),
      })
    }
  } else if (k === 'refund') {
    uni.navigateTo({ url: '/pages/aftersales/index?orderId=' + order.value.id })
  } else if (k === 'review') {
    // 带 orderId 进评价页（真实提交链路）
    uni.navigateTo({ url: `/pages/review/index?orderId=${order.value.id}` })
  }
}
</script>

<template>
  <view class="co">
    <CoNavBar :title="cfg ? cfg.title : '订单详情'" @back="back" />

    <!-- 找不到订单（直链失效等）：空态引导回订单列表 -->
    <view v-if="!cfg" class="co-body coord-empty">
      <text class="coord-empty-text">没有找到这笔订单</text>
      <view class="co-cancel" @tap="back">返回</view>
    </view>

    <view v-else class="co-body">
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
    <view v-if="cfg" class="co-dock">
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

/* 找不到订单的空态 */
.coord-empty {
  align-items: center;
  text-align: center;
  padding-top: 80px;
}
.coord-empty-text {
  display: block;
  font-size: 14px;
  color: $content-2;
  margin-bottom: 16px;
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
