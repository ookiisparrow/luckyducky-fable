<script setup>
/** 求助面板 · 反馈视频问题（类型选择留在组件内；提交 emit 给壳 toast）。 */
import { ref } from 'vue'
import { REPORT_TYPES } from './data.js'

const emit = defineEmits(['action'])
const reportSel = ref(null)
</script>

<template>
  <view class="hs-detail">
    <text class="hs-flabel">遇到了什么问题？</text>
    <view class="hs-chips">
      <view
        v-for="(t, i) in REPORT_TYPES"
        :key="i"
        class="hs-chip"
        :class="{ on: reportSel === i }"
        @tap="reportSel = i"
        >{{ t }}</view
      >
    </view>
    <text class="hs-flabel mt">补充描述（选填）</text>
    <textarea class="hs-textarea" placeholder="再多告诉我们一点，比如出现在第几分钟…" />
    <view
      class="hs-submit"
      :class="{ disabled: reportSel === null }"
      @tap="reportSel !== null && emit('action', '反馈已收到 · 感谢你帮小鸭变得更好~')"
      >提交反馈</view
    >
  </view>
</template>

<style lang="scss" scoped>
.hs-detail {
  padding: 4px 18px 26px;
}
.hs-chips {
  display: flex;
  flex-wrap: wrap;
}
.hs-chip {
  border: 1px solid $line-strong;
  background: $white;
  color: $ink;
  border-radius: 999px;
  padding: 9px 15px;
  font-size: 13.5px;
  margin: 0 9px 9px 0;
}
.hs-chip:active {
  background: $bg-grey;
}
.hs-chip.on {
  background: $purple;
  border-color: $purple;
  color: $white;
}
.hs-flabel {
  display: block;
  font-size: 13.5px;
  color: $content;
  font-weight: 500;
  margin: 8px 0 11px;
}
.hs-flabel.mt {
  margin-top: 22px;
}
.hs-textarea {
  width: 100%;
  min-height: 96px;
  border: 1px solid $line-strong;
  border-radius: 12px;
  padding: 13px 14px;
  font-size: 14px;
  color: $ink;
  background: $white;
  box-sizing: border-box;
}
.hs-submit {
  margin-top: 22px;
  height: 50px;
  border-radius: 999px;
  background: $purple;
  color: $white;
  font-weight: 600;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hs-submit.disabled {
  opacity: 0.4;
}
</style>
