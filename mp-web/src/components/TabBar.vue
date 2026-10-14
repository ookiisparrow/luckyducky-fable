<script setup lang="ts">
import PxI from './PxI.vue'
import { tab, type Tab } from '../store'

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'home', label: '首页' },
  { id: 'cart', label: '购物车' },
  { id: 'me', label: '我' },
]
</script>

<template>
  <nav class="v5-scope ld-tabbar" aria-label="底部导航">
    <button
      v-for="t in tabs"
      :key="t.id"
      v-press="'press-fade'"
      class="k k-flat ld-tab"
      :aria-label="t.label"
      :aria-current="tab === t.id ? 'page' : undefined"
      @click="tab = t.id"
    >
      <PxI :name="t.id" :tone="tab === t.id ? 'var(--v5-violet)' : 'var(--v5-ink-2)'" />
    </button>
  </nav>
</template>
