<script setup>
/**
 * 媒体槽：图片/视频/动图的统一占位组件。
 * 现在默认显示灰色占位（除 hero 外的图位都用它）。
 * 将来要把某个图位换成真实图片/视频/动图：只改本组件 type 分支，页面无需改动。
 *
 * 用法：
 *   <MediaSlot ratio="1/1" label="放入图片" :radius="9" />
 *   <MediaSlot type="image" :src="url" ratio="3/4" />   // 以后填真图
 *   <MediaSlot type="video" :src="url" />               // 以后接视频（待实现）
 */
import { computed } from 'vue'

const props = defineProps({
  ratio: { type: String, default: '1/1' }, // 宽/高，如 '1/1'、'3/4'
  radius: { type: [Number, String], default: 0 }, // 圆角 px
  label: { type: String, default: '' }, // 占位文案
  type: { type: String, default: 'image' }, // image | video | gif | lottie
  src: { type: String, default: '' },
})

// 用 padding 撑出宽高比（最稳，全端通用）
const padding = computed(() => {
  const [w, h] = props.ratio.split('/').map(Number)
  return (h / w) * 100 + '%'
})
</script>

<template>
  <view class="ld-slot" :style="{ borderRadius: radius + 'px' }">
    <view class="ld-slot-sizer" :style="{ paddingBottom: padding }"></view>

    <!-- 有真实图片时显示图片，否则灰色占位 -->
    <image
      v-if="type === 'image' && src"
      class="ld-slot-fill"
      :src="src"
      mode="aspectFill"
      lazy-load
    />
    <!-- TODO: type === 'video' / 'gif' / 'lottie' 的真实渲染，后续在此扩展 -->
    <view v-else class="ld-slot-fill ld-slot-ph">
      <text v-if="label" class="ld-slot-label">{{ label }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ld-slot {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: $bg-sage;
}
.ld-slot-sizer {
  width: 100%;
}
.ld-slot-fill {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}
.ld-slot-ph {
  display: flex;
  align-items: center;
  justify-content: center;
}
.ld-slot-label {
  font-size: $fs-sub;
  color: $content-2;
  opacity: 0.55;
}
</style>
