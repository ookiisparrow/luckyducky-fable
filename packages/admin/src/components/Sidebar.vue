<script setup>
/**
 * 左侧导航（与设计稿一致）：商品与上新（列表+向导）+ 橱窗 + 订单发货 +「按步骤直达」六入口 + 数据看板。
 * 直达入口：带着「最近编辑的商品」跳对应步骤；还没有商品时回列表。
 */
import { useRoute, useRouter } from 'vue-router'
import { useProductsStore, STEP_NAMES } from '@/store/products.js'
import { logout, currentUser } from '@/api/cloud.js'

const route = useRoute()
const router = useRouter()
const store = useProductsStore()
store.load()

function goStep(n) {
  const p = store.list[0]
  if (!p) return router.push('/products')
  router.push(`/product/${p.id}/step/${n}`)
}
function stepActive(n) {
  return route.params.n === String(n)
}
function doLogout() {
  logout()
  router.push('/login')
}
</script>

<template>
  <aside class="side">
    <div class="logo">
      <div class="logo-badge">🦆</div>
      <div>
        <div class="logo-title">Lucky Ducky</div>
        <div class="logo-sub">内容控制台</div>
      </div>
    </div>

    <router-link class="nav" :class="{ on: route.path === '/products' }" to="/products"
      >🏪 商品与上新</router-link
    >
    <router-link class="nav" :class="{ on: route.path === '/showcase' }" to="/showcase"
      >📱 小程序橱窗</router-link
    >
    <router-link class="nav" :class="{ on: route.path === '/orders' }" to="/orders"
      >📦 订单发货</router-link
    >
    <router-link class="nav" :class="{ on: route.path === '/refunds' }" to="/refunds"
      >💸 售后退款</router-link
    >
    <router-link class="nav" :class="{ on: route.path === '/inventory' }" to="/inventory"
      >🗄️ 库存管理</router-link
    >

    <div class="caption">按步骤直达</div>
    <button v-for="(name, i) in STEP_NAMES" :key="i" class="nav step" :class="{ on: stepActive(i + 1) }" @click="goStep(i + 1)">
      {{ i + 1 }} · {{ name }}
    </button>

    <router-link class="nav" :class="{ on: route.path === '/dashboard' }" to="/dashboard"
      >📊 数据看板</router-link
    >
    <router-link class="nav" :class="{ on: route.path === '/batches' }" to="/batches"
      >🔖 二维码批次</router-link
    >
    <router-link class="nav" :class="{ on: route.path === '/notifications' }" to="/notifications"
      >🔔 消息通知</router-link
    >
    <router-link class="nav" :class="{ on: route.path === '/externals' }" to="/externals"
      >🌐 外部后台</router-link
    >

    <div class="spacer"></div>
    <div class="admin">
      <div class="ava">{{ (currentUser() || '管')[0] }}</div>
      <div class="who">
        <div class="who-name">{{ currentUser() || '管理员' }}</div>
        <button class="who-out" @click="doLogout">退出登录</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.side {
  width: 232px;
  flex: 0 0 auto;
  background: var(--white);
  border-right: 1px solid var(--line);
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  height: 100vh;
}
.logo {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 8px 24px;
}
.logo-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}
.logo-title {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink);
}
.logo-sub {
  font-size: 11px;
  color: var(--purple-meta);
}
.nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 13.5px;
  color: var(--content-2);
  text-decoration: none;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
  text-align: left;
}
.nav.on {
  background: var(--bg-lilac);
  border-color: var(--purple-line);
  color: var(--purple-ink);
  font-weight: 600;
}
.nav:not(.disabled):hover {
  background: var(--bg-lilac);
}
.nav.disabled {
  cursor: default;
}
.caption {
  padding: 14px 12px 4px;
  font-size: 10.5px;
  letter-spacing: 0.5px;
  color: var(--purple-meta);
}
.soon {
  font-size: 10px;
  background: var(--bg-grey);
  border-radius: var(--r-pill);
  padding: 2px 6px;
}
.spacer {
  flex: 1;
}
.admin {
  display: flex;
  gap: 10px;
  align-items: center;
  border-top: 1px solid var(--line);
  padding: 10px 8px 4px;
}
.ava {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-sage);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}
.who-name {
  font-size: 12.5px;
  font-weight: 600;
}
.who-out {
  border: none;
  background: none;
  padding: 0;
  font-size: 10.5px;
  color: var(--content-2);
  cursor: pointer;
}
.who-out:hover {
  color: var(--red);
}
</style>
