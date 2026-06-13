<script setup>
/**
 * 支付成功页。对应原型 Checkout.jsx 的 PaySuccess。
 * 由结算页 redirectTo 进入（带真实订单 id）。订单号/金额读订单 store 里的同一笔
 * （关调试日志 C：提交 → 支付成功 → 订单详情贯通），查不到时回退 query 的 amount。
 * 「返回首页」reLaunch 回首页；「查看订单」reLaunch 到该订单详情。
 * 入场动画按项目「暂不做渐显动画」的决定省略。公共导航样式见 styles/co.scss。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import { useOrdersStore } from '@/store/orders.js'
import { money } from '@/utils/format.js'

const ordersStore = useOrdersStore()
const amount = ref('0.00')
const orderNo = ref('')

onLoad(async (q) => {
  if (q && q.amount) amount.value = q.amount
  if (q && q.id) {
    orderNo.value = q.id
    // 刚下的单已在 store；直接落地本页（如小程序重启）则拉一次再找
    let o = ordersStore.getById(q.id)
    if (!o) {
      await ordersStore.load()
      o = ordersStore.getById(q.id)
    }
    if (o) amount.value = money(o.amount)
  }
})

function home() {
  uni.reLaunch({ url: '/pages/index/index' })
}
function orders() {
  // 无单号兜底进订单列表「待发货」tab（原 ?status= 样例详情已随技术债 #8 删除）
  const url = orderNo.value
    ? `/pages/order/index?id=${orderNo.value}`
    : '/pages/order-list/index?tab=toship'
  uni.reLaunch({ url })
}
</script>

<template>
  <view class="cosuc">
    <CoNavBar title="支付结果" mode="close" @close="home" />

    <view class="cosuc-body">
      <view class="cosuc-hero">
        <view class="cosuc-check"><Icon name="check" :size="40" /></view>
        <text class="cosuc-title">支付成功</text>
        <text class="cosuc-amount"><text class="cny">￥</text>{{ amount }}</text>
        <text class="cosuc-sub">幸运已下单 · 我们会尽快为你打包发出</text>
      </view>

      <view class="cosuc-info">
        <view class="cosuc-info-row">
          <text class="cosuc-info-k">订单编号</text>
          <text class="cosuc-info-v num">{{ orderNo }}</text>
        </view>
        <view class="cosuc-info-row divided">
          <text class="cosuc-info-k">配送方式</text>
          <text class="cosuc-info-v">顺丰速运 · 包邮</text>
        </view>
        <view class="cosuc-info-row divided">
          <text class="cosuc-info-k">预计送达</text>
          <text class="cosuc-info-v">48 小时内发出 · 次日达</text>
        </view>
      </view>

      <view class="cosuc-actions">
        <view class="cosuc-btn ghost" @tap="orders">查看订单</view>
        <view class="cosuc-btn solid" @tap="home">返回首页</view>
      </view>

      <view class="cosuc-tip">
        <Icon name="sparkles-purple" :size="15" />
        <text>开盒就能跟着视频钩出第一只小鸭，Get Ducky Get Lucky</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* 本页根用 cosuc（白底）；顶部导航用 CoNavBar 组件 */
.cosuc {
  min-height: 100vh;
  background: $white;
  font-family: $font-cn;
  color: $content;
}
.cosuc-body {
  padding: 18px 20px 8px;
}
.cosuc-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 30px 12px 26px;
}
.cosuc-check {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: $purple;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 28px rgba(123, 92, 175, 0.32);
}
.cosuc-title {
  font-family: $font-display;
  font-weight: 700;
  font-size: 24px;
  color: $ink;
  margin-top: 20px;
}
.cosuc-amount {
  font-family: $font-sans;
  font-weight: 700;
  font-size: 34px;
  color: $ink;
  margin-top: 10px;
}
.cosuc-amount .cny {
  font-size: 20px;
  font-weight: 600;
  margin-right: 2px;
}
.cosuc-sub {
  font-size: 14px;
  color: $content-2;
  line-height: 1.6;
  margin-top: 12px;
  max-width: 260px;
}

.cosuc-info {
  background: $bg-faint;
  border-radius: $r-md;
  padding: 6px 16px;
  margin-top: 6px;
}
.cosuc-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
}
.cosuc-info-row.divided {
  border-top: 0.5px solid $line;
}
.cosuc-info-k {
  font-size: 13.5px;
  color: $content-2;
}
.cosuc-info-v {
  font-weight: 500;
  font-size: 14px;
  color: $ink;
}
.cosuc-info-v.num {
  font-family: $font-sans;
}

.cosuc-actions {
  display: flex;
  margin-top: 26px;
}
.cosuc-btn {
  flex: 1;
  height: 48px;
  border-radius: $r-pill;
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cosuc-btn.ghost {
  background: $white;
  border: 1px solid $purple;
  color: $purple;
  margin-right: 12px;
}
.cosuc-btn.solid {
  background: $purple;
  color: $white;
}
.cosuc-btn:active {
  opacity: 0.94;
}

.cosuc-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  margin: 22px auto 0;
  max-width: 280px;
}
.cosuc-tip text {
  font-size: 12.5px;
  color: $purple-meta;
  line-height: 1.5;
  margin-left: 7px;
}
</style>
