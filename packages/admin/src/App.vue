<script setup>
import { useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import FeedbackHost from '@/components/FeedbackHost.vue'
import { computed } from 'vue'

const route = useRoute()
const bare = computed(() => route.path === '/login')
</script>

<template>
  <div v-if="bare" class="bare"><router-view /></div>
  <div v-else class="shell">
    <Sidebar />
    <main class="main"><router-view /></main>
  </div>
  <FeedbackHost />
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
.main {
  flex: 1;
  min-width: 0;
  padding: 28px 44px;
}
.bare {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
