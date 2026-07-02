<script setup>
/**
 * 求助面板 ·「遇到问题了」：辅助视频列表 / 单个主题的分段播放。
 * 内容来自控制台「帮助视频」管理（全局共用·两级：主题→小段），由壳层 index.vue 拉取后经 items 传入。
 * 选中态（topic）放壳里——壳的标题与返回键依赖它；本组件负责展示与真实分段播放：
 * 一个主题内多个小段连续播（段末自动切下一段·顶部 stories 式分段进度条·可点段跳转），同课程播放器分段思路。
 * 真实视频：src 走云端短时效临时 URL（segment.url·审计 P1·fileID 不出接口）；无视频显占位。
 */
import { ref, computed, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'

const props = defineProps({
  items: { type: Array, default: () => [] }, // 辅助视频主题列表（云端·全局共用）
  topic: { type: Number, default: null }, // null=列表 / 序号=播放该主题
})
defineEmits(['pick'])

const cur = computed(() => (props.topic !== null ? props.items[props.topic] : null))
const segs = computed(() => cur.value?.segments || [])

// 当前小段 + 播放进度（驱动顶部分段进度条；段末自动进下一段）
const seg = ref(0)
const curTime = ref(0)
const dur = ref(0)
const curSeg = computed(() => segs.value[seg.value] || null)
const curUrl = computed(() => curSeg.value?.url || '')

// 分段条填充：已播段满格、当前段按进度、未播段空
function segFill(i) {
  if (i < seg.value) return 100
  if (i > seg.value) return 0
  return dur.value > 0 ? Math.min(100, (curTime.value / dur.value) * 100) : 0
}
function pickSeg(i) {
  if (i === seg.value) return
  seg.value = i
  curTime.value = 0
}
function onTime(e) {
  curTime.value = (e.detail && e.detail.currentTime) || 0
  if (e.detail && e.detail.duration) dur.value = e.detail.duration
}
function onEnded() {
  if (seg.value < segs.value.length - 1) {
    seg.value += 1 // 段末自动进下一段（autoplay 接续）
    curTime.value = 0
  }
}
// 切主题：回到第一段、清进度
watch(
  () => props.topic,
  () => {
    seg.value = 0
    curTime.value = 0
    dur.value = 0
  }
)
</script>

<template>
  <view class="hs-detail">
    <!-- 列表（主题） -->
    <view v-if="topic === null">
      <view v-if="!items.length" class="hs-empty">
        <text class="hs-empty-t">还没有辅助视频</text>
        <text class="hs-empty-s">遇到卡点可以先联系在线客服，我们也会尽快补上常见问题视频</text>
      </view>
      <view v-else class="hs-vlist">
        <view v-for="(t, i) in items" :key="t.id || i" class="hs-vrow" @tap="$emit('pick', i)">
          <view class="hs-vthumb">
            <MediaSlot ratio="1/1" />
            <view class="hs-vthumb-play"><Icon name="play-ink" :size="14" /></view>
          </view>
          <view class="hs-vrow-mid">
            <text class="hs-vrow-title">{{ t.title }}</text>
            <text v-if="t.sub" class="hs-vrow-sub">{{ t.sub }}</text>
            <view class="hs-vrow-meta"
              ><Icon name="play-purple" :size="13" /><text class="hs-vrow-meta-txt"
                >视频{{
                  (t.segments || []).length > 1 ? ' · ' + t.segments.length + ' 段' : ''
                }}</text
              ></view
            >
          </view>
          <view class="hs-vrow-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
      </view>
    </view>

    <!-- 单个主题：分段播放 -->
    <view v-else-if="cur">
      <view class="hv-video">
        <!-- 真实视频走云端临时 URL；无视频则占位封面（素材整理中） -->
        <video
          v-if="curUrl"
          class="hv-player"
          :src="curUrl"
          :controls="true"
          :autoplay="true"
          :show-fullscreen-btn="false"
          object-fit="contain"
          @timeupdate="onTime"
          @ended="onEnded"
        ></video>
        <template v-else>
          <MediaSlot ratio="4/5" />
          <view class="hv-soon"><text class="hv-soon-txt">视频整理中…</text></view>
        </template>

        <!-- 顶部 stories 式分段进度条（多段才显·可点段跳转） -->
        <view v-if="segs.length > 1" class="hv-seg">
          <view class="hv-seg-bars">
            <view v-for="(s, i) in segs" :key="s.id || i" class="hv-seg-bar" @tap="pickSeg(i)">
              <view class="hv-seg-fill" :style="{ width: segFill(i) + '%' }"></view>
            </view>
          </view>
        </view>
      </view>

      <text v-if="segs.length > 1 && curSeg" class="hv-segname"
        >第 {{ seg + 1 }}/{{ segs.length }} 段{{ curSeg.name ? ' · ' + curSeg.name : '' }}</text
      >
      <text v-if="cur.desc" class="hv-desc">{{ cur.desc }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.hs-detail {
  padding: 4px 18px 26px;
}

/* 空态 */
.hs-empty {
  padding: 38px 16px;
  text-align: center;
}
.hs-empty-t {
  display: block;
  font-size: 15px;
  color: $ink;
}
.hs-empty-s {
  display: block;
  margin-top: 8px;
  font-size: 12.5px;
  color: $content-2;
  line-height: 1.6;
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
.hs-vrow-meta-txt {
  margin-left: 4px;
}
.hs-vrow-chev {
  flex: 0 0 auto;
  display: flex;
  margin-left: 8px;
}

/* 主题分段播放卡片 */
.hv-video {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 14px;
  overflow: hidden;
  background: #1a1620;
}
.hv-player {
  width: 100%;
  height: 100%;
}
.hv-soon {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hv-soon-txt {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.86);
}
.hv-seg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 3;
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
.hv-segname {
  display: block;
  margin: 12px 2px 0;
  font-family: $font-sans;
  font-size: 12.5px;
  color: $purple;
}
.hv-desc {
  display: block;
  margin: 10px 2px 0;
  font-size: 14px;
  line-height: 1.65;
  color: $content;
}
</style>
