<script setup>
/**
 * 用户协议 / 隐私政策（占位）。?type=user|privacy 切标题与正文。
 * ⚠️ 占位内容——真实法律条款上线前补（见 docs/上线前占位清单.md）；
 * 微信端「隐私保护指引」需在 mp 后台另行配置（wx.requirePrivacyAuthorize），属上线配置项。
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import CoNavBar from '@/components/CoNavBar.vue'
import { goBack } from '@/utils/nav.js'

const MAP = {
  user: {
    title: '用户协议',
    body: '本《用户协议》为占位文本，用于跑通登录授权流程。正式条款将在上线前补齐，明确服务范围、账户与订单、退换货与售后、知识产权、责任限制与争议解决等。',
  },
  privacy: {
    title: '隐私政策',
    body: '本《隐私政策》为占位文本，用于跑通登录授权流程。正式条款将在上线前补齐，说明收集的信息范围（微信头像 / 昵称、订单与收货信息、学习进度）、用途、存储与第三方共享、用户权利与联系方式；不采集手机号。',
  },
}
const data = ref(MAP.user)
onLoad((q) => {
  data.value = MAP[q && q.type] || MAP.user
})
const back = () => goBack('/pages/index/index')
</script>

<template>
  <view class="co">
    <CoNavBar :title="data.title" @back="back" />
    <view class="co-body">
      <view class="co-card agree">
        <text class="agree-badge">占位文本</text>
        <text class="agree-body">{{ data.body }}</text>
        <text class="agree-note">正式条款上线前补齐。</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

.agree {
  padding: 18px;
}
.agree-badge {
  display: inline-block;
  align-self: flex-start;
  font-size: 11px;
  color: $duck-orange;
  background: $bg-cream;
  border: 1px solid $line-cream;
  border-radius: $r-xs;
  padding: 2px 8px;
  margin-bottom: 12px;
}
.agree-body {
  display: block;
  font-size: 14px;
  line-height: 1.8;
  color: $content;
}
.agree-note {
  display: block;
  margin-top: 16px;
  font-size: 12px;
  color: $purple-meta;
}
</style>
