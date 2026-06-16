<script setup>
/**
 * 求助面板（player 专属）：在线客服 / 遇到问题(辅助视频) / 常见问题 / 学习交流群 / 反馈视频问题。
 * 本文件只是壳：开合状态 + 面板路由 + 头部；各面板拆在同目录子组件，样例文案在 ./data.js。
 * 父级（播放页）用 ref 调 open() 打开（打开前由父级负责暂停主视频）。
 * 面板内的提示类副作用统一 emit('action') 回到这里 toast，便于将来换真实动作。
 */
import { ref, computed } from 'vue'
import Icon from '@/components/Icon.vue'
import ServicePanel from './ServicePanel.vue'
import TroublePanel from './TroublePanel.vue'
import FaqPanel from './FaqPanel.vue'
import GroupPanel from './GroupPanel.vue'
import ReportPanel from './ReportPanel.vue'
import { HELP_OPTS, TROUBLE } from './data.js'
import { openCustomerService } from '@/utils/customerService.js'

defineProps({
  ep: { type: String, default: '' },
  title: { type: String, default: '' },
})

const help = ref(false)
const helpView = ref(null) // null=选项 / service / step / faq / group / report
const helpTopic = ref(null) // 'step' 下选中的辅助视频 index（标题/返回键依赖，故放壳里）

const inTopic = computed(() => helpView.value === 'step' && helpTopic.value !== null)
const sheetTitle = computed(() => {
  if (inTopic.value) return TROUBLE[helpTopic.value].title
  if (helpView.value)
    return (HELP_OPTS.find((o) => o.id === helpView.value) || {}).title || '需要帮忙吗？'
  return '需要帮忙吗？'
})

// 父级（播放页）暂停主视频后，用 ref 调本方法打开面板
function open() {
  help.value = true
  helpView.value = null
  helpTopic.value = null
}
function closeHelp() {
  help.value = false
  helpView.value = null
  helpTopic.value = null
}
function sheetBack() {
  if (inTopic.value) helpTopic.value = null
  else helpView.value = null
}
function helpAction(msg) {
  uni.showToast({ title: msg, icon: 'none' })
}

defineExpose({ open })
</script>

<template>
  <view class="vp-helpsheet" :class="{ on: help }">
    <view class="vp-sheet-backdrop" @tap="closeHelp"></view>
    <view class="vp-sheet">
      <view class="vp-sheet-grab"></view>
      <view class="vp-sheet-head">
        <view v-if="helpView" class="vp-sheet-back" @tap="sheetBack"
          ><Icon name="chevron-left-ink" :size="21"
        /></view>
        <view class="vp-sheet-htext">
          <text class="vp-sheet-title">{{ sheetTitle }}</text>
          <text v-if="!helpView" class="vp-sheet-sub">{{ ep }} · {{ title }}</text>
        </view>
        <view class="vp-sheet-x" @tap="closeHelp"><Icon name="x-ink" :size="18" /></view>
      </view>
      <view class="vp-sheet-body">
        <!-- 选项列表 -->
        <view v-if="!helpView" class="vp-sheet-list">
          <view v-for="o in HELP_OPTS" :key="o.id" class="vp-opt" @tap="helpView = o.id">
            <view class="vp-opt-ico"><Icon :name="o.icon" :size="21" /></view>
            <view class="vp-opt-mid">
              <text class="vp-opt-title">{{ o.title }}</text>
              <text class="vp-opt-sub">{{ o.sub }}</text>
            </view>
            <view class="vp-opt-chev"><Icon name="chevron-right" :size="18" /></view>
          </view>
        </view>
        <ServicePanel
          v-else-if="helpView === 'service'"
          @action="helpAction"
          @service="openCustomerService"
        />
        <TroublePanel
          v-else-if="helpView === 'step'"
          :topic="helpTopic"
          @pick="helpTopic = $event"
        />
        <FaqPanel v-else-if="helpView === 'faq'" />
        <GroupPanel v-else-if="helpView === 'group'" @action="helpAction" />
        <ReportPanel v-else-if="helpView === 'report'" @action="helpAction" />
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
/* —— 面板壳：遮罩 + 抽屉 + 头部 —— */
.vp-helpsheet {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}
.vp-helpsheet.on {
  pointer-events: auto;
}
.vp-sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.3s;
}
.vp-helpsheet.on .vp-sheet-backdrop {
  opacity: 1;
}
.vp-sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 76%;
  background: $bg-grey;
  border-radius: 22px 22px 0 0;
  box-shadow: 0 -12px 44px rgba(0, 0, 0, 0.32);
  transform: translateY(101%);
  transition: transform 0.34s cubic-bezier(0.22, 0.61, 0.36, 1);
  display: flex;
  flex-direction: column;
  color: $ink;
  overflow: hidden;
}
.vp-helpsheet.on .vp-sheet {
  transform: none;
}
.vp-sheet-grab {
  width: 38px;
  height: 4px;
  border-radius: 999px;
  background: $line-strong;
  margin: 11px auto 4px;
}
.vp-sheet-head {
  display: flex;
  align-items: flex-start;
  padding: 10px 16px 14px;
}
.vp-sheet-back,
.vp-sheet-x {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-top: 2px;
}
.vp-sheet-back:active,
.vp-sheet-x:active {
  background: rgba(0, 0, 0, 0.12);
}
.vp-sheet-back {
  margin-right: 12px;
}
.vp-sheet-htext {
  flex: 1 1 auto;
  min-width: 0;
}
.vp-sheet-title {
  display: block;
  font-family: $font-display;
  font-weight: 500;
  font-size: 22px;
  color: $ink;
}
.vp-sheet-sub {
  display: block;
  font-size: 13px;
  color: $content-2;
  margin-top: 5px;
}
.vp-sheet-x {
  margin-left: 12px;
}
.vp-sheet-body {
  flex: 1 1 auto;
  overflow-y: auto;
}

/* —— 选项列表 —— */
.vp-sheet-list {
  padding: 2px 16px 24px;
}
.vp-opt {
  display: flex;
  align-items: center;
  padding: 15px 16px;
  background: $white;
  border: 1px solid $surface-cream;
  border-radius: $r-md;
  margin-bottom: 10px;
}
.vp-opt:active {
  background: $bg-faint;
}
.vp-opt-ico {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: $bg-lilac;
  border: 0.5px solid $purple-line;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  margin-right: 14px;
}
.vp-opt-mid {
  flex: 1 1 auto;
  min-width: 0;
}
.vp-opt-title {
  display: block;
  font-size: 16px;
  color: $ink;
}
.vp-opt-sub {
  display: block;
  font-size: 12.5px;
  color: $content-2;
  margin-top: 3px;
  line-height: 1.45;
}
.vp-opt-chev {
  flex: 0 0 auto;
  display: flex;
  margin-left: 8px;
}
</style>
