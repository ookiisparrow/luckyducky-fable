<script setup>
/**
 * 节点诊断·拍照上传页（后台360工作站 B2.2·用户侧·分包 pkg-extra）。
 * 学员在一门课的关键节点拍照上传成果/卡点，坐席在后台客户360「节点照片」面板看，结合「挽回办法」精准指导。
 * 入口（courseId/nodeId/title 经页面 query 传入·后续从播放页关键节点接入）；上传走 api/checkpoint.js →
 *   云函数 submitCheckpointPhoto（openid 闸 + 频控 + 进课校验 + imgSecCheck 内容安全 fail-closed，云端只写本人）。
 * 复用 profile-edit 的取图模式（uni.chooseImage·相机/相册）；多端：px 不 rpx、图位用 MediaSlot、交互用 view+@tap。
 */
import { ref, computed } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import CoNavBar from '@/components/CoNavBar.vue'
import MediaSlot from '@/components/MediaSlot.vue'
import { goBack } from '@/utils/nav.js'
import { ensureLogin } from '@/composables/useAuthGate.js'
import { useTimers } from '@/composables/useTimers.js'
import { submitCheckpointPhoto } from '@/api/checkpoint.js'

const { later } = useTimers()

const courseId = ref('')
const nodeId = ref('')
const title = ref('')
const photo = ref('') // 本地临时路径
const submitting = ref(false)

const ready = computed(() => !!courseId.value && !!nodeId.value)
const canSubmit = computed(() => ready.value && !!photo.value && !submitting.value)

onLoad((q) => {
  if (q) {
    courseId.value = q.courseId || ''
    nodeId.value = q.nodeId || ''
    title.value = q.title ? decodeURIComponent(q.title) : ''
  }
})

const back = () => goBack('/pages/me/index')

// 取图（相机优先·也可相册）——与 profile-edit 同模式
function pickPhoto() {
  uni.chooseImage({
    count: 1,
    sourceType: ['camera', 'album'],
    success: (res) => {
      photo.value = (res.tempFilePaths && res.tempFilePaths[0]) || ''
    },
  })
}

// 友好错误提示（云端精确码 → 人话）
const ERR_MSG = {
  IMG_RISKY: '照片含违规内容，换一张再试',
  SEC_CHECK_FAIL: '内容审核暂时不可用，请稍后再试',
  NOT_ENTITLED: '请先进入该课程学习后再上传',
  NO_CLOUD: '请在微信小程序内上传照片',
  BAD_ARGS: '参数缺失，请从课程节点进入',
}

async function submit() {
  if (!canSubmit.value) return
  if (!ensureLogin()) return // 上传绑 openid，需登录
  submitting.value = true
  const res = await submitCheckpointPhoto({
    courseId: courseId.value,
    nodeId: nodeId.value,
    filePath: photo.value,
  })
  submitting.value = false
  if (res.ok) {
    uni.showToast({ title: '已上传，老师会看到', icon: 'none' })
    later(back, 800)
  } else {
    uni.showToast({ title: ERR_MSG[res.error] || '上传失败，请重试', icon: 'none' })
  }
}
</script>

<template>
  <view class="co">
    <CoNavBar title="上传节点照片" @back="back" />

    <view class="co-body">
      <view v-if="!ready" class="ck-empty">
        <text>请从课程里的关键节点进入本页（缺少课程或节点信息）。</text>
      </view>

      <template v-else>
        <view class="co-card ck-card">
          <text v-if="title" class="ck-node">{{ title }}</text>
          <text class="ck-hint">拍张照片让老师看看你钩到哪了 / 卡在哪，会有针对性的提示。</text>

          <view class="ck-photo" @tap="pickPhoto">
            <MediaSlot ratio="1/1" :radius="16" :src="photo" />
            <view v-if="!photo" class="ck-photo-tip"><text>点这里拍照 / 选图</text></view>
          </view>
          <view v-if="photo" class="ck-repick" @tap="pickPhoto"><text>重新选择</text></view>
        </view>

        <view class="ck-dock">
          <view class="ck-submit" :class="{ disabled: !canSubmit }" @tap="submit">
            <text>{{ submitting ? '上传中…' : '上传给老师看' }}</text>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

.ck-empty {
  margin: 40px 16px;
  text-align: center;
  font-size: 14px;
  color: $purple-meta;
  line-height: 1.7;
}
.ck-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
}
.ck-node {
  font-size: 16px;
  font-weight: 700;
  color: $ink;
}
.ck-hint {
  font-size: 12.5px;
  color: $purple-meta;
  line-height: 1.6;
}
.ck-photo {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 8px auto 0;
}
.ck-photo-tip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: $purple-meta;
}
.ck-repick {
  text-align: center;
  font-size: 12.5px;
  color: $purple;
  margin-top: 4px;
}
.ck-dock {
  margin: 24px 16px 0;
}
.ck-submit {
  height: 48px;
  border-radius: $r-lg;
  background: $purple;
  color: $white;
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ck-submit.disabled {
  opacity: 0.5;
}
</style>
