#!/usr/bin/env node
/**
 * SSL 证书到期倒计时（每日巡逻项·P0·2026-08-21 工作流1.0）。
 *
 * 背景：2026-08-18 发现 luckyducky.cn 等三张证书自动续费卡「待验证」，2026-09-15 到期——
 * 到期=三站打不开=生意关门。本脚本对站点逐个发起真实 TLS 握手读证书链有效期，
 * 不依赖任何台账手抄（客观计数不手抄）。
 *
 * 输出：每域名剩余天数一行 + 汇总退出码。
 * 退出码：0=全部 > WARN 天数；1=有域名 ≤ WARN 天或探测失败（fail-closed：查不到当坏消息报）。
 * 用法：node scripts/check-cert-expiry.mjs [域名...]（默认内置清单）
 */
import tls from 'node:tls'
import process from 'node:process'

const HOSTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['luckyducky.cn', 'www.luckyducky.cn', 'q.luckyducky.cn', 'kf.luckyducky.cn', 'vod.luckyducky.cn']
const WARN_DAYS = Number(process.env.CERT_WARN_DAYS) || 30

function getCert(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      try {
        const cert = socket.getPeerCertificate()
        resolve({ host, ok: true, validTo: cert.valid_to ? new Date(cert.valid_to) : null })
      } catch (e) {
        resolve({ host, ok: false, error: `cert parse: ${e.message}` })
      }
      socket.end()
    })
    socket.on('error', (e) => resolve({ host, ok: false, error: e.message }))
    socket.on('timeout', () => {
      socket.destroy()
      resolve({ host, ok: false, error: 'timeout' })
    })
  })
}

const results = await Promise.all(HOSTS.map(getCert))
const now = Date.now()
let bad = 0

for (const r of results) {
  if (!r.ok || !r.validTo) {
    bad++
    console.log(`🔴 ${r.host}: 探测失败（${String(r.error).slice(0,140)}…）——fail-closed 当坏消息处理`)
    continue
  }
  const days = Math.floor((r.validTo.getTime() - now) / 86_400_000)
  if (days <= WARN_DAYS) {
    bad++
    console.log(`🔴 ${r.host}: 剩 ${days} 天到期（${r.validTo.toISOString().slice(0, 10)}）——需续期动作`)
  } else {
    console.log(`✅ ${r.host}: 剩 ${days} 天（${r.validTo.toISOString().slice(0, 10)}）`)
  }
}

console.log(bad === 0 ? `\n✅ 全部证书健康（阈值 ${WARN_DAYS} 天）` : `\n❌ ${bad}/${results.length} 个域名叫急`)
process.exit(bad === 0 ? 0 : 1)
