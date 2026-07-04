<script setup lang="ts">
// 壳布局（M3 信息架构：按运营动作六组重排——旧侧栏 27 项平铺改分组，页面随批次填充）。
import { useRouter } from 'vue-router'
import { client } from '../api'

const router = useRouter()

const NAV = [
  { group: '总览', items: [{ label: '数据看板', path: '/' }] },
  {
    group: '商品与内容',
    items: [
      { label: '商品管理', path: '/products' },
      { label: '课程管理', path: '/courses' },
      { label: '小程序橱窗', path: '/showcase' },
      { label: '首页内容', path: '/home-content' },
      { label: '帮助视频', path: '/help-videos' },
    ],
  },
  {
    group: '订单与钱',
    items: [
      { label: '订单发货', path: '/orders' },
      { label: '售后退款', path: '/refunds' },
    ],
  },
  {
    group: '客服',
    items: [
      { label: '客服会话', path: '/conversations' },
      { label: '客户 360', path: '/customer360' },
      { label: '知识库', path: '/kb' },
      { label: '满意度', path: '/csat' },
      { label: '节点诊断', path: '/checkpoints' },
    ],
  },
  { group: '进销存', items: [] },
  { group: '系统', items: [] },
] as Array<{ group: string; items: Array<{ label: string; path: string }> }>

function logout() {
  client.logout()
  void router.push('/login')
}
</script>

<template>
  <div class="shell">
    <aside>
      <div class="brand">小棉鸭 · 控制台</div>
      <nav>
        <div v-for="g in NAV" :key="g.group" class="group">
          <div class="group-title">{{ g.group }}</div>
          <router-link v-for="it in g.items" :key="it.path" :to="it.path" class="item">{{ it.label }}</router-link>
          <div v-if="!g.items.length" class="item soon">陆续迁入…</div>
        </div>
      </nav>
      <button class="logout" @click="logout">退出登录</button>
    </aside>
    <main>
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
aside {
  width: 220px;
  padding: 20px 14px;
  background: var(--ld-bg);
  border-right: 1px solid var(--ld-purple-line);
  display: flex;
  flex-direction: column;
}
.brand {
  font-weight: 700;
  color: var(--ld-purple-ink);
  margin-bottom: 20px;
}
.group {
  margin-bottom: 16px;
}
.group-title {
  font-size: 12px;
  color: var(--ld-purple-meta);
  margin-bottom: 6px;
}
.item {
  display: block;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--ld-ink);
  text-decoration: none;
}
.item.router-link-exact-active {
  background: var(--ld-bg-lilac);
  color: var(--ld-purple-tab);
  font-weight: 600;
}
.item.soon {
  color: var(--ld-purple-line);
  font-size: 12px;
}
.logout {
  margin-top: auto;
  padding: 8px 0;
  border: 1px solid var(--ld-purple-line);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-purple-meta);
  font-size: 13px;
  cursor: pointer;
}
main {
  flex: 1;
  padding: 24px 28px;
}
</style>
