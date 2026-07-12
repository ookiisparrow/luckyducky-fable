import { reply, type Ctx } from '../lib'
import { COLLECTIONS } from '@ldrw/shared'

// 人工配置清单（批 B9→2026-07-12 补口可填写化·docs/进销存ERP/ 与 docs/后台360工作站/ 之外的「配了没」总览）：
// 22 项散落配置（云函数环境变量→本页填写自动生效 / admin 页内 DB 字段 / 纯人工外部后台项 / 资产正册）拼一屏
// （审查批 +2：客服小程序卡片 miniappAppId/thumbMediaId 随迁入库，cs 函数环境变量配置项就此清零）。
// 探测「配了没」；**可填写的字段绝不回显既有值**（前端 fill.inputType 恒渲染空输入框，留空提交＝不改动，
// 见 adminApi/actions/secureConfig.ts）——零回显铁律延伸到写入口，本文件仍只做只读探测。
//
// 探测规则五种（预审后主脑裁决·2026-07-12·敏感凭证入库决策后修订）：
// ① secureConfig / config DB 文档字段存在性——决策 2026-07-12：WXKF_*/WXPAY_MCH_* 凭证与 config/pay 接缝
//    字段全部收口进库（kit/secureConfig.ts 单源读取），本页可直接填写（fill 字段非空的 item）；DB 无值时
//    云函数运行时会回退同名环境变量（迁移期兼容），但本页状态只看库（鼓励迁移，不谎报「未配」实为「仍在
//    旧环境变量层」的暧昧态——note 里说明）。
// ② adminApi 进程 env 布尔 `!!process.env.X`兜底：WXPAY_MCH_* 是 adminApi 自身环境变量（wxbill.ts 同进程读取，
//    可信探测），DB 未填但环境变量仍生效时不误报 missing。
// ③ DB 配置字段（非本页填写的既有 admin 页内配置）→ 只读查一条判存在（doc().get() 天然有界·单文档）。
// ④ 业务初始化态 → 有界只读查询（`.limit(1)`·只判「有没有」不取值）。
// ⑤ 纯人工外部后台项（企业微信/微信客服/小程序后台配置项，代码侧无法探测）→ 恒 'check'。
//
// 零回显纪律：本文件的 process.env / DB 字段读取只出现在 `!!`/布尔语境，从不把查到的字段值放进响应体
// （守卫用哨兵值断言：见测试文件）。RBAC：不登记 ACTION_CAPS → 默认拒 admin:write＝仅超管。

type Status = 'ok' | 'missing' | 'check'
type FillAction = 'saveSecureConfig' | 'savePayConfig'
interface FillMeta {
  action: FillAction
  docId?: 'wxkf' | 'wxpay' // 仅 saveSecureConfig 用；savePayConfig 固定写 config/pay，无需 docId
  field: string
  inputType: 'text' | 'password' | 'textarea' | 'select'
  options?: { value: string; label: string }[] // 仅 select（mode）用
}
interface ChecklistItem {
  key: string
  name: string
  location: string
  purpose: string
  status: Status
  howTo: string
  url: string
  noteExtra?: string
  fill?: FillMeta
}
interface ChecklistGroup {
  group: string
  items: ChecklistItem[]
}

const MIGRATE_NOTE = '若此前配置在云函数环境变量层（迁移前遗留）、功能仍照常运行，只是本页检测不到——建议在此重新填一遍，统一到库管理、云函数优先读库'

export async function getConfigChecklist({ db }: Ctx) {
  // ── 组① 微信客服凭证：secureConfig/wxkf 字段存在性（决策 2026-07-12 入库·本页可填写）──
  const wxkfDoc = await db.collection(COLLECTIONS.secureConfig).doc('wxkf').get().catch(() => null)
  const wxkf = (wxkfDoc && wxkfDoc.data) || {}
  const wxkfOk = (f: string) => !!(wxkf as Record<string, unknown>)[f]

  // ── 组② 微信支付对账凭证：secureConfig/wxpay 字段存在性 OR adminApi 自身环境变量（规则②·可信兜底）──
  const wxpayDoc = await db.collection(COLLECTIONS.secureConfig).doc('wxpay').get().catch(() => null)
  const wxpay = (wxpayDoc && wxpayDoc.data) || {}
  const privKeyOk = !!(wxpay as Record<string, unknown>).mchPrivateKey || !!process.env.WXPAY_MCH_PRIVATE_KEY
  const serialOk = !!(wxpay as Record<string, unknown>).mchSerial || !!process.env.WXPAY_MCH_SERIAL

  // ── 组③ 支付/退款接缝配置：config/pay 字段存在性 ──
  const payDoc = await db.collection(COLLECTIONS.config).doc('pay').get().catch(() => null)
  const pay = (payDoc && payDoc.data) || {}
  const payOk = (f: string) => !!(pay as Record<string, unknown>)[f]

  // ── 组④ admin 页内配置：DB 字段/初始化态（规则③④·全部有界·只判存在）──
  const settingsDoc = await db.collection(COLLECTIONS.adminConfig).doc('settings').get().catch(() => null)
  const webhookOk = !!(settingsDoc && settingsDoc.data && settingsDoc.data.alertWebhook)

  const bomDoc = await db.collection(COLLECTIONS.config).doc('scmBomTemplate').get().catch(() => null)
  const bomOk = !!(bomDoc && bomDoc.data)

  const _ = db.command
  const [ledgerRes, materialRes] = await Promise.all([
    db.collection(COLLECTIONS.stockLedger).where({ docType: 'adjust' }).limit(1).get().catch(() => ({ data: [] })),
    db.collection(COLLECTIONS.materials).where({ threshold: _.gt(0) }).limit(1).get().catch(() => ({ data: [] })),
  ])
  // 期初盘点（有 adjust 流水）+ 物料安全线（有 threshold>0 物料）合并一行两条件（选简单者·两者皆备才算 ok）
  const stockInitOk = (ledgerRes.data || []).length > 0 && (materialRes.data || []).length > 0

  const groups: ChecklistGroup[] = [
    {
      group: '微信客服凭证（本页填写 → 云函数读库自动生效，无需再改环境变量）',
      items: [
        {
          key: 'WXKF_AGENTID',
          name: '企微应用推送 AgentId',
          location: 'DB secureConfig/wxkf.agentId',
          purpose: '新会话/升级推送到坐席企微',
          status: wxkfOk('agentId') ? 'ok' : 'missing',
          howTo: '企微后台→应用管理→自建应用→AgentId，复制粘到右侧输入框保存',
          url: 'https://work.weixin.qq.com',
          noteExtra: MIGRATE_NOTE,
          fill: { action: 'saveSecureConfig', docId: 'wxkf', field: 'agentId', inputType: 'text' },
        },
        {
          key: 'WXKF_CORPID',
          name: '企微企业 ID',
          location: 'DB secureConfig/wxkf.corpId',
          purpose: '客服消息收发 + 主动推送用的企微 access_token（凭证之一）',
          status: wxkfOk('corpId') ? 'ok' : 'missing',
          howTo: '企微后台→我的企业→企业ID',
          url: 'https://work.weixin.qq.com',
          noteExtra: MIGRATE_NOTE,
          fill: { action: 'saveSecureConfig', docId: 'wxkf', field: 'corpId', inputType: 'text' },
        },
        {
          key: 'WXKF_SECRET',
          name: '企微自建应用 Secret',
          location: 'DB secureConfig/wxkf.secret',
          purpose: '客服消息收发 + 主动推送用的企微 access_token（凭证之一）',
          status: wxkfOk('secret') ? 'ok' : 'missing',
          howTo: '企微后台→应用管理→自建应用→Secret',
          url: 'https://work.weixin.qq.com',
          noteExtra: MIGRATE_NOTE,
          fill: { action: 'saveSecureConfig', docId: 'wxkf', field: 'secret', inputType: 'password' },
        },
        {
          key: 'WXKF_TOKEN',
          name: '微信客服回调 Token',
          location: 'DB secureConfig/wxkf.token',
          purpose: '客服消息回调验签防伪',
          status: wxkfOk('token') ? 'ok' : 'missing',
          howTo: '微信客服后台→开发配置',
          url: 'https://kf.weixin.qq.com',
          noteExtra: MIGRATE_NOTE,
          fill: { action: 'saveSecureConfig', docId: 'wxkf', field: 'token', inputType: 'password' },
        },
        {
          key: 'WXKF_AESKEY',
          name: '微信客服回调 EncodingAESKey',
          location: 'DB secureConfig/wxkf.aesKey',
          purpose: '客服消息回调解密（固定 43 位）',
          status: wxkfOk('aesKey') ? 'ok' : 'missing',
          howTo: '微信客服后台→开发配置（固定 43 字符，抄错长度保存会被拒）',
          url: 'https://kf.weixin.qq.com',
          noteExtra: MIGRATE_NOTE,
          fill: { action: 'saveSecureConfig', docId: 'wxkf', field: 'aesKey', inputType: 'password' },
        },
        {
          key: 'WXKF_MINIAPP_APPID',
          name: '客服卡片小程序 AppID（审查批随迁·原 cs 函数环境变量）',
          location: 'DB secureConfig/wxkf.miniappAppId',
          purpose: '客服会话里发的小程序卡片（查订单/进店）跳转目标小程序',
          status: wxkfOk('miniappAppId') ? 'ok' : 'missing',
          howTo: '填本店小程序 AppID（mp 后台→设置→账号信息，与发布用 AppID 一致）',
          url: 'https://mp.weixin.qq.com',
          noteExtra: MIGRATE_NOTE,
          fill: { action: 'saveSecureConfig', docId: 'wxkf', field: 'miniappAppId', inputType: 'text' },
        },
        {
          key: 'WXKF_THUMB_MEDIA_ID',
          name: '客服卡片封面素材 ID（审查批随迁·原 cs 函数环境变量）',
          location: 'DB secureConfig/wxkf.thumbMediaId',
          purpose: '小程序卡片封面图 thumb_media_id（缺任一项则卡片消息静默不发、只发文字）',
          status: wxkfOk('thumbMediaId') ? 'ok' : 'missing',
          howTo: '经企微素材上传接口上传封面图取得 media_id（流程见 docs/微信客服配置手册.md）',
          url: 'https://kf.weixin.qq.com',
          noteExtra: MIGRATE_NOTE,
          fill: { action: 'saveSecureConfig', docId: 'wxkf', field: 'thumbMediaId', inputType: 'text' },
        },
      ],
    },
    {
      group: '微信支付对账凭证（本页填写 → 云函数读库自动生效）',
      items: [
        {
          key: 'WXPAY_MCH_PRIVATE_KEY',
          name: '商户 API 私钥',
          location: 'DB secureConfig/wxpay.mchPrivateKey',
          purpose: '拉取微信交易账单（对账）用 APIv3 商户私钥签名',
          status: privKeyOk ? 'ok' : 'missing',
          howTo: '微信支付商户平台→账户中心→API 安全→申请 API 证书（下载的 apiclient_key.pem 全文粘贴）',
          url: 'https://pay.weixin.qq.com',
          fill: { action: 'saveSecureConfig', docId: 'wxpay', field: 'mchPrivateKey', inputType: 'textarea' },
        },
        {
          key: 'WXPAY_MCH_SERIAL',
          name: '商户证书序列号',
          location: 'DB secureConfig/wxpay.mchSerial',
          purpose: '与商户私钥配对，APIv3 签名头必填',
          status: serialOk ? 'ok' : 'missing',
          howTo: '微信支付商户平台→账户中心→API 安全→查看证书序列号',
          url: 'https://pay.weixin.qq.com',
          fill: { action: 'saveSecureConfig', docId: 'wxpay', field: 'mchSerial', inputType: 'text' },
        },
      ],
    },
    {
      group: '支付/退款接缝配置（本页填写 → 云函数读库自动生效）',
      items: [
        {
          key: 'pay.mode',
          name: '支付模式',
          location: 'DB config/pay.mode',
          purpose: 'real=真实支付工作流；mock=仅测试环境（生产必须 real）',
          status: payOk('mode') ? 'ok' : 'missing',
          howTo: '确认支付工作流已在云开发控制台配好后选择 real',
          url: '',
          fill: {
            action: 'savePayConfig',
            field: 'mode',
            inputType: 'select',
            options: [
              { value: 'real', label: 'real（生产真实支付）' },
              { value: 'mock', label: 'mock（仅测试）' },
            ],
          },
        },
        {
          key: 'pay.subMchId',
          name: '商户号',
          location: 'DB config/pay.subMchId',
          purpose: '账单查询 mchid（对照 console-assets/ 正册商户号）',
          status: payOk('subMchId') ? 'ok' : 'missing',
          howTo: '微信支付商户平台→账户中心→商户号',
          url: 'https://pay.weixin.qq.com',
          fill: { action: 'savePayConfig', field: 'subMchId', inputType: 'text' },
        },
        {
          key: 'pay.flowId',
          name: '支付工作流 ID',
          location: 'DB config/pay.flowId',
          purpose: '发起支付经 callFlow 触发的云开发工作流标识',
          status: payOk('flowId') ? 'ok' : 'missing',
          howTo: '云开发控制台→工作流→复制支付工作流 ID（console-assets/01-支付退款工作流.md 正册对照）',
          url: 'https://tcb.cloud.tencent.com',
          fill: { action: 'savePayConfig', field: 'flowId', inputType: 'text' },
        },
        {
          key: 'pay.refundFlowId',
          name: '退款工作流 ID',
          location: 'DB config/pay.refundFlowId',
          purpose: '发起退款经 callFlow 触发的云开发工作流标识',
          status: payOk('refundFlowId') ? 'ok' : 'missing',
          howTo: '云开发控制台→工作流→复制退款工作流 ID（console-assets/01-支付退款工作流.md 正册对照）',
          url: 'https://tcb.cloud.tencent.com',
          fill: { action: 'savePayConfig', field: 'refundFlowId', inputType: 'text' },
        },
      ],
    },
    {
      group: 'admin 页内配置（/admin 直达）',
      items: [
        {
          key: 'alertWebhook',
          name: '告警 webhook',
          location: 'DB adminConfig/settings.alertWebhook',
          purpose: '[LD_ALERT] 动作类失败推群机器人',
          status: webhookOk ? 'ok' : 'missing',
          howTo: '企微群→群机器人→复制 Webhook → /admin 系统·设置 填入',
          url: '',
        },
        {
          key: 'scmBomTemplate',
          name: 'BOM 模板数值/单价',
          location: 'DB config/scmBomTemplate',
          purpose: '配方组装线数值/单价基准',
          status: bomOk ? 'ok' : 'missing',
          howTo: '/admin→进销存→BOM 配方',
          url: '',
        },
        {
          key: 'stockInit',
          name: '期初盘点 + 物料安全线',
          location: 'DB stockLedger(docType=adjust) / materials.threshold',
          purpose: '库存起点与低库存预警阈值',
          status: stockInitOk ? 'ok' : 'missing',
          howTo: '/admin→进销存→物料台账（批量盘点模式）',
          url: '',
        },
      ],
    },
    {
      group: '企业微信/微信客服/小程序后台（纯人工）',
      items: [
        {
          key: 'wecomSso',
          name: '企微免登（坐席台）',
          location: '企业微信后台',
          purpose: '坐席台单点登录',
          status: 'check',
          howTo: '应用主页/OAuth 可信域名（迁移批落地后再配）',
          url: 'https://work.weixin.qq.com',
          noteExtra: '重写线坐席台现走外包令牌登录；企微 OAuth 免登为旧线 M⑦ 能力、未迁移至 rewrite/agent（批 B9 预审发现·已记债）',
        },
        {
          key: 'contactMe',
          name: '「联系我」插件（M③ 用·按需）',
          location: '企业微信后台',
          purpose: '客户主动发起联系入口',
          status: 'check',
          howTo: '客户联系→加客户→联系我',
          url: 'https://work.weixin.qq.com',
        },
        {
          key: 'kfStaffBind',
          name: '接待人员绑定',
          location: '微信客服后台',
          purpose: '客服账号与接待坐席映射',
          status: 'check',
          howTo: '微信客服→客服账号→接待人员',
          url: 'https://kf.weixin.qq.com',
        },
        {
          key: 'bizCategory',
          name: '经营类目资质（P0 尾项）',
          location: '企业微信后台',
          purpose: '客户联系合规前置',
          status: 'check',
          howTo: '客户联系→经营类目',
          url: 'https://work.weixin.qq.com',
        },
        {
          key: 'mpKfRelease',
          name: 'mp 客服接待 + 版本发布',
          location: '微信小程序后台',
          purpose: '小程序客服入口与版本上线',
          status: 'check',
          howTo: '功能→客服 / 版本管理',
          url: 'https://mp.weixin.qq.com',
        },
      ],
    },
    {
      group: '资产正册',
      items: [
        {
          key: 'consoleAssets',
          name: 'console-assets/ 8 件控制台资产核对',
          location: '云开发控制台',
          purpose: '支付连接器/工作流开通状态等控制台原生资产与正册核对一致',
          status: 'check',
          howTo: '对照仓内 console-assets/ 正册核对云开发控制台·变更先 repo 后控制台',
          url: 'https://tcb.cloud.tencent.com',
          noteExtra: 'config/pay 里的 mode/subMchId/flowId/refundFlowId 已拆到「支付/退款接缝配置」单独可填，本行只核对其余控制台原生资产（连接器/工作流本身是否已开通）',
        },
      ],
    },
  ]

  return reply(200, { ok: true, groups })
}
