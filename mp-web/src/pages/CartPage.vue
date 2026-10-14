<script setup lang="ts">
// 购物车：结构对照 rewrite/mp/pages/cart/cart.wxml（样式直接用 cart.wxss）。
import { ref } from 'vue'
import PxI from '../components/PxI.vue'
import PxCanvas from '../components/PxCanvas.vue'
import { cargo, cart, fenLabel, lineFen, selectedCount, tab, toast, totalLabel, type CartLine } from '../store'

defineProps<{ statusBarHeight: number; groundGap: number }>()

const HOLD_MS = 600
const holding = ref('')
let holdTimer: ReturnType<typeof setTimeout> | undefined

const holdStart = (l: CartLine) => {
  holding.value = l.lineId
  holdTimer = setTimeout(() => {
    cart.items = cart.items.filter((x) => x.lineId !== l.lineId)
    holding.value = ''
    toast('已删除')
  }, HOLD_MS)
}
const holdEnd = () => {
  if (!holding.value) return
  clearTimeout(holdTimer)
  holding.value = ''
  toast('按住删除')
}
const onCheckout = () => toast(selectedCount.value ? '结算页暂未在网页预览中还原' : '先勾选要结算的商品')
</script>

<template>
  <div class="ca" :style="{ paddingTop: `${statusBarHeight}px` }">
    <div class="ca-head"><h1 class="ca-title">购物车</h1></div>
    <div class="ca-truck" :style="{ paddingTop: `${groundGap}px` }"><PxCanvas mode="truck" :cargo="cargo" /></div>

    <template v-if="cart.items.length">
      <div class="ca-list scroll">
        <ul class="ca-rows">
          <li v-for="item in cart.items" :key="item.lineId" class="ca-row">
            <div class="ca-check-hit" @click="item.selected = !item.selected">
              <button
                v-press="'k-light-down'"
                class="k k-sm k-light ca-check"
                role="checkbox"
                :aria-checked="item.selected"
                :aria-label="`选择${item.name}`"
              >
                <PxI v-if="item.selected" name="check" tone="var(--v5-violet)" />
              </button>
            </div>
            <div v-press="'press-fade'" class="ca-thumb">
              <div class="ca-thumb-img" :style="{ backgroundImage: `url('${item.cover}')` }" />
            </div>
            <div class="ca-mid">
              <span class="t-sys ca-name">{{ item.name }}</span>
              <span v-if="item.sku" class="t-sys ca-sku t-cap">{{ item.sku }}</span>
            </div>
            <div class="ca-right">
              <span class="mono ca-price" :class="{ 'ca-price-off': !item.selected }">{{ fenLabel(lineFen(item)) }}</span>
              <div class="ca-step">
                <div v-if="item.qty > 1" class="ca-step-hit ca-step-l" @click="item.qty--">
                  <button v-press="'k-light-down'" class="k k-sm k-light ca-step-key" aria-label="减一件"><PxI name="minus" /></button>
                </div>
                <div
                  v-else
                  class="ca-step-hit ca-step-l"
                  @pointerdown="holdStart(item)"
                  @pointerup="holdEnd"
                  @pointerleave="holdEnd"
                  @pointercancel="holdEnd"
                >
                  <button
                    v-press="'k-light-down'"
                    class="k k-sm k-light ca-step-key ca-del"
                    :class="{ 'ca-del-on': holding === item.lineId }"
                    aria-label="按住删除"
                  >
                    <span class="ca-del-fill" />
                    <PxI name="times" />
                  </button>
                </div>
                <span class="mono ca-qty">{{ item.qty }}</span>
                <div class="ca-step-hit ca-step-r" @click="item.qty = Math.min(99, item.qty + 1)">
                  <button v-press="'k-light-down'" class="k k-sm k-light ca-step-key" aria-label="加一件"><PxI name="plus" /></button>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <div class="ca-foot">
        <div class="ca-sum">
          <span class="t-sys ca-sum-k t-cap">小计</span>
          <div class="ca-leader" />
          <span class="mono ca-sum-v">{{ totalLabel }}</span>
        </div>
        <span class="t-sys ca-policy">包邮到家 · 售后无忧</span>
        <button v-if="selectedCount" v-press="'k-ink-down'" class="k k-ink k-48" @click="onCheckout">结算（{{ selectedCount }}）</button>
        <button v-else v-press="'k-flat-down'" class="k k-flat k-48" @click="onCheckout">选择要结算的商品</button>
      </div>
    </template>

    <div v-else class="ca-empty">
      <span class="ca-empty-t">购物车还是空的</span>
      <button v-press="'k-light-down'" class="k k-light k-sq" aria-label="去首页逛逛" @click="tab = 'home'"><PxI name="home" /></button>
    </div>
    <div class="ca-tab-space" />
  </div>
</template>

<style scoped>
.ca-title {
  font: inherit;
  font-size: 20px;
  font-weight: 700;
}
.ca-rows {
  list-style: none;
}
.ca-mid,
.ca-thumb {
  cursor: pointer;
}
.ca-del {
  touch-action: none;
}
</style>
