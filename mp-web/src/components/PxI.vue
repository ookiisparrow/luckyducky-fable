<script setup lang="ts">
import { computed } from 'vue'
import { glyphShadow } from '@mp/lib/pixelGlyph'

const props = withDefaults(defineProps<{ name: string; size?: number; tone?: string; halo?: string }>(), {
  size: 2,
  tone: '',
  halo: '',
})
const g = computed(() => glyphShadow(props.name, Math.max(1, props.size), props.halo !== 'none'))
const dot = computed(() => ({
  width: `${g.value.cell}px`,
  height: `${g.value.cell}px`,
  left: `-${g.value.cell}px`,
  top: `-${g.value.cell}px`,
}))
</script>

<template>
  <span class="px-host" aria-hidden="true">
    <span class="px" :style="{ width: `${g.w}px`, height: `${g.h}px`, color: tone || undefined }">
      <span class="px-dot" :style="{ ...dot, boxShadow: g.solid }" />
      <span v-if="g.halo" class="px-dot px-halo" :style="{ ...dot, boxShadow: g.halo }" />
    </span>
  </span>
</template>

<style scoped>
.px-host {
  display: inline-block;
  flex: 0 0 auto;
  line-height: 0;
  vertical-align: middle;
}
.px {
  display: block;
  position: relative;
  overflow: hidden;
  pointer-events: none;
}
.px-dot {
  position: absolute;
}
.px-halo {
  opacity: 0.25;
}
</style>
