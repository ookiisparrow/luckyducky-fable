<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import HomePage from './pages/HomePage.vue'
import CartPage from './pages/CartPage.vue'
import MePage from './pages/MePage.vue'
import TabBar from './components/TabBar.vue'
import { tab, toastMsg } from './store'

const STATUS_BAR = 47
const phone = ref<HTMLElement | null>(null)
const phoneH = ref(844)
// 同 lib/ground groundGap：屏高 < 700 用 56，其余 120
const groundGap = computed(() => (phoneH.value > 0 && phoneH.value < 700 ? 56 : 120))

let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(([e]) => (phoneH.value = e.contentRect.height))
  if (phone.value) ro.observe(phone.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<template>
  <main ref="phone" class="phone">
    <div class="sys-bar" aria-hidden="true">
      <span>9:41</span>
      <span class="sys-ind"><span class="sys-batt" /></span>
    </div>
    <div class="capsule" aria-hidden="true">
      <span class="capsule-dots"><i /><i /><i /></span>
      <span class="capsule-sep" />
      <span class="capsule-ring"><i /></span>
    </div>

    <div class="mp-page">
      <HomePage v-if="tab === 'home'" :status-bar-height="STATUS_BAR" />
      <CartPage v-else-if="tab === 'cart'" :status-bar-height="STATUS_BAR" :ground-gap="groundGap" />
      <MePage v-else :status-bar-height="STATUS_BAR" :ground-gap="groundGap" />
      <div class="ld-toast" :class="{ show: !!toastMsg }" role="status" aria-live="polite">{{ toastMsg }}</div>
    </div>
    <TabBar />
  </main>
</template>
