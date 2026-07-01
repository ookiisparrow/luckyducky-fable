<script setup>
/**
 * 快捷回复（B2·读知识库 kb·bot 与坐席共用同一份答案单源）。listKb 拉 FAQ 条目，
 * 点某条 emit('pick', answer) 由父级插入到会话输入框。question＝自用标签、answer＝回复文案。
 */
import { ref, onMounted } from 'vue'
import { MessageSquareText } from 'lucide-vue-next'
import { listKb } from '@/api/agentApi.js'

const emit = defineEmits(['pick'])
const kb = ref([])
const loading = ref(false)
const err = ref('')

onMounted(async () => {
  loading.value = true
  try {
    const r = await listKb()
    kb.value = (r && r.list) || []
  } catch (e) {
    err.value = '知识库加载失败：' + e.message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="qr">
    <h3 class="s-title"><MessageSquareText :size="15" /> 快捷回复</h3>
    <p v-if="err" class="hint warn">{{ err }}</p>
    <p v-else-if="loading" class="muted">加载中…</p>
    <p v-else-if="!kb.length" class="muted">知识库暂无条目（可在管理后台维护）。</p>
    <ul v-else class="qr-list">
      <li v-for="e in kb" :key="e.id" class="qr-item" @click="emit('pick', e.answer)">
        <div class="qr-q">{{ e.question || '（未命名）' }}</div>
        <div class="qr-a">{{ e.answer }}</div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.qr {
  padding: 10px 14px 14px;
}
.s-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}
.muted {
  color: var(--content-2);
  font-size: 12px;
}
.hint.warn {
  padding: 8px 11px;
  border-radius: 9px;
  border: 1px solid #f0c8c5;
  background: #fdf0ef;
  color: var(--red);
  font-size: 11.5px;
}
.qr-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.qr-item {
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  cursor: pointer;
  background: var(--white);
}
.qr-item:hover {
  border-color: var(--purple-line);
  background: var(--bg-lilac);
}
.qr-q {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand-active);
}
.qr-a {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--content-2);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
