<script setup lang="ts">
// 数据看板（骨架占位·真数据随「订单与钱」批接 getDashboard）。会话失效由 client 统一导回登录。
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { client } from '../api'

const router = useRouter()
const status = ref('连接后端中…')

onMounted(async () => {
  const r = await client.post('getDashboard')
  if (r.ok) status.value = '后端已连通（看板数据随下一批渲染）'
  else if (r.error === 'SESSION_LOST') void router.push('/login')
  else status.value = '后端未连通：' + String(r.error || '')
})
</script>

<template>
  <div>
    <h2>数据看板</h2>
    <p class="status">{{ status }}</p>
  </div>
</template>

<style scoped>
h2 {
  margin: 0 0 12px;
  color: var(--ld-purple-ink);
}
.status {
  font-size: 13px;
  color: var(--ld-purple-meta);
}
</style>
