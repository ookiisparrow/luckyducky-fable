<script setup>
/**
 * 求助面板 ·「遇到问题了」：辅助视频列表 / 单个视频。
 * 视频内容来自控制台「帮助视频」管理（全局共用·所有课程同一份），由壳层 index.vue 拉取后经 items 传入。
 * 选中态（topic）放在壳里 —— 壳的标题与返回键依赖它；本组件只负责展示与真实播放。
 * 真实视频：src 走云端短时效临时 URL（item.url·审计 P1·fileID 不出接口）；无视频则占位封面。
 */
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import MediaSlot from '@/components/MediaSlot.vue'

const props = defineProps({
  items: { type: Array, default: () => [] }, // 辅助视频列表（云端，全局共用）
  topic: { type: Number, default: null }, // null=列表 / 序号=播放该条
})
defineEmits(['pick'])

const cur = computed(() => (props.topic !== null ? props.items[props.topic] : null))
</script>

<template>
  <view class="hs-detail">
    <!-- 列表 -->
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
              ><Icon name="play-purple" :size="13" /><text
                >视频{{ t.dur ? ' · ' + t.dur : '' }}</text
              ></view
            >
          </view>
          <view class="hs-vrow-chev"><Icon name="chevron-right" :size="18" /></view>
        </view>
      </view>
    </view>

    <!-- 单个视频 -->
    <view v-else-if="cur">
      <view class="hv-video">
        <!-- 真实视频走云端临时 URL；无视频则占位封面（素材整理中） -->
        <video
          v-if="cur.url"
          class="hv-player"
          :src="cur.url"
          :show-center-play-btn="true"
          object-fit="contain"
          :enable-progress-gesture="true"
        ></video>
        <template v-else>
          <MediaSlot ratio="4/5" />
          <view class="hv-soon"><text>视频整理中…</text></view>
        </template>
      </view>
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
.hv-soon text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.86);
}
.hv-desc {
  display: block;
  margin: 15px 2px 0;
  font-size: 14px;
  line-height: 1.65;
  color: $content;
}
</style>
