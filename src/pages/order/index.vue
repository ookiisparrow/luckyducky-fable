<script setup>
/**
 * 订单状态页（待发货 / 待收货 / 已完成）。对应原型 Checkout.jsx 的 OrderStatus。
 * 由 query.status 驱动（toship/toreceive/done），数据在 data/orders.js。
 * 收货地址读地址簿默认地址（只读展示）。底部动作按钮：
 *   提醒发货/查看物流 → Toast；确认收货 → 弹确认；再次购买 → 进详情；
 *   申请退款 → 售后页；评价晒单 → 评价页。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import PriceSummary from '@/components/PriceSummary.vue'
import { useAddressStore } from '@/store/address.js'
import { ORDER_CFG, COUPON, SHIP } from '@/data/orders.js'
import { goBack } from '@/utils/nav.js'
import { money } from '@/utils/format.js'

const address = useAddressStore()
const status = ref('toship')
const cfg = computed(() => ORDER_CFG[status.value] || ORDER_CFG.toship)
const addr = computed(() => address.defaultAddress)

onLoad((q) => {
  if (q && q.status && ORDER_CFG[q.status]) status.value = q.status
})

const goods = computed(() => cfg.value.items.reduce((s, it) => s + it.price * (it.qty || 1), 0))
const pay = computed(() => Math.max(0, goods.value + SHIP - COUPON))
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
      <view v-if="addr" class="co-addr">
        <view class="co-addr-main">
          <view class="co-addr-pin"><Icon name="map-pin" :size="24" /></view>
          <view class="co-addr-text">
            <view class="co-addr-line1">
              <text class="co-addr-name">{{ addr.name }}</text>
              <text class="co-addr-phone">{{ addr.phone }}</text>
            </view>
            <view class="co-addr-line2">
              <text v-if="addr.isDefault" class="co-addr-tag">默认</text>
              <text class="co-addr-detail">{{ (addr.region ? addr.region + ' ' : '') + addr.detail }}</text>
            </view>
          </view>
        </view>
        <view class="co-stitch"></view>
      </view>

      <!-- 订单商品（只读 ×N） -->
      <view class="co-card">
        <view class="co-shop">
          <Icon name="store" :size="17" />
          <text class="co-shop-name">易织™小棉鸭® 官方旗舰店</text>
          <view class="co-shop-chev"><Icon name="chevron-right" :size="16" /></view>
        </view>
        <view v-for="(it, i) in cfg.items" :key="i" class="co-item">
          <view class="co-item-img"><MediaSlot ratio="1/1" :radius="5" /></view>
          <view class="co-item-mid">
            <text class="co-item-name">{{ it.name }}</text>
            <text v-if="it.spec" class="co-item-spec">{{ it.spec }}</text>
            <view class="co-item-foot">
              <text class="co-price co-item-price"><text class="cny">￥</text>{{ money(it.price) }}</text>
              <text class="co-item-qty">×{{ it.qty || 1 }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 订单信息 -->
      <view class="co-card">
        <view v-for="(row, i) in cfg.info" :key="i" class="co-row" :class="{ divided: i > 0 }">
          <text class="co-row-key">{{ row[0] }}</text>
          <text class="co-row-val muted">{{ row[1] }}</text>
        </view>
      </view>

      <!-- 金额明细 -->
      <PriceSummary :goods="goods" :coupon="COUPON" :total="pay" />
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
