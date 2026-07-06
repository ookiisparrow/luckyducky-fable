<script setup lang="ts">
// 外部后台直达（design/console.pen S13 视觉·M3 UI 批9）：纯静态外链页——运营日常在本控制台完成，
// 需技术/运维时从这里直达对应官方后台（新窗口打开·noopener）。无后端、无数据。
// 诚实边界：三个腾讯云 env-scoped 链带 envId 深链＝**预选本环境**（省登录后手选一步·标准便利·非伪造）；
// 但仍**不伪造动态信息**（如「套餐续费日期」）——续费/用量文案只说「登录后查看」，动态数字交官方后台。
import { computed } from 'vue'
import { Database, Gauge, Activity, BadgeCheck, Wallet, MonitorSmartphone, Headset, ExternalLink } from 'lucide-vue-next'
import PageHeader from '../components/ui/PageHeader.vue'
import Card from '../components/ui/Card.vue'
import Badge from '../components/ui/Badge.vue'

// 生产 env id 从后端端点派生（不新增硬编码单源·VITE_ADMIN_API 已含：https://<envId>-<num>.<region>.app.tcloudbase.com/adminv2）
const envId = (String(import.meta.env.VITE_ADMIN_API || '').match(/\/\/(cloudbase-[a-z0-9]+)-\d+/) || [])[1] || ''
function withEnv(url: string): string {
  return envId ? url + (url.includes('?') ? '&' : '?') + 'envId=' + envId : url // 无 env（本地未配）则退回通用链·不断
}

const RAW_LINKS = [
  { icon: Database, tone: 'purple', title: '云开发控制台', desc: '数据库 · 云存储 · 云函数 · 调用日志——数据与函数的原始管理和排查', host: 'tcb.cloud.tencent.com', url: 'https://tcb.cloud.tencent.com/dev', deepEnv: true },
  { icon: Gauge, tone: 'blue', title: '套餐与用量', desc: '资源用量、到期续费——登录后在环境「套餐/用量」查看当前额度', host: '控制台 · 套餐用量', url: 'https://console.cloud.tencent.com/tcb', deepEnv: true },
  { icon: Activity, tone: 'green', title: '运维监控告警', desc: '云函数调用量 · 报错率 · 资源用量告警阈值', host: '云开发 · 监控', url: 'https://console.cloud.tencent.com/tcb/monitor', deepEnv: true },
  { icon: BadgeCheck, tone: 'green', title: '微信公众平台', desc: '小程序发布提审 · 隐私保护指引 · 扫普通链接二维码规则', host: 'mp.weixin.qq.com', url: 'https://mp.weixin.qq.com/', deepEnv: false },
  { icon: Wallet, tone: 'amber', title: '微信支付商户平台', desc: '支付 / 退款流水核对，处理金额异常单', host: 'pay.weixin.qq.com', url: 'https://pay.weixin.qq.com/', deepEnv: false },
  { icon: MonitorSmartphone, tone: 'purple', title: '微信开发者工具', desc: '本地调试 · 真机预览 · 上传体验版（桌面应用）', host: '桌面应用', url: 'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html', deepEnv: false },
  { icon: Headset, tone: 'blue', title: '企业微信', desc: '客服接待人配置 · 钱链 / 告警企微推送 · 应用与群机器人', host: 'work.weixin.qq.com', url: 'https://work.weixin.qq.com/', deepEnv: false },
]
// env-scoped 链带 envId 预选本环境；其余原样
const LINKS = computed(() => RAW_LINKS.map((l) => ({ ...l, href: l.deepEnv ? withEnv(l.url) : l.url })))
</script>

<template>
  <div class="ld-page">
    <PageHeader title="外部后台" sub="需要技术或运维操作时，从这里直达对应官方后台（均在新窗口打开）" />

    <div class="banner">
      <span class="banner-mark">ⓘ</span>
      <span>运营日常（订单 / 退款 / 上新 / 批次 / 看板）在本控制台完成；下面是需要技术或运维时才去的官方后台。</span>
    </div>

    <div class="ext-grid">
      <a
        v-for="l in LINKS"
        :key="l.title"
        class="ext-card-link"
        :href="l.href"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Card class="ext-card">
          <div class="ext-top">
            <div class="ext-id">
              <div class="ext-ico" :class="l.tone"><component :is="l.icon" :size="20" :stroke-width="1.8" /></div>
              <span class="ext-title">{{ l.title }}</span>
            </div>
            <Badge v-if="l.deepEnv && envId" tone="brand">预选本环境</Badge>
          </div>
          <p class="ext-desc">{{ l.desc }}</p>
          <div class="ext-foot">
            <span class="ext-open">打开后台 <ExternalLink :size="14" :stroke-width="1.8" /></span>
            <span class="ext-host">{{ l.host }}</span>
          </div>
        </Card>
      </a>
    </div>
  </div>
</template>

<style scoped>
/* 信息横幅（本页独有·淡紫底提示条） */
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 18px;
  background: var(--ld-bg-lilac);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  font-size: 12.5px;
  color: var(--ld-content);
}
.banner-mark {
  color: var(--ld-brand);
  flex: none;
}

/* 平台直达卡片网格（2×3 意向·窄屏自适应） */
.ext-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
/* 整卡可点：卡外包一层 <a>（点卡片任意处即在新窗口打开对应后台·恢复原整卡链接语义） */
.ext-card-link {
  display: block;
  height: 100%;
  text-decoration: none;
}
.ext-card {
  height: 100%;
  transition: border-color 0.15s;
}
.ext-card-link:hover .ext-card {
  border-color: var(--ld-purple-line);
}
.ext-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.ext-id {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.ext-ico {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--ld-radius-sm);
}
.ext-ico.purple {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand);
}
.ext-ico.blue {
  background: var(--ld-bg-faint);
  color: var(--ld-brand-active);
}
.ext-ico.green {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.ext-ico.amber {
  background: var(--ld-bg-amber-soft);
  color: var(--ld-amber);
}
.ext-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--ld-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ext-desc {
  margin: 14px 0 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ld-content-2);
}
.ext-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--ld-line);
}
.ext-open {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ld-brand);
  text-decoration: none;
}
.ext-host {
  font-size: 11.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
