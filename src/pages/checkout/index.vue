<script setup>
/**
 * 提交订单（结算）页。对应原型 Checkout.jsx。
 * 入口：购物车「去结算」(多件) 或 详情页「立即购买」(单件)，
 * 下单清单由 cart store 的「结算草稿」(checkoutItems) 传入，本页快照到本地可改数量。
 *
 * 结构：地址 → 店铺+订单商品 → 搭配购买 → 配送/优惠/积分/备注 → 金额明细 → 固定提交坞。
 * 金额随商品数量、搭配勾选实时联动。
 *
 * 图位走 MediaSlot 灰占位；强调色用 $purple。公共 co- 样式见 styles/co.scss。
 * 收货地址来自地址簿（store/address.js）：无地址→空态引导添加。
 * 配送/优惠券/积分/备注 暂为展示 + Toast 占位。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import Icon from '@/components/Icon.vue'
import CoNavBar from '@/components/CoNavBar.vue'
import AddressBlock from '@/components/AddressBlock.vue'
import OrderItem from '@/components/OrderItem.vue'
import PriceSummary from '@/components/PriceSummary.vue'
import QuantityStepper from '@/components/QuantityStepper.vue'
import CheckoutAddonList from './components/CheckoutAddonList.vue'
import CheckoutSubmitDock from './components/CheckoutSubmitDock.vue'
import { useCartStore } from '@/store/cart.js'
import { useAddressStore } from '@/store/address.js'
import { useOrdersStore } from '@/store/orders.js'
import { CHECKOUT_ADDONS, COUPON, SHIP } from '@/data/checkout.js'
import { goBack } from '@/utils/nav.js'
import { useTimers } from '@/composables/useTimers.js'

const { later } = useTimers()
const cart = useCartStore()
const address = useAddressStore()
const ordersStore = useOrdersStore()
const addr = computed(() => address.defaultAddress) // 来自地址簿（可能为 null）

// 下单清单：从结算草稿快照（本地可改数量，提交时按最终数量精确扣减购物车）。
// 没有草稿（直接访问本页 / 内存态丢失）→ 不再兜底塞样例商品，引导回购物车，避免提交假订单。
const list = ref(cart.checkoutItems.map((it) => ({ ...it, qty: it.qty || 1 })))
// 无草稿（直接访问本页 / 内存态丢失）：标记非法，禁用提交并引导回购物车，避免提交无主商品订单
const invalidCheckout = ref(false)
onLoad(() => {
  if (!cart.checkoutItems.length) {
    invalidCheckout.value = true
    uni.showToast({ title: '购物车是空的，先去选购吧～', icon: 'none' })
    later(() => goBack('/pages/cart/index'), 800)
  }
})
const addons = ref(CHECKOUT_ADDONS.map((a) => ({ ...a, qty: 1 })))

const infoRows = [
  { key: '配送方式', val: '顺丰速运 · 包邮', cls: '' },
  { key: '优惠券', val: '-￥20.00', cls: 'accent' },
  { key: '幸运积分', val: '可用 320 · 暂不使用', cls: 'muted' },
  { key: '订单备注', val: '选填，给商家留言', cls: 'muted' },
]

const goods = computed(
  () =>
    list.value.reduce((s, it) => s + it.price * it.qty, 0) +
    addons.value.reduce((s, a) => s + (a.on ? a.price * a.qty : 0), 0),
)
const pay = computed(() => Math.max(0, goods.value + SHIP - COUPON))
const count = computed(
  () =>
    list.value.reduce((s, it) => s + it.qty, 0) +
    addons.value.reduce((s, a) => s + (a.on ? a.qty : 0), 0),
)
function setItemQty(i, v) {
  list.value[i].qty = Math.max(1, v)
}
function toggleAddon(i) {
  addons.value[i].on = !addons.value[i].on
}
function setAddonQty(i, v) {
  addons.value[i].qty = Math.max(1, v)
}
const back = () => goBack('/pages/index/index')
function toast(t) {
  uni.showToast({ title: t, icon: 'none' })
}
// 地址：有默认地址→去地址管理(选/改)；无→去新增
function goAddress() {
  uni.navigateTo({ url: addr.value ? '/pages/address/index' : '/pages/address-edit/index' })
}
// 防双击：下单是异步动作，提交中再点无效
const submitting = ref(false)
async function onSubmit() {
  // 守卫：没有主商品（空草稿）不允许提交 —— 即使搭配购默认选中，也不能凑成无主订单
  if (invalidCheckout.value || !list.value.length || submitting.value) {
    if (!submitting.value) uni.showToast({ title: '没有可提交的商品，请先去购物车选购', icon: 'none' })
    return
  }
  if (!addr.value) {
    uni.showToast({ title: '请先添加收货地址', icon: 'none' })
    uni.navigateTo({ url: '/pages/address-edit/index' })
    return
  }
  submitting.value = true
  try {
    // 真实下单：只传 id/qty + 地址快照，价格由云端按 products 现算（H5/App 回退本地生成）
    const order = await ordersStore.create({
      items: [
        ...list.value.map((it) => ({ id: it.id, qty: it.qty, sku: it.sku || '' })),
        ...addons.value.filter((a) => a.on).map((a) => ({ id: a.id, qty: a.qty })),
      ],
      address: addr.value,
    })
    cart.finishCheckout(list.value) // 按本次最终数量精确扣减购物车
    uni.redirectTo({ url: `/pages/paysuccess/index?id=${order.id}&amount=${order.amount.toFixed(2)}` })
  } catch {
    uni.showToast({ title: '下单失败，请稍后再试', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <view class="co">
    <CoNavBar title="提交订单" @back="back" />

    <view class="co-body">
      <!-- 收货地址（来自地址簿；无则空态引导添加） -->
      <AddressBlock :address="addr" tappable @tap="goAddress" />

      <!-- 店铺 + 订单商品 -->
      <view class="co-card">
        <view class="co-shop">
          <Icon name="store" :size="17" />
          <text class="co-shop-name">易织™小棉鸭® 官方旗舰店</text>
          <view class="co-shop-chev"><Icon name="chevron-right" :size="16" /></view>
        </view>
        <OrderItem v-for="(it, i) in list" :key="it.id + '|' + (it.sku || '')" :name="it.name" :spec="it.tag" :price="it.price">
          <template #foot>
            <QuantityStepper
              :n="it.qty"
              size="sm"
              @dec="setItemQty(i, it.qty - 1)"
              @inc="setItemQty(i, it.qty + 1)"
            />
          </template>
        </OrderItem>
      </view>

      <!-- 搭配购买（页内组件：状态在本页，组件只发事件） -->
      <CheckoutAddonList :addons="addons" @toggle="toggleAddon" @set-qty="setAddonQty" />

      <!-- 配送 / 优惠券 / 积分 / 备注 -->
      <view class="co-card">
        <view
          v-for="(r, i) in infoRows"
          :key="r.key"
          class="co-row"
          :class="{ divided: i > 0 }"
          @tap="toast('（开发中）')"
        >
          <text class="co-row-key">{{ r.key }}</text>
          <text class="co-row-val" :class="r.cls">{{ r.val }}</text>
          <view class="co-row-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
      </view>

      <!-- 金额明细 -->
      <PriceSummary :goods="goods" :coupon="COUPON" :ship="SHIP" :total="pay" />
    </view>

    <!-- 给提交坞让位 -->
    <view class="co-foot"></view>

    <!-- 固定提交坞（页内组件：守卫在本页 onSubmit） -->
    <CheckoutSubmitDock
      :pay="pay"
      :count="count"
      :disabled="invalidCheckout || submitting"
      @submit="onSubmit"
    />
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

/* 搭配购买 / 提交坞样式已随组件迁走：见 ./components/CheckoutAddonList.vue、CheckoutSubmitDock.vue */

/* 信息行 · 优惠券强调（红色） */
.co-row-val.accent {
  color: $red;
  font-family: $font-sans;
  font-weight: 600;
}

/* 数量步进器：见 components/QuantityStepper.vue（size="sm"） */
</style>
