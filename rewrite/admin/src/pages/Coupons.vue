<script setup lang="ts">
// 商品券领取开关（测试版·只发券不核销）。证书走 saveSecureConfig/wxbrand，与支付密钥同口、不回显。
import { ref, onMounted } from 'vue'
import { getCouponConfig, saveCouponConfig, setCouponNotifyUrl } from '../api/coupons'
import { saveSecureConfig } from '../api/system'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'
import UiButton from '../components/ui/Button.vue'

const offer = ref({
  enabled: false,
  label: '',
  brandId: '',
  productCouponId: '',
  stockId: '',
  notifyUrl: '',
  appid: '',
})
const secrets = ref({
  brandPrivateKey: '',
  brandSerial: '',
  wxpayPublicKey: '',
  wxpayPublicKeyId: '',
  brandApiKey: '',
})
const message = ref('')
const ok = ref(false)
const busy = ref(false)
const certBusy = ref(false)
const notifyBusy = ref(false)
let loaded = false

onMounted(async () => {
  const r: any = await getCouponConfig()
  if (r.error === 'SESSION_LOST') return
  if (!r.ok) {
    message.value = '加载失败：' + String(r.error || '')
    return
  }
  offer.value = { ...offer.value, ...(r.offer || {}) }
  loaded = true
})

async function save() {
  if (busy.value || !loaded) return
  busy.value = true
  ok.value = false
  const r: any = await saveCouponConfig({ ...offer.value })
  busy.value = false
  if (r.error === 'SESSION_LOST') return
  if (r.ok) {
    offer.value = { ...offer.value, ...(r.offer || {}) }
    ok.value = true
    message.value = '已保存'
  } else {
    message.value = '保存失败：' + String(r.error || '')
  }
}

async function saveCerts() {
  if (certBusy.value) return
  const fields: Record<string, string> = {}
  for (const [k, v] of Object.entries(secrets.value)) {
    const t = v.trim()
    if (t) fields[k] = t
  }
  if (!Object.keys(fields).length) {
    message.value = '证书栏留空＝不改动。请粘贴要更新的项再保存。'
    ok.value = false
    return
  }
  certBusy.value = true
  const r: any = await saveSecureConfig('wxbrand', fields)
  certBusy.value = false
  if (r.error === 'SESSION_LOST') return
  if (r.ok) {
    secrets.value = { brandPrivateKey: '', brandSerial: '', wxpayPublicKey: '', wxpayPublicKeyId: '', brandApiKey: '' }
    ok.value = true
    message.value = '品牌证书已保存（不回显）'
  } else {
    message.value = '证书保存失败：' + String(r.error || '')
    ok.value = false
  }
}

async function pushNotify() {
  if (notifyBusy.value) return
  notifyBusy.value = true
  const r: any = await setCouponNotifyUrl()
  notifyBusy.value = false
  if (r.error === 'SESSION_LOST') return
  if (r.ok) {
    ok.value = true
    message.value = '已向微信登记回调地址'
  } else {
    ok.value = false
    message.value = '登记失败：' + String(r.error || '')
  }
}
</script>

<template>
  <div class="ld-page">
    <PageHeader title="商品券" sub="微信支付品牌经营商品券 · 关掉则小程序不出现领券 · 本批只发券不核销">
      <Badge :tone="offer.enabled ? 'green' : 'neutral'" dot>{{ offer.enabled ? '领取开着' : '领取关着' }}</Badge>
      <UiButton :disabled="busy || !loaded" @click="save">{{ busy ? '保存中…' : '保存开关' }}</UiButton>
    </PageHeader>

    <p v-if="message" class="status" :class="{ ok }">{{ message }}</p>

    <div class="ld-cols-2">
      <Card title="领取开关">
        <div class="row">
          <span>允许顾客领取</span>
          <button class="switch" :class="{ on: offer.enabled }" @click="offer.enabled = !offer.enabled">
            <span class="knob" />
          </button>
        </div>
        <div class="field">
          <label>展示文案</label>
          <input v-model="offer.label" maxlength="40" placeholder="例如：领取开业优惠" />
        </div>
        <div class="field">
          <label>brand_id</label>
          <input v-model="offer.brandId" placeholder="品牌经营平台里的品牌 ID" autocomplete="off" />
        </div>
        <div class="field">
          <label>商品券 ID</label>
          <input v-model="offer.productCouponId" placeholder="创建商品券后微信返回" autocomplete="off" />
        </div>
        <div class="field">
          <label>批次 ID</label>
          <input v-model="offer.stockId" placeholder="商品券批次 ID，可先手填" autocomplete="off" />
        </div>
        <div class="field">
          <label>小程序 AppID</label>
          <input v-model="offer.appid" placeholder="默认用现网小程序" autocomplete="off" />
        </div>
        <div class="field">
          <label>发放回调地址</label>
          <input v-model="offer.notifyUrl" placeholder="https://…/couponNotify（部署后再填）" autocomplete="off" />
        </div>
        <UiButton variant="ghost" :disabled="notifyBusy || !offer.notifyUrl" @click="pushNotify">
          {{ notifyBusy ? '登记中…' : '把回调地址推给微信' }}
        </UiButton>
      </Card>

      <Card title="品牌证书">
        <p class="note">
          和支付密钥同一套保存口，填了立刻进库、页面永不回显。请在品牌经营平台下载后自己粘贴，不要发到聊天或 git。
          入驻入口：pay.weixin.qq.com 品牌经营平台。
        </p>
        <div class="field">
          <label>品牌 API 证书私钥</label>
          <textarea v-model="secrets.brandPrivateKey" rows="6" placeholder="粘贴 PEM 后保存" autocomplete="off" />
        </div>
        <div class="field">
          <label>品牌 API 证书序列号</label>
          <input v-model="secrets.brandSerial" type="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label>微信支付公钥</label>
          <textarea v-model="secrets.wxpayPublicKey" rows="5" placeholder="验签用公钥 PEM" autocomplete="off" />
        </div>
        <div class="field">
          <label>微信支付公钥 ID</label>
          <input v-model="secrets.wxpayPublicKeyId" autocomplete="off" />
        </div>
        <div class="field">
          <label>品牌 API 密钥（32 位，回调解密）</label>
          <input v-model="secrets.brandApiKey" type="password" maxlength="32" autocomplete="new-password" />
        </div>
        <UiButton variant="ghost" :disabled="certBusy" @click="saveCerts">{{ certBusy ? '保存中…' : '保存证书' }}</UiButton>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.status {
  font-size: 13px;
  color: var(--ld-red);
}
.status.ok {
  color: var(--ld-green);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.switch {
  width: 40px;
  height: 22px;
  border: 0;
  border-radius: 99px;
  background: var(--ld-line);
  position: relative;
  cursor: pointer;
}
.switch.on {
  background: var(--ld-green);
}
.knob {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
}
.switch.on .knob {
  left: 21px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.field label {
  font-size: 12px;
  color: var(--ld-muted);
}
.field input,
.field textarea {
  border: 1px solid var(--ld-line);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}
.note {
  font-size: 13px;
  color: var(--ld-muted);
  line-height: 1.5;
  margin: 0 0 12px;
}
</style>
