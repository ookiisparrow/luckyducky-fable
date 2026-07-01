<script setup>
/**
 * 坐席在线态切换（B1·在线/示忙/离线）→ setAgentStatus 写 agentState（排队分配据此选可接坐席·B6.3）。
 * 纯展示组件：状态由父级持有（v-model:status），切换成功与否 emit 由父级 toast。
 */
import { Circle } from 'lucide-vue-next'
import { setAgentStatus } from '@/api/agentApi.js'
import { toast } from '@/utils/ui.js'

const props = defineProps({ status: { type: String, default: 'online' } })
const emit = defineEmits(['update:status'])

const OPTS = [
  { key: 'online', label: '在线', cls: 'green' },
  { key: 'busy', label: '示忙', cls: 'amber' },
  { key: 'offline', label: '离线', cls: 'grey' },
]

async function pick(k) {
  if (k === props.status) return
  const r = await setAgentStatus(k)
  if (r && r.ok) {
    emit('update:status', k)
    toast('状态已切换：' + (OPTS.find((o) => o.key === k)?.label || k), 'ok')
  } else {
    toast('切换失败', 'err')
  }
}
</script>

<template>
  <div class="seg">
    <button v-for="o in OPTS" :key="o.key" class="seg-btn" :class="[o.cls, { on: status === o.key }]" @click="pick(o.key)">
      <Circle :size="9" class="dot" />{{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: inline-flex;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-pill);
  overflow: hidden;
  background: var(--white);
}
.seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 13px;
  border: none;
  background: none;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--content-2);
  cursor: pointer;
}
.seg-btn + .seg-btn {
  border-left: 1px solid var(--line);
}
.seg-btn .dot {
  opacity: 0.35;
}
.seg-btn.on {
  color: var(--ink);
  background: var(--bg-lilac);
}
.seg-btn.on.green .dot {
  color: var(--green);
  opacity: 1;
  fill: var(--green);
}
.seg-btn.on.amber .dot {
  color: var(--amber);
  opacity: 1;
  fill: var(--amber);
}
.seg-btn.on.grey .dot {
  color: var(--content-2);
  opacity: 1;
  fill: var(--content-2);
}
</style>
