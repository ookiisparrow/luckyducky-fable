<script setup lang="ts">
// 页面内容各页签共用：自动保存状态徽标 + 手动「保存」键 + 下方状态行。点保存只发 save 事件，保存逻辑归各页签。
import type { AutoState } from '../../lib/usePageContent'
import UiButton from '../ui/Button.vue'
import Badge from '../ui/Badge.vue'

defineProps<{ autoState: AutoState; busy: boolean; message: string }>()
defineEmits<{ save: [] }>()
</script>

<template>
  <div class="pc-toolbar">
    <Badge v-if="autoState === 'saving'" tone="amber" dot>自动保存中…</Badge>
    <Badge v-else-if="autoState === 'saved'" tone="green" dot>已自动保存</Badge>
    <Badge v-else-if="autoState === 'error'" tone="red" dot>自动保存失败</Badge>
    <UiButton :disabled="busy" @click="$emit('save')">{{ busy ? '保存中…' : '保存' }}</UiButton>
  </div>
  <p v-if="message" class="ld-status">{{ message }}</p>
</template>
