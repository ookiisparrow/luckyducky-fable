#!/usr/bin/env node
/**
 * SSL 证书到期倒计时（每日巡逻项③）。
 *
 * 对清单里的主机做真实 TLS 握手，读证书到期日。到期日以这次探测为准，不手抄台账。
 * 裸域 luckyducky.cn 没有 DNS，不进默认清单：放进去每日巡逻会因解析失败永远报红，
 * 出不了「平安报」。裸域解析问题记在运维文档，不要和「证书快到期」混在一起。
 * 命令行传入域名时只查传入的那些（要单独看裸域时再写上）。
 *
 * 退出码：0=全部剩余天数 > WARN；1=有域名 ≤ WARN 天，或探测失败（查不到当坏消息）。
 * 用法：node scripts/check-cert-expiry.mjs [域名...]
 * 阈值：环境变量 CERT_WARN_DAYS，默认 30。
 */
import tls from 'node:tls'
import process from 'node:process'

const DEFAULT_HOSTS = [
  'www.luckyducky.cn',
  'q.luckyducky.cn',
  'kf.luckyducky.cn',
  'vod.luckyducky.cn',
]
const HOSTS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_HOSTS
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
