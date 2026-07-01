<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'
import FeedbackHost from '@/components/FeedbackHost.vue'

const route = useRoute()
const bare = computed(() => route.path === '/login')
</script>

<template>
  <div v-if="bare" class="bare"><router-view /></div>
  <div v-else class="shell"><router-view /></div>
  <FeedbackHost />
</template>

<style scoped>
.shell {
  min-height: 100vh;
}
.bare {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
