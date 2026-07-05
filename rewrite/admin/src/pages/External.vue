<script setup lang="ts">
// 外部后台直达（design/console.pen S13 视觉·M3 UI 批9）：纯静态外链页——运营日常在本控制台完成，
// 需技术/运维时从这里直达对应官方后台（新窗口打开·noopener）。无后端、无数据（诚实：只放官方 console 真链，
// 不深链到本环境专属 URL·不伪造「套餐续费日期」等动态信息——运维登录后自选环境）。
import { Database, Gauge, Activity, BadgeCheck, Wallet, MonitorSmartphone, Headset, ExternalLink } from 'lucide-vue-next'

const LINKS = [
  { icon: Database, tone: 'purple', title: '云开发控制台', desc: '数据库 · 云存储 · 云函数 · 调用日志——数据与函数的原始管理和排查', host: 'tcb.cloud.tencent.com', url: 'https://tcb.cloud.tencent.com/' },
  { icon: Gauge, tone: 'blue', title: '套餐与用量', desc: '资源用量、到期续费——登录后在环境「套餐/用量」查看当前额度', host: '控制台 · 套餐用量', url: 'https://console.cloud.tencent.com/tcb' },
  { icon: Activity, tone: 'green', title: '运维监控告警', desc: '云函数调用量 · 报错率 · 资源用量告警阈值', host: '云开发 · 监控', url: 'https://console.cloud.tencent.com/tcb/monitor' },
  { icon: BadgeCheck, tone: 'green', title: '微信公众平台', desc: '小程序发布提审 · 隐私保护指引 · 扫普通链接二维码规则', host: 'mp.weixin.qq.com', url: 'https://mp.weixin.qq.com/' },
  { icon: Wallet, tone: 'amber', title: '微信支付商户平台', desc: '支付 / 退款流水核对，处理金额异常单', host: 'pay.weixin.qq.com', url: 'https://pay.weixin.qq.com/' },
  { icon: MonitorSmartphone, tone: 'purple', title: '微信开发者工具', desc: '本地调试 · 真机预览 · 上传体验版（桌面应用）', host: '桌面应用', url: 'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html' },
  { icon: Headset, tone: 'blue', title: '企业微信', desc: '客服接待人配置 · 钱链 / 告警企微推送 · 应用与群机器人', host: 'work.weixin.qq.com', url: 'https://work.weixin.qq.com/' },
]
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>外部后台</h1>
      <p class="sub">需要技术或运维操作时，从这里直达对应官方后台（均在新窗口打开）</p>
    </header>

    <div class="banner">
      <span class="dot">ⓘ</span>
      <span>运营日常（订单 / 退款 / 上新 / 批次 / 看板）在本控制台完成；下面是需要技术或运维时才去的官方后台。</span>
    </div>

    <div class="grid">
      <a v-for="l in LINKS" :key="l.title" class="card" :href="l.url" target="_blank" rel="noopener noreferrer">
        <div class="card-top">
          <div class="ico" :class="l.tone"><component :is="l.icon" :size="20" :stroke-width="1.8" /></div>
          <ExternalLink :size="16" :stroke-width="1.8" class="arrow" />
        </div>
        <div class="card-title">{{ l.title }}</div>
        <p class="card-desc">{{ l.desc }}</p>
        <div class="card-foot">
          <span class="host">{{ l.host }}</span>
          <span class="open">打开 <ExternalLink :size="12" :stroke-width="2" /></span>
        </div>
      </a>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1160px;
}
.page-head {
  margin-bottom: 18px;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: var(--ld-ink);
}
.sub {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--ld-content-2);
}
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 18px;
  margin-bottom: 20px;
  background: var(--ld-bg-lilac);
  border: 1px solid var(--ld-purple-line);
  border-radius: var(--ld-radius);
  font-size: 12.5px;
  color: var(--ld-content);
}
.dot {
  color: var(--ld-brand);
  flex: none;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.card {
  display: block;
  padding: 20px;
  background: var(--ld-bg);
  border: 1px solid var(--ld-line);
  border-radius: var(--ld-radius-l);
  text-decoration: none;
  transition: border-color 0.15s, transform 0.15s;
}
.card:hover {
  border-color: var(--ld-purple-line);
  transform: translateY(-2px);
}
.card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.ico {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
}
.ico.purple {
  background: var(--ld-bg-lilac);
  color: var(--ld-brand);
}
.ico.blue {
  background: var(--ld-bg-faint);
  color: var(--ld-brand-active);
}
.ico.green {
  background: var(--ld-bg-green-soft);
  color: var(--ld-green);
}
.ico.amber {
  background: var(--ld-bg-lilac);
  color: var(--ld-amber);
}
.arrow {
  color: var(--ld-content-2);
}
.card-title {
  margin-top: 16px;
  font-size: 15px;
  font-weight: 700;
  color: var(--ld-ink);
}
.card-desc {
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ld-content-2);
}
.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
}
.host {
  font-size: 11.5px;
  color: var(--ld-content-2);
  font-family: var(--ld-font-mono);
}
.open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-brand);
}
</style>
