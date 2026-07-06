<script setup lang="ts">
// 卡片/面板容器·自建原语（design/控制台.pen：白底·圆角12·$line 描边）。
// 16-19 页重复手搓 .panel/.stat-card 容器——收敛单源。
// title/sub 给标准卡头（右侧操作走 #head 具名槽）；不传 title 则纯容器（表格卡用 flush 去内边距）。
withDefaults(
  defineProps<{
    title?: string
    sub?: string
    flush?: boolean // 去内边距（表格卡·子内容自管边距）
  }>(),
  { title: undefined, sub: undefined, flush: false },
)
</script>

<template>
  <section class="card" :class="{ flush }">
    <div v-if="title || $slots.head" class="card-head">
      <div class="card-head-text">
        <h2 v-if="title" class="card-title">{{ title }}</h2>
        <span v-if="sub" class="card-sub">{{ sub }}</span>
      </div>
      <div v-if="$slots.head" class="card-head-actions"><slot name="head" /></div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.card {
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius);
  padding: 18px;
}
.card.flush {
  padding: 0;
  overflow: hidden;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.card.flush .card-head {
  margin-bottom: 0;
  padding: 15px 18px;
}
.card-head-text {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ld-ink);
}
.card-sub {
  font-size: 11.5px;
  color: var(--ld-content-2);
}
.card-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
</style>
