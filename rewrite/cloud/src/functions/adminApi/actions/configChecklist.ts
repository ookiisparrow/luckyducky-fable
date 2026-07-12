import { reply, type Ctx } from '../lib'
import { probeStockSetup } from '../../../kit'
import { COLLECTIONS } from '@ldrw/shared'

// 人工配置清单（批 B9·蓝图设计契约·docs/进销存ERP/ 与 docs/后台360工作站/ 之外的「配了没」总览）：
// 12 项散落配置（云函数环境变量 / admin 页内 DB 字段 / 纯人工外部后台项 / 资产正册）拼一屏，
// 只探测「配了没」，**绝不回显任何密钥/配置值**（铁律·守卫 rewrite/cloud/tests/config-checklist.test.ts）。
//
// 探测规则五种（预审后主脑裁决·2026-07-12）：
// ① adminApi 进程 env 布尔 `!!process.env.X`——仅当该变量确实被 adminApi 进程内代码路径读取
//    （现场核对：WXKF_AGENTID 由 kit/wecom.ts::sendAgentCard 直读，adminApi/actions/agentDesk.ts 会调用它，
//    故 adminApi 进程内可信探测）。
// ② 仅 cs 函数链路引用的 env（本 adminApi 进程读不到该函数的真实配置态，即便同名 process.env 在此进程
//    存在值也不可信——两个云函数各自独立配置环境变量）→ 恒 'check' + 固定 note。
// ③ DB 配置字段 → 只读查一条判存在（doc().get() 天然有界·单文档）。
// ④ 业务初始化态 → 有界只读查询（`.limit(1)`·只判「有没有」不取值）。
// ⑤ 纯人工外部后台项（企业微信/微信客服/小程序后台配置项，代码侧无法探测）→ 恒 'check'。
//
// 零回显纪律：本文件的 process.env 引用只出现在 `!!` 布尔语境；DB 查询只取「存在与否」的布尔判定，
// 从不把查到的字段值放进响应体（守卫用哨兵值断言：见测试文件）。RBAC：不登记 ACTION_CAPS → 默认拒
// admin:write＝仅超管（人工配置清单本身不算越权面，但沿用「未登记默认高权」纪律，不特事特办）。

// cs 函数（kfCallback/kfSend/kfMedia·现场核对 2026-07-12）各自独立环境变量配置，adminApi 进程读不到
// 它们的真实配置态——即便同名变量在 adminApi 进程也能读到值，也不代表 cs 函数那边配了。
const CS_ENV_NOTE = '配置于 cs 函数（kfCallback/kfSend/kfMedia）环境·此处无法探测'

type Status = 'ok' | 'missing' | 'check'
interface ChecklistItem {
  key: string
  name: string
  location: string
  purpose: string
  status: Status
  howTo: string
  url: string
  noteExtra?: string
}
interface ChecklistGroup {
  group: string
  items: ChecklistItem[]
}

export async function getConfigChecklist({ db }: Ctx) {
  // ── 组① 云函数环境变量：仅 WXKF_AGENTID 在 adminApi 进程内可信探测（规则①）──
  const agentIdOk = !!process.env.WXKF_AGENTID

  // ── 组② admin 页内配置：DB 字段/初始化态（规则③④·全部有界·只判存在）──
  const settingsDoc = await db.collection(COLLECTIONS.adminConfig).doc('settings').get().catch(() => null)
  const webhookOk = !!(settingsDoc && settingsDoc.data && settingsDoc.data.alertWebhook)

  const bomDoc = await db.collection(COLLECTIONS.config).doc('scmBomTemplate').get().catch(() => null)
  const bomOk = !!(bomDoc && bomDoc.data)

  // 期初盘点（有 adjust 流水）+ 物料安全线（有 threshold>0 物料）合并一行两条件（选简单者·两者皆备才算 ok）
  // ——经门1 kit probeStockSetup 探针（rw-material-stock-single-seam：materials/stockLedger 只许 kit/scmStock 碰）
  const probe = await probeStockSetup()
  const stockInitOk = probe.adjustUsed && probe.thresholdSet

  const groups: ChecklistGroup[] = [
    {
      group: '云函数环境变量（云开发控制台→云函数→配置→环境变量）',
      items: [
        {
          key: 'WXKF_AGENTID',
          name: '企微应用推送 AgentId',
          location: 'adminApi + cs 函数环境变量',
          purpose: '新会话/升级推送到坐席企微',
          status: agentIdOk ? 'ok' : 'missing',
          howTo: '企微后台→应用管理→自建应用→AgentId',
          url: 'https://work.weixin.qq.com',
        },
        {
          key: 'WXKF_CORPID / WXKF_SECRET',
          name: '企微 API 凭证',
          location: 'cs 函数环境变量（kfCallback/kfSend/kfMedia 共用）',
          purpose: '客服消息收发 + 主动推送用的企微 access_token',
          status: 'check',
          howTo: '企微后台→我的企业→企业ID / 应用详情→Secret',
          url: 'https://work.weixin.qq.com',
          noteExtra: CS_ENV_NOTE,
        },
        {
          key: 'WXKF_TOKEN / WXKF_AESKEY',
          name: '微信客服回调验签解密',
          location: 'cs 函数环境变量（仅 kfCallback）',
          purpose: '客服消息回调防伪与解密',
          status: 'check',
          howTo: '微信客服后台→开发配置',
          url: 'https://kf.weixin.qq.com',
          noteExtra: CS_ENV_NOTE,
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
          purpose: '支付连接器等 8 件正册与控制台核对一致',
          status: 'check',
          howTo: '对照仓内 console-assets/ 正册核对云开发控制台·变更先 repo 后控制台',
          url: 'https://tcb.cloud.tencent.com',
        },
      ],
    },
  ]

  return reply(200, { ok: true, groups })
}
