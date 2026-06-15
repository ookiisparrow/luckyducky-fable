<script setup>
/**
 * 退款 / 售后页（链10 接真）。入口：「我」页九宫格、订单详情「申请退款」（带 orderId 置顶该单）。
 * 上块：我的售后单（状态徽标：审核中 / 退款处理中 / 已退款 / 已拒绝+原因）；
 * 下块：可申请条目 = 云端订单（paid/shipped/done）× refundable 条目 × 未申请过 →
 * 申请 = 弹窗填原因 → applyRefund（退款金额云端分摊，前端不传钱）。
 * H5 / App 无云：列表空态 + 申请走演示 Toast（零回归路径）。
 */
import { ref, computed } from 'vue'
import { onLoad, onReachBottom } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { useOrdersStore } from '@/store/orders.js'
import { useAfterSalesStore } from '@/store/aftersales.js'
import { goBack } from '@/utils/nav.js'
import { money, dateTime } from '@/utils/format.js'

const AS_STATUS = {
  applied: { label: '审核中', cls: 'applied' },
  approved: { label: '退款处理中', cls: 'approved' },
  refunded: { label: '已退款', cls: 'refunded' },
  rejected: { label: '已拒绝', cls: 'rejected' },
}

const orders = useOrdersStore()
const aftersales = useAfterSalesStore()
const focusOrderId = ref('') // 订单详情带单进入：该单条目排前

onLoad(async (q) => {
  if (q && q.orderId) focusOrderId.value = q.orderId
  await Promise.all([orders.load(), aftersales.load(true)])
})
// 触底加载更多「我的售后单」（游标分页，根因#7）
onReachBottom(() => aftersales.loadMore())

// 可申请条目（refundable=false 即「已开始学习」失权条目，链6 联动）
const applicable = computed(() => {
  const rows = []
  for (const o of orders.list) {
    if (!['paid', 'shipped', 'done'].includes(o.status)) continue
    for (const it of o.items || []) {
      if (it.refundable === false) continue
      if (aftersales.has(o.id, it.productId)) continue
      rows.push({
        orderId: o.id,
        productId: it.productId,
        name: it.name,
        spec: it.spec,
        qty: it.qty,
        price: it.price,
      })
    }
  }
  rows.sort((a, b) => (b.orderId === focusOrderId.value) - (a.orderId === focusOrderId.value))
  return rows
})

const submitting = ref(false)
function applyFor(row) {
  if (submitting.value) return
  uni.showModal({
    title: '申请退款',
    editable: true,
    placeholderText: '简单说说原因（选填）',
    success: async (r) => {
      if (!r.confirm) return
      submitting.value = true
      try {
        const rec = await aftersales.apply({
          orderId: row.orderId,
          productId: row.productId,
          reason: r.content || '',
        })
        if (!rec) {
          uni.showToast({ title: '售后申请已提交（演示）', icon: 'none' }) // H5/App 无云
          return
        }
        uni.showToast({ title: '申请已提交，等待商家审核', icon: 'none' })
      } catch (e) {
        const tips = {
          ALREADY_APPLIED: '这个商品已经申请过啦',
          NOT_REFUNDABLE: '已开始学习配套课程，退货权已失效',
          NOTHING_LEFT: '这笔订单已无可退金额',
        }
        uni.showToast({ title: tips[e.message] || '申请失败，请稍后再试', icon: 'none' })
      } finally {
        submitting.value = false
      }
    },
  })
}

const back = () => goBack('/pages/me/index')
function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
</script>

<template>
  <view class="co">
    <CoNavBar title="退款 / 售后" @back="back" />

    <view class="co-body">
      <!-- 我的售后单 -->
      <view v-if="aftersales.list.length" class="co-card">
        <view class="coas-sechead">
          <text class="coas-title">我的售后</text>
        </view>
        <view
          v-for="(a, i) in aftersales.list"
          :key="a._id"
          class="coas-record"
          :class="{ divided: i > 0 }"
        >
          <view class="coas-record-top">
            <text class="coas-order-name"
              >{{ a.name }}{{ a.spec ? `（${a.spec}）` : '' }} ×{{ a.qty }}</text
            >
            <text class="coas-chip" :class="'coas-chip-' + (AS_STATUS[a.status]?.cls || 'applied')">
              {{ AS_STATUS[a.status]?.label || a.status }}
            </text>
          </view>
          <view class="coas-record-mid">
            <text class="coas-record-amt"
              >退款 <text class="cny">￥</text>{{ money(a.refundAmount) }}</text
            >
            <text class="coas-record-time">{{ dateTime(a.appliedAt) }}</text>
          </view>
          <text v-if="a.status === 'rejected' && a.rejectReason" class="coas-record-note">
            拒绝原因：{{ a.rejectReason }}
          </text>
          <text v-else-if="a.status === 'refunded'" class="coas-record-note ok">
            已原路退回微信支付{{ a.refundedAt ? ' · ' + dateTime(a.refundedAt) : '' }}
          </text>
        </view>
      </view>

      <!-- 可申请售后的商品 -->
      <view class="co-card">
        <view class="coas-sechead">
          <text class="coas-title">可申请售后的商品</text>
          <text class="coas-sechead-sub">已付款订单</text>
        </view>
        <text v-if="!applicable.length" class="coas-empty">
          暂无可申请的商品（已开始学习课程的商品不支持退货）
        </text>
        <view
          v-for="(o, i) in applicable"
          :key="o.orderId + o.productId"
          class="coas-order"
          :class="{ divided: i > 0 }"
        >
          <view class="coas-order-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="coas-order-mid">
            <text class="coas-order-name">{{ o.name }}</text>
            <text class="coas-order-meta"
              >{{ o.spec || '默认款' }} ×{{ o.qty }} · 单号 {{ o.orderId }}</text
            >
            <text class="coas-order-price"
              ><text class="cny">￥</text>{{ money(o.price * o.qty) }}</text
            >
          </view>
          <view class="coas-apply" @tap="applyFor(o)">申请售后</view>
        </view>
      </view>

      <!-- 帮助 -->
      <view class="co-card">
        <!-- #ifdef MP-WEIXIN -->
        <!-- 联系人工客服：微信原生客服会话（R18/⑨ open-type=contact，§5 能力按钮例外） -->
        <button class="co-row co-contact-row" open-type="contact">
          <text class="co-row-key">联系人工客服</text>
          <text class="co-row-val muted">工作日 9:00–21:00</text>
          <view class="co-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </button>
        <!-- #endif -->
        <!-- #ifndef MP-WEIXIN -->
        <view class="co-row" @tap="toast('客服请在微信小程序内使用')">
          <text class="co-row-key">联系人工客服</text>
          <text class="co-row-val muted">工作日 9:00–21:00</text>
          <view class="co-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
        <!-- #endif -->
      </view>

      <text class="coas-note">退货请保持包装完整（含未拆封的课程激活卡）· 审核通过后原路退回</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 客服在微信端是原生 button（open-type=contact），归零成普通 co-row 列表行 */
.co-contact-row {
  width: 100%;
  background: transparent;
  border: none;
  border-radius: 0;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  text-align: left;
}
.co-contact-row::after {
  border: none;
}

/* 本页无底部坞，留出底部呼吸 */
.co-body {
  padding-bottom: 24px;
}

.coas-title {
  font-family: $font-display;
  font-weight: 500;
  font-size: 15px;
  color: $ink;
}
.coas-sechead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 14px 16px 6px;
}
.coas-sechead-sub {
  font-size: 12px;
  color: $content-2;
}

/* 我的售后单 */
.coas-record {
  padding: 12px 16px;
}
.coas-record.divided {
  border-top: 0.5px solid $line-soft;
}
.coas-record-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.coas-chip {
  flex: 0 0 auto;
  font-size: 11px;
  border-radius: $r-pill;
  padding: 3px 9px;
  margin-left: 10px;
}
.coas-chip-applied {
  color: $duck-orange;
  background: $bg-cream;
  border: 0.5px solid $line-cream;
}
.coas-chip-approved {
  color: $purple;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
}
.coas-chip-refunded {
  color: $content;
  background: $bg-grey;
  border: 0.5px solid $line;
}
.coas-chip-rejected {
  color: $red;
  background: $bg-grey;
  border: 0.5px solid $line;
}
.coas-record-mid {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 6px;
}
.coas-record-amt {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 14px;
  color: $ink;
}
.coas-record-amt .cny {
  font-size: 11px;
}
.coas-record-time {
  font-family: $font-sans;
  font-size: 11px;
  color: $content-2;
}
.coas-record-note {
  display: block;
  font-size: 11.5px;
  color: $red;
  margin-top: 5px;
  line-height: 1.5;
}
.coas-record-note.ok {
  color: $purple-meta;
}

/* 可申请条目 */
.coas-empty {
  display: block;
  padding: 6px 16px 16px;
  font-size: 12.5px;
  color: $content-2;
  line-height: 1.6;
}
.coas-order {
  display: flex;
  align-items: center;
  padding: 12px 16px;
}
.coas-order.divided {
  border-top: 0.5px solid $line-soft;
}
.coas-order-img {
  width: 64px;
  height: 64px;
  border-radius: $r-sm;
  overflow: hidden;
  flex: 0 0 auto;
  margin-right: 12px;
}
.coas-order-mid {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.coas-order-name {
  font-size: 14px;
  color: $ink;
  line-height: 1.3;
}
.coas-order-meta {
  font-family: $font-sans;
  font-size: 11.5px;
  color: $content-2;
  margin-top: 4px;
}
.coas-order-price {
  font-family: $font-sans;
  font-weight: 600;
  font-size: 15px;
  color: $ink;
  margin-top: 4px;
}
.coas-order-price .cny {
  font-size: 12px;
  margin-right: 1px;
}
.coas-apply {
  flex: 0 0 auto;
  align-self: center;
  border: 1px solid $purple;
  color: $purple;
  border-radius: $r-pill;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 14px;
  margin-left: 10px;
}
.coas-apply:active {
  background: $bg-lilac;
}

.coas-note {
  display: block;
  text-align: center;
  font-size: 12px;
  color: $purple-meta;
  line-height: 1.6;
  margin: 16px 16px 4px;
}
</style>
