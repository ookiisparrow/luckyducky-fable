import { reply, ensure, type Ctx } from '../lib'
import { COLLECTIONS } from '@ldrw/shared'
import { normalizePem } from '../../../kit'

// 人工配置清单可填写化（决策 2026-07-12·config-checklist 补口）：把此前只能去云开发控制台改环境变量/
// 库里手敲 JSON 的敏感凭证 + 支付接缝配置，收口成两个写 action——admin 页填、云函数运行时读库自动生效
// （kit/secureConfig.ts 单源读取）。零回显铁律延伸到写入口：只接收、绝不回显；且 payload 一律嵌套在
// `fields`（saveSecureConfig）之下——adminApi/index.ts 分发处的 recordAudit 会把 `data` 顶层非敏感字段
// 摘要写入 auditLog（见 kit/audit.ts::summarize），嵌套对象会被折叠成 '{…}'、不递归——这是本文件把敏感
// 字段全塞进嵌套 `fields` 而不摊平到顶层的原因（守卫＝tests/secure-config-save.test.ts「审计日志零泄露」
// 哨兵用例焊死此形状：拍平成顶层即红）。
// 留空提交＝不改动该字段（防误清空既有配置，同 saveSettings 合并保存范式）。

const WXKF_FIELDS = ['corpId', 'secret', 'token', 'aesKey', 'agentId', 'miniappAppId', 'thumbMediaId'] as const
const WXPAY_FIELDS = ['mchPrivateKey', 'mchSerial'] as const
// VOD 凭证档（决策§31 转码管线·kit/vod.ts 读取）：secretId/secretKey=服务端 API + 上传签名（控制台子账号·仅授 VOD），
// playKey=播放 Key 防盗链签名，procedure=上传自动触发的任务流模板名（console-assets/04 正册对照）
const VOD_FIELDS = ['secretId', 'secretKey', 'playKey', 'procedure'] as const
const DOC_FIELDS: Record<string, readonly string[]> = { wxkf: WXKF_FIELDS, wxpay: WXPAY_FIELDS, vod: VOD_FIELDS }
const MAX_LEN: Record<string, number> = {
  corpId: 64,
  secret: 128,
  token: 64,
  aesKey: 64,
  agentId: 32,
  miniappAppId: 32,
  thumbMediaId: 128,
  mchPrivateKey: 4000,
  mchSerial: 80,
  secretId: 64,
  secretKey: 64,
  playKey: 64,
  procedure: 64,
}

/** 写「wxkf」/「wxpay」/「vod」三 doc 的敏感凭证字段（merge-save·同 saveSettings 范式：先读现有、非 undefined 才覆盖）。 */
export async function saveSecureConfig({ db, data }: Ctx) {
  const docId = String((data && data.docId) || '')
  if (docId !== 'wxkf' && docId !== 'wxpay' && docId !== 'vod') return reply(400, { ok: false, error: 'BAD_DOC' })
  const allow = DOC_FIELDS[docId]
  const fields = (data && typeof data.fields === 'object' && data.fields) || {}

  const patch: Record<string, string> = {}
  for (const f of allow) {
    if ((fields as Record<string, unknown>)[f] === undefined) continue
    let v = String((fields as Record<string, unknown>)[f] || '').trim()
    if (!v) continue // 留空不改动
    if (v.length > MAX_LEN[f]) return reply(400, { ok: false, error: 'TOO_LONG:' + f })
    // EncodingAESKey 平台定长 43（base64）：长度不对多半是抄漏/多抄——早拒早发现，别等回调解密才崩
    if (f === 'aesKey' && v.length !== 43) return reply(400, { ok: false, error: 'BAD_AESKEY_LEN' })
    if (f === 'mchPrivateKey') v = normalizePem(v) // 换行常被输入框/剪贴板塌行——存前先规整（同 wxbill 读时兜底）
    patch[f] = v
  }
  if (!Object.keys(patch).length) return reply(400, { ok: false, error: 'NO_FIELDS' })

  await ensure(db, COLLECTIONS.secureConfig)
  const coll = db.collection(COLLECTIONS.secureConfig)
  const got = await coll.doc(docId).get().catch(() => null)
  const { _id: _omitId, ...cur } = (got && got.data) || {}
  const next = { ...cur, ...patch, updatedAt: Date.now() }
  await coll
    .doc(docId)
    .set({ data: next })
    .catch(async () => {
      await coll.add({ data: { _id: docId, ...next } })
    })
  return reply(200, { ok: true })
}

const PAY_MAX_LEN: Record<string, number> = { subMchId: 32, flowId: 100, refundFlowId: 100 }

/** 写 `config/pay` 文档（mode/subMchId/flowId/refundFlowId·支付退款工作流接缝，console-assets §⑦）。 */
export async function savePayConfig({ db, data }: Ctx) {
  const patch: Record<string, unknown> = {}
  if (data && data.mode !== undefined) {
    const m = String(data.mode || '')
    if (m !== 'real' && m !== 'mock') return reply(400, { ok: false, error: 'BAD_MODE' })
    patch.mode = m
  }
  for (const f of ['subMchId', 'flowId', 'refundFlowId'] as const) {
    if (!data || data[f] === undefined) continue
    const v = String(data[f] || '').trim()
    if (!v) continue
    if (v.length > PAY_MAX_LEN[f]) return reply(400, { ok: false, error: 'TOO_LONG:' + f })
    patch[f] = v
  }
  if (!Object.keys(patch).length) return reply(400, { ok: false, error: 'NO_FIELDS' })

  await ensure(db, COLLECTIONS.config)
  const coll = db.collection(COLLECTIONS.config)
  const got = await coll.doc('pay').get().catch(() => null)
  const { _id: _omitId, ...cur } = (got && got.data) || {}
  const next = { ...cur, ...patch, updatedAt: Date.now() }
  await coll
    .doc('pay')
    .set({ data: next })
    .catch(async () => {
      await coll.add({ data: { _id: 'pay', ...next } })
    })
  return reply(200, { ok: true })
}
