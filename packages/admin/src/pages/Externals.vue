<script setup>
/**
 * 外部后台直达（S13）。运营日常（订单/退款/上新/批次/看板）在本控制台完成；本页只是把
 * 需要技术/运维时才去的官方后台收成一处直达入口——「分工」不嵌不重造（决策：自建控制台不
 * 复制官方平台能力，只在它们之上做日常运营）。纯前端·静态链接·新窗口打开。
 *
 * 云开发三入口带本环境 envId（cloudbase-d4gcssqbv06865479）直达；到期日以控制台为准。
 */
import { Database, Package, Activity, MessageSquare, Wallet, Wrench, Headphones } from 'lucide-vue-next'

const ENV = 'cloudbase-d4gcssqbv06865479'
const LINKS = [
  {
    icon: Database,
    title: '云开发控制台',
    desc: '数据库 · 云存储 · 云函数 · 调用日志——数据与函数的原始管理和排查',
    host: 'console.cloud.tencent.com',
    url: `https://console.cloud.tencent.com/tcb/env/index?envId=${ENV}`,
  },
  {
    icon: Package,
    title: '套餐与用量',
    desc: '资源用量 · 到期续费（当前到期 2026-07-11 · 以控制台为准）',
    host: '控制台 · 套餐管理',
    url: `https://console.cloud.tencent.com/tcb/env/index?envId=${ENV}`,
  },
  {
    icon: Activity,
    title: '运维监控告警',
    desc: '云函数调用量 · 报错率 · 资源用量告警阈值设置',
    host: '云开发 · 监控',
    url: `https://console.cloud.tencent.com/tcb/env/monitor?envId=${ENV}`,
  },
  {
    icon: MessageSquare,
    title: '微信公众平台',
    desc: '小程序发布审核 · 隐私保护引导 · 扫码通链接 / 二维码规则',
    host: 'mp.weixin.qq.com',
    url: 'https://mp.weixin.qq.com',
  },
  {
    icon: Wallet,
    title: '微信支付商户平台',
    desc: '支付 / 退款流水核对 · 处理金额异常单（钱链告警去这核对）',
    host: 'pay.weixin.qq.com',
    url: 'https://pay.weixin.qq.com',
  },
  {
    icon: Wrench,
    title: '微信开发者工具',
    desc: '本地调试 · 真机预览 · 上传体验版（桌面应用，点开到下载页）',
    host: '桌面应用',
    desktop: true,
    url: 'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html',
  },
  {
    icon: Headphones,
    title: '企业微信',
    desc: '客服接待人员配置 · 钱链 / 告警企业微信送 · 应用与群机器人',
    host: 'work.weixin.qq.com',
    url: 'https://work.weixin.qq.com',
  },
]
</script>

<template>
  <div>
    <header class="head">
      <div>
        <h1>外部后台</h1>
        <p class="sub">需要技术或运维维护时，从这里直达官方后台（均在新窗口打开）</p>
      </div>
    </header>

    <p class="banner">
      运营日常（订单 / 退款 / 上新 / 批次 / 看板）在本控制台完成；下面是需要技术或运维时才去的官方后台。
    </p>

    <div class="grid">
      <a v-for="l in LINKS" :key="l.title" class="card ext" :href="l.url" target="_blank" rel="noopener noreferrer">
        <div class="ext-top">
          <span class="ico"><component :is="l.icon" :size="20" /></span>
          <span class="open">打开 ↗</span>
        </div>
        <div class="ext-title">{{ l.title }}<span v-if="l.desktop" class="tag">桌面应用</span></div>
        <p class="ext-desc">{{ l.desc }}</p>
        <span class="ext-host">{{ l.host }}</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.head {
  margin-bottom: 16px;
}
h1 {
  font-size: 22px;
  color: var(--ink);
  margin: 0 0 5px;
}
.sub {
  margin: 0;
  font-size: 12.5px;
  color: var(--content-2);
}
.banner {
  margin: 0 0 18px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  font-size: 12px;
  color: var(--purple-meta);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.ext {
  display: block;
  padding: 18px 20px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s, transform 0.05s;
}
.ext:hover {
  border-color: var(--purple-line);
  background: var(--bg-lilac);
}
.ext:active {
  transform: translateY(1px);
}
.ext-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ico {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--bg-lilac);
  border: 1px solid var(--purple-line);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand-active);
}
.open {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand);
}
.ext-title {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 8px;
}
.tag {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--content-2);
  background: var(--bg-grey);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}
.ext-desc {
  margin: 7px 0 12px;
  font-size: 12px;
  color: var(--content-2);
  line-height: 1.55;
}
.ext-host {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  color: var(--purple-meta);
}
</style>
