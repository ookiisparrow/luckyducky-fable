<script setup>
/**
 * 求助面板 · 遇到问题了：辅助视频列表 / 单个视频。
 * 选中态（topic）放在壳里 —— 壳的标题与返回键依赖它；本组件只负责展示与模拟播放。
 * 辅助视频为海报占位 + 计时模拟播放（非真视频，将来换 MediaSlot 真素材）。
 */
import { ref, computed, watch, onUnmounted, getCurrentInstance } from 'vue'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { mmss, parseDur } from '@/utils/format.js'
import { TROUBLE } from './data.js'

const props = defineProps({
  topic: { type: Number, default: null }, // null=列表 / 序号=播放该条
})
const emit = defineEmits(['pick'])

const instance = getCurrentInstance()

// 模拟播放：1s 步进计时器（切换/卸载必清理）
const hvT = ref(0)
const hvPlaying = ref(false)
let hvTimer = null
const hvDur = computed(() => (props.topic !== null ? parseDur(TROUBLE[props.topic].dur) : 0))
const hvSegs = computed(() => (props.topic !== null ? TROUBLE[props.topic].segs : 0))
const hvPct = computed(() => (hvDur.value ? (hvT.value / hvDur.value) * 100 : 0))
const hvSegFill = (i) => {
  const sl = hvSegs.value ? 100 / hvSegs.value : 0
  return sl ? Math.max(0, Math.min(100, ((hvPct.value - i * sl) / sl) * 100)) : 0
}
function clearHv() {
  if (hvTimer) {
    clearInterval(hvTimer)
    hvTimer = null
  }
}
function startHv() {
  clearHv()
  hvTimer = setInterval(() => {
    if (hvT.value >= hvDur.value) {
      hvT.value = hvDur.value
      hvPlaying.value = false
      clearHv()
      return
    }
    hvT.value += 1
  }, 1000)
}
function hvToggle() {
  if (hvT.value >= hvDur.value) hvT.value = 0
  hvPlaying.value = !hvPlaying.value
  if (hvPlaying.value) startHv()
  else clearHv()
}
function hvSeekTap(e) {
  if (hvDur.value <= 0) return
  const x = (e.detail && e.detail.x) || (e.touches && e.touches[0] && e.touches[0].clientX) || 0
  uni
    .createSelectorQuery()
    .in(instance.proxy)
    .select('.hv-scrub')
    .boundingClientRect((r) => {
      if (!r) return
      const ratio = Math.min(1, Math.max(0, (x - r.left) / r.width))
      hvT.value = Math.round(ratio * hvDur.value)
    })
    .exec()
}
watch(
  () => props.topic,
  (v) => {
    clearHv()
    if (v !== null) {
      hvT.value = 0
      hvPlaying.value = true
      startHv()
    }
  }
)
onUnmounted(clearHv)
</script>

<template>
  <view class="hs-detail">
    <view v-if="topic === null" class="hs-vlist">
      <view v-for="(t, i) in TROUBLE" :key="i" class="hs-vrow" @tap="emit('pick', i)">
        <view class="hs-vthumb">
          <MediaSlot ratio="1/1" />
          <view class="hs-vthumb-play"><Icon name="play-ink" :size="14" /></view>
        </view>
        <view class="hs-vrow-mid">
          <text class="hs-vrow-title">{{ t.title }}</text>
          <text class="hs-vrow-sub">{{ t.sub }}</text>
          <view class="hs-vrow-meta"
            ><Icon name="play-purple" :size="13" /><text>视频 · {{ t.dur }}</text></view
          >
        </view>
        <view class="hs-vrow-chev"><Icon name="chevron-right" :size="18" /></view>
      </view>
    </view>
    <view v-else>
      <view class="hv-video">
        <MediaSlot ratio="4/5" />
        <view class="hv-scrim"></view>
        <view class="hv-seg">
          <view class="hv-seg-bars">
            <view v-for="i in hvSegs" :key="i" class="hv-seg-bar">
              <view class="hv-seg-fill" :style="{ width: hvSegFill(i - 1) + '%' }"></view>
            </view>
          </view>
        </view>
        <view class="hv-play" @tap="hvToggle"
          ><Icon :name="hvPlaying ? 'pause-w' : 'play-fill-w'" :size="25"
        /></view>
        <view class="hv-bar">
          <text class="hv-time">{{ mmss(hvT) }}</text>
          <view class="hv-scrub" @tap="hvSeekTap">
            <view class="hv-scrub-fill" :style="{ width: hvPct + '%' }"></view>
            <view class="hv-scrub-thumb" :style="{ left: hvPct + '%' }"></view>
          </view>
          <text class="hv-time">{{ mmss(hvDur) }}</text>
        </view>
      </view>
      <text class="hv-desc">{{ TROUBLE[topic].desc }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.hs-detail {
  padding: 4px 18px 26px;
}

/* 辅助视频列表 */
.hs-vlist {
  display: flex;
  flex-direction: column;
}
.hs-vrow {
  display: flex;
  align-items: center;
  padding: 12px;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-md;
  margin-bottom: 10px;
}
.hs-vrow:active {
  background: $bg-faint;
}
.hs-vthumb {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 10px;
  flex: 0 0 auto;
  overflow: hidden;
  margin-right: 13px;
}
.hs-vthumb-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 1;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hs-vrow-mid {
  flex: 1 1 auto;
  min-width: 0;
}
.hs-vrow-title {
  display: block;
  font-size: 16px;
  color: $ink;
}
.hs-vrow-sub {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 3px;
  line-height: 1.4;
}
.hs-vrow-meta {
  display: flex;
  align-items: center;
  margin-top: 6px;
  font-family: $font-sans;
  font-size: 11.5px;
  color: $purple;
}
.hs-vrow-meta text {
  margin-left: 4px;
}
.hs-vrow-chev {
  flex: 0 0 auto;
  display: flex;
  margin-left: 8px;
}

/* 辅助视频播放卡片 */
.hv-video {
  position: relative;
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
  background: #1a1620;
}
.hv-scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(to bottom, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 26%),
    linear-gradient(to top, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0) 30%);
}
.hv-seg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  padding: 11px 12px 0;
}
.hv-seg-bars {
  display: flex;
}
.hv-seg-bar {
  flex: 1 1 0;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  overflow: hidden;
  margin-right: 5px;
}
.hv-seg-bar:last-child {
  margin-right: 0;
}
.hv-seg-fill {
  display: block;
  height: 100%;
  background: #fff;
  border-radius: 999px;
}
.hv-play {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 3;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hv-play:active {
  transform: translate(-50%, -50%) scale(0.92);
}
.hv-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  padding: 0 12px 12px;
  display: flex;
  align-items: center;
}
.hv-time {
  flex: 0 0 auto;
  font-family: $font-sans;
  font-size: 11px;
  color: #fff;
}
.hv-scrub {
  position: relative;
  flex: 1 1 auto;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.34);
  margin: 0 10px;
}
.hv-scrub-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: $purple;
}
.hv-scrub-thumb {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.hv-desc {
  display: block;
  margin: 15px 2px 0;
  font-size: 14px;
  line-height: 1.65;
  color: $content;
}
</style>
