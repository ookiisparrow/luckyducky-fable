<script setup>
/**
 * 数据共享授权（后台360工作站 B3.3·承面C 车道 C）。
 * 客户对「外包/第三方客服（受托客服人员）在为你服务所必需的范围内查看你的订单/物流/学习/咨询记录」
 * 作出同意 / 撤回。写云函数 dataConsent（openid 闸·只写本人 users.csDataShare）。**服务端为授权真值**——
 * 外包坐席看你的 360 前，云端经 kit/csAccess.assertDataShareConsent 校验此态（未同意即拒·fail-closed）。
 * 完整声明文案在协议/隐私页（法律定稿归律师）。独立于微信系统级隐私授权（PrivacySheet）。
 * 本页开关初始态取本地提示（仅显示用·非真值），提交以服务端为准。
 */
import { ref } from 'vue'
import CoNavBar from '@/components/CoNavBar.vue'
import { goBack } from '@/utils/nav.js'
import { setDataShareConsent, readConsentHint } from '@/api/consent.js'

const consented = ref(readConsentHint()) // true / false / null(未知)
const busy = ref(false)

const back = () => goBack('/pages/me/index')

async function submit(agree) {
  if (busy.value) return
  busy.value = true
  const ok = await setDataShareConsent(agree)
  busy.value = false
  if (ok) {
    consented.value = agree
    uni.showToast({ title: agree ? '已同意数据共享' : '已撤回授权', icon: 'none' })
  } else {
    uni.showToast({ title: '操作失败，请在微信小程序内重试', icon: 'none' })
  }
}

const openPolicy = () => uni.navigateTo({ url: '/pages/agreement/index?type=privacy' })
</script>

<template>
  <view class="co">
    <CoNavBar title="数据共享授权" @back="back" />
    <view class="co-body">
      <view class="co-card cs">
        <text class="cs-h">关于外包/第三方客服访问你的数据</text>
        <text class="cs-p">
          为向你提供客服与售后支持，我们可能安排外包或第三方客服（受托客服人员）在为你服务所必需的范围内，
          查看你的订单、物流、学习进度与咨询记录等数据，以更准确地响应你的请求。
        </text>
        <text class="cs-p">
          此类第三方受托客服访问以你的同意为前提。你可在本页随时同意或撤回该数据共享授权；撤回后，
          外包坐席将无法再查看你的上述数据（不影响此前已依约进行的处理）。
        </text>

        <view class="cs-state" :class="{ on: consented === true, off: consented === false }">
          <text class="cs-state-t">{{
            consented === true
              ? '当前状态：已同意共享'
              : consented === false
                ? '当前状态：已撤回授权'
                : '当前状态：尚未选择'
          }}</text>
        </view>

        <view class="cs-acts">
          <view class="cs-btn primary" :class="{ dim: busy }" @tap="submit(true)">
            <text class="cs-btn-t on">同意共享</text>
          </view>
          <view class="cs-btn ghost" :class="{ dim: busy }" @tap="submit(false)">
            <text class="cs-btn-t">撤回授权</text>
          </view>
        </view>

        <view class="cs-link" @tap="openPolicy"
          ><text class="cs-link-t">查看完整隐私政策 ›</text></view
        >
        <text class="cs-note">以服务端记录为准；如需协助可通过本小程序客服与我们联系。</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
@import '../../styles/co.scss';

.cs {
  padding: 18px;
}
.cs-h {
  display: block;
  font-size: 15px;
  font-weight: 600;
  color: $content;
  margin-bottom: 12px;
}
.cs-p {
  display: block;
  font-size: 13px;
  line-height: 1.8;
  color: $content;
  margin-bottom: 12px;
}
.cs-state {
  margin: 4px 0 16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: $bg-lilac;
  border: 1px solid $line;
}
.cs-state.on {
  background: $bg-sage;
  border-color: $purple-line;
}
.cs-state.off {
  background: $bg-grey;
}
.cs-state-t {
  font-size: 13px;
  color: $content-2;
}
.cs-acts {
  display: flex;
  gap: 12px;
  margin-bottom: 14px;
}
.cs-btn {
  flex: 1;
  height: 46px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cs-btn.primary {
  background: $purple-ink;
}
.cs-btn.ghost {
  background: $white;
  border: 1px solid $line-strong;
}
.cs-btn.dim {
  opacity: 0.55;
}
.cs-btn-t {
  font-size: 14px;
  font-weight: 600;
  color: $content;
}
.cs-btn-t.on {
  color: $white;
}
.cs-link {
  padding: 6px 0 2px;
}
.cs-link-t {
  font-size: 13px;
  color: $brand;
}
.cs-note {
  display: block;
  font-size: 12px;
  line-height: 1.7;
  color: $purple-meta;
  margin-top: 8px;
}
</style>
