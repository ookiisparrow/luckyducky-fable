<script setup>
/**
 * 图标组件：渲染 src/static/icons/ 下的 svg 文件。
 * 跨端安全做法 —— 用 <image> 引 svg 文件，不内联 <svg> 标签。
 * 颜色已在 svg 文件里烤死（见 static/icons），所以这里只管尺寸。
 */
defineProps({
  name: { type: String, required: true }, // 对应 static/icons/<name>.svg
  size: { type: [Number, String], default: 24 },
})
</script>

<template>
  <image
    class="ld-icon"
    :src="`/static/icons/${name}.svg`"
    :style="{ width: size + 'px', height: size + 'px' }"
  />
</template>

<style lang="scss" scoped>
.ld-icon {
  display: block;
}
</style>
