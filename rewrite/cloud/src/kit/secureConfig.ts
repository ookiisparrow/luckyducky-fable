import { COLLECTIONS } from '@ldrw/shared'

/**
 * 敏感凭证单源读取（根因#9·决策 2026-07-12：由「云函数环境变量改了要重新部署」升级为
 * 「admin /config-checklist 页填写即生效」）。DB `secureConfig/<docId>.<field>` 优先；为空时回退
 * 同名环境变量（迁移期兼容——旧线仍在环境变量层配置时功能不因本次改动中断，直到admin 重新填一遍）。
 * 写入口单一：adminApi/actions/secureConfig.ts::saveSecureConfig（零回显——本文件只读不回显）。
 */

export type SecureDocId = 'wxkf' | 'wxpay'

const ENV_FALLBACK: Record<string, string> = {
  'wxkf.corpId': 'WXKF_CORPID',
  'wxkf.secret': 'WXKF_SECRET',
  'wxkf.token': 'WXKF_TOKEN',
  'wxkf.aesKey': 'WXKF_AESKEY',
  'wxkf.agentId': 'WXKF_AGENTID',
  'wxkf.miniappAppId': 'WXKF_MINIAPP_APPID',
  'wxkf.thumbMediaId': 'WXKF_THUMB_MEDIA_ID',
  'wxpay.mchPrivateKey': 'WXPAY_MCH_PRIVATE_KEY',
  'wxpay.mchSerial': 'WXPAY_MCH_SERIAL',
}

/** 读一个安全配置字段：DB 命中且非空 → 用它；否则回退环境变量；都没有 → ''。 */
export async function getSecureConfig(db: any, docId: SecureDocId, field: string): Promise<string> {
  const got = await db.collection(COLLECTIONS.secureConfig).doc(docId).get().catch(() => null)
  const v = got && got.data && (got.data as any)[field]
  if (typeof v === 'string' && v) return v
  const envKey = ENV_FALLBACK[`${docId}.${field}`]
  return envKey ? process.env[envKey] || '' : ''
}

/** 一次取一个 doc 的多个字段（省调用方逐字段 await 的重复 db 往返）。 */
export async function getSecureConfigFields(db: any, docId: SecureDocId, fields: string[]): Promise<Record<string, string>> {
  const got = await db.collection(COLLECTIONS.secureConfig).doc(docId).get().catch(() => null)
  const data = (got && got.data) || {}
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = (data as any)[f]
    out[f] = typeof v === 'string' && v ? v : process.env[ENV_FALLBACK[`${docId}.${f}`]] || ''
  }
  return out
}
