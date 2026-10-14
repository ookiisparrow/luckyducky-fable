<script setup lang="ts">
// 像素画画布：直接调小程序同一份纯函数（lib/pixelAnim · pixelScenes · pixelTruck），网页用 canvas 逐帧画。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PIXEL_ANIMS, type Plot } from '@mp/lib/pixelAnim'
import { createScene } from '@mp/lib/pixelScenes'
import { createGround, createTruck, PX_ROWS, type Truck } from '@mp/lib/pixelTruck'

const props = withDefaults(
  defineProps<{
    mode: 'anim' | 'scene' | 'ground' | 'truck'
    name?: string
    size?: number
    delay?: number
    cargo?: number
    hatched?: boolean
  }>(),
  { name: '', size: 4, delay: 0, cargo: 0, hatched: false }
)

const host = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
let raf = 0
let truck: Truck | null = null
let ro: ResizeObserver | null = null

watch(
  () => props.cargo,
  (n) => truck?.setCargo(n)
)

onMounted(() => {
  const cv = canvas.value!
  const ctx = cv.getContext('2d')!
  const fullWidth = props.mode === 'ground' || props.mode === 'truck'
  const cell = props.mode === 'anim' ? props.size : 4
  let cols = 13
  let rows = 13
  let draw: (t: number, P: Plot) => void = () => {}

  if (props.mode === 'anim') {
    const fn = PIXEL_ANIMS[props.name]
    if (fn) draw = (t, P) => fn(P, Math.max(0, t - props.delay))
  } else if (props.mode === 'scene') {
    const s = createScene(props.name)
    if (s) {
      cols = s.cols
      rows = s.rows
      draw = (t, P) => s.draw(t, P)
    }
  } else {
    rows = PX_ROWS
    const scene = props.mode === 'truck' ? (truck = createTruck({ cargo: props.cargo })) : createGround(props.name, { hatched: props.hatched })
    if (scene) draw = (t, P) => void scene.draw(t, P, cols)
  }

  const dpr = window.devicePixelRatio || 1
  const size = () => {
    if (fullWidth) cols = Math.floor((host.value?.clientWidth || 0) / cell)
    cv.width = cols * cell * dpr
    cv.height = rows * cell * dpr
    cv.style.width = `${cols * cell}px`
    cv.style.height = `${rows * cell}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  size()
  if (fullWidth && host.value) {
    ro = new ResizeObserver(size)
    ro.observe(host.value)
  }

  const plot: Plot = (x, y, col) => {
    ctx.fillStyle = col
    ctx.fillRect(Math.round(x) * cell, Math.round(y) * cell, cell, cell)
  }
  const start = performance.now()
  const frame = (now: number) => {
    ctx.clearRect(0, 0, cols * cell, rows * cell)
    draw(now - start, plot)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
})
</script>

<template>
  <div ref="host" :class="mode === 'ground' || mode === 'truck' ? 'pxc-full' : 'pxc-inline'" aria-hidden="true">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.pxc-full {
  display: block;
  width: 100%;
  line-height: 0;
}
.pxc-inline {
  display: inline-block;
  line-height: 0;
}
canvas {
  display: block;
  image-rendering: pixelated;
}
</style>
