import { COLLECTIONS } from '@ldrw/shared'
import { isCollectionMissing, isDocMissing } from './db'

/**
 * 敏感凭证单源读取（根因#9·决策 2026-07-12：由「云函数环境变量改了要重新部署」升级为
 * 「admin /config-checklist 页填写即生效」）。DB `secureConfig/<docId>.<field>` 优先；为空时回退
 * 同名环境变量（迁移期兼容——旧线仍在环境变量层配置时功能不因本次改动中断，直到admin 重新填一遍）。
 * 写入口单一：adminApi/actions/secureConfig.ts::saveSecureConfig（零回显——本文件只读不回显）。
 */

// 'vod'（决策§31 转码管线批1）：腾讯云点播凭证档——secretId/secretKey（批2 服务端 API）、
// playKey（Key 防盗链签名）、procedure（上传自动触发的任务流模板名）。VOD 无环境变量史，
// 不设 ENV_FALLBACK 条目（回退表只服务「旧环境变量层迁移期兼容」，新档一步到位走库）。
type SecureDocId = 'wxkf' | 'wxpay' | 'vod'

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
  return (await getSecureConfigFields(db, docId, [field]))[field]
}

/**
 * 一次取一个 doc 的多个字段（省调用方逐字段 await 的重复 db 往返）。
 * 默认读失败按「库里没填」回退环境变量；strict 时只有缺档/集合未建才算没填，其余读失败照抛——
 * 给要把「读挂了」和「没配置」分开处理的调用方（没配置可以静默跳过，读挂了必须告警）。
 */
export async function getSecureConfigFields(
  db: any,
  docId: SecureDocId,
  fields: string[],
  opts: { strict?: boolean } = {}
): Promise<Record<string, string>> {
  const got = await db
    .collection(COLLECTIONS.secureConfig)
    .doc(docId)
    .get()
    .catch((e: unknown) => {
      if (opts.strict && !isDocMissing(e) && !isCollectionMissing(e)) throw e
      return null
    })
  const data = (got && got.data) || {}
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = (data as any)[f]
    const envKey = ENV_FALLBACK[`${docId}.${f}`]
    out[f] = typeof v === 'string' && v ? v : (envKey && process.env[envKey]) || ''
  }
  return out
}
