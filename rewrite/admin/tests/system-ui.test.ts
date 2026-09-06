// 系统组+钱组补齐映射（守卫 rw-admin-system-ui-golden）：批次激活率不除零/webhook 预检同云端正则/
// 对账 approx 诚实透传/wxOnly 标红/库存不限量不显 0/409 冲突人话。
import { describe, it, expect } from 'vitest'
import { mapAgents, mapBatches, webhookOk, mapRecon, mapBillMatch, mapStock, stockErrorText, mapAuditEntries, launchErrorText, UNKNOWN_COURSE_HINT } from '../src/lib/mapSystem'
import settingsSrc from '../src/pages/Settings.vue?raw'
import batchesSrc from '../src/pages/Batches.vue?raw'
import wizardSrc from '../src/pages/Wizard.vue?raw'
import reconciliationSrc from '../src/pages/Reconciliation.vue?raw'

// 密钥不明文常驻（UX 体检批4）：webhook key 曾在输入框明文回显（后端 getSettings 原样回值），任何截屏/
// 投屏即带出——隔壁「人工配置清单」页自标「零回显」，两页安全姿态曾自相矛盾。前端改密码态+显隐切换
// （只动 input type，v-model/save 语义零改动——「留空=清除」是设计内行为，system-ui 上方 webhookOk
// 用例锁着）。后端零回显属 API 改动另批拍板。「12 项」死数与清单页动态 27 项打架——删数字防再漂。
describe('Settings.vue 密钥显示形态 + 死数字清除', () => {
  it('大白话：webhook 输入默认密码态（可切换显示）+ autocomplete 关自动填充；清单入口不再手抄项数', () => {
    expect(settingsSrc).toMatch(/:type="showWebhook \? 'text' : 'password'"/)
    expect(settingsSrc).toMatch(/autocomplete="new-password"/)
    expect(settingsSrc).not.toContain('12 项散落配置')
  })
})

describe('外包账号与批次', () => {
  it('大白话：账号行归一（无 id 剔除）；批次激活率算百分比、空批显 — 不除零', () => {
    expect(mapAgents([{ id: 'agent-1', name: '外包一号', disabled: false }, { noid: 1 }, null])).toHaveLength(1)
    const rows = mapBatches([
      { batchId: 'b1', total: 30, activated: 6, createdAt: 1783046400000 },
      { batchId: 'b-empty', total: 0, activated: 0 },
    ])
    expect(rows[0].rateLabel).toBe('20%')
    expect(rows[1].rateLabel).toBe('—') // 不除零
  })

  it('大白话（批 B6）：坐席状态归一为中文徽章语气（在线绿/忙碌琥珀/离线灰）；未知/缺失状态兜底离线；活跃数/今日结束数透传', () => {
    const rows = mapAgents([
      { id: 'a1', status: 'online', activeCount: 2, todayClosed: 3 },
      { id: 'a2', status: 'busy', activeCount: 1, todayClosed: 0 },
      { id: 'a3', status: 'offline' },
      { id: 'a4' }, // 无 status 字段（agentState 无档）·兜底离线
      { id: 'a5', status: '未知态' }, // 非法值兜底离线（防未知枚举渲崩）
    ])
    expect(rows.map((r) => [r.status, r.statusLabel, r.statusTone])).toEqual([
      ['online', '在线', 'green'],
      ['busy', '忙碌', 'amber'],
      ['offline', '离线', 'neutral'],
      ['offline', '离线', 'neutral'],
      ['offline', '离线', 'neutral'],
    ])
    expect(rows[0].activeCount).toBe(2)
    expect(rows[0].todayClosed).toBe(3)
    expect(rows[3].activeCount).toBe(0) // 缺字段不崩、回 0
  })

  it('大白话：webhook 只认企微群机器人地址；空=清除合法；野地址拒', () => {
    expect(webhookOk('')).toBe(true)
    expect(webhookOk('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc-123')).toBe(true)
    expect(webhookOk('https://evil.com/hook')).toBe(false)
    expect(webhookOk('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x')).toBe(false) // http 不行
  })
})

describe('Batches.vue 按批看码 + 页内翻页（不一次铺开）', () => {
  it('大白话：打开一批只看一页码，有上一页/下一页，不 slice(0,100) 一次铺开；导出另取齐整批；还能生成新批次', () => {
    expect(batchesSrc).toMatch(/async function nextCodes/)
    expect(batchesSrc).toMatch(/async function prevCodes/)
    expect(batchesSrc).toMatch(/listBatchCodes\([^)]*cursor/)
    expect(batchesSrc).not.toMatch(/codes\.slice\(0,\s*100\)/)
    expect(batchesSrc).toMatch(/async function collectAllCodes/)
    expect(batchesSrc).toContain('上一页')
    expect(batchesSrc).toContain('下一页')
    expect(batchesSrc).toMatch(/async function doCreate/)
    expect(batchesSrc).toContain('生成新批次')
  })

  it('大白话：码表翻页用 peek 绑当前批次代际，回包过期即丢，不把 A 批的下一页写进 B 批抽屉', () => {
    expect(batchesSrc).toMatch(/const g = codesGen\.peek\(\)/)
    expect(batchesSrc).toMatch(/if \(codesGen\.isStale\(g\) \|\| detail\.value\?\.batchId !== forBatch\) return/)
  })
})

describe('上新/批次/课程错误码人话（操作者可见·不裸甩英文码）', () => {
  it('大白话：UNKNOWN_COURSE 说清没发布课程、下一步去第 4 步点发布；课程号只挂括号里', () => {
    const t = launchErrorText('UNKNOWN_COURSE:course-pmtpe2ca2')
    expect(t).toBe(UNKNOWN_COURSE_HINT + '（编号 course-pmtpe2ca2）')
    expect(t.startsWith('UNKNOWN_COURSE')).toBe(false)
    expect(t).toContain('发布课程')
    expect(t).toContain('第 4 步')
    expect(launchErrorText('Error: UNKNOWN_COURSE:course-x')).toContain('发布课程')
    expect(launchErrorText('NO_COURSE_ID')).toContain('课程编号')
    expect(launchErrorText('NO_DRAFT')).toContain('草稿')
    expect(launchErrorText('BAD_ARGS')).toContain('正整数')
    expect(launchErrorText('NO_BATCH')).toContain('批次')
    expect(launchErrorText('BAD_COURSE')).toContain('章节')
    expect(launchErrorText('VOD_PROCESSING')).toContain('转码')
    expect(launchErrorText('DRAFT_CONFLICT')).toContain('载入')
    expect(launchErrorText('SESSION_LOST')).toContain('登录')
    expect(launchErrorText('GEN_FAIL')).toContain('二维码')
  })

  it('大白话：没映射的码也不裸甩 Error:CODE；已是中文原样；空串给兜底人话', () => {
    const t = launchErrorText('Error: WEIRD_XYZ:abc')
    expect(t).toMatch(/[\u4e00-\u9fff]/)
    expect(t.startsWith('Error:')).toBe(false)
    expect(t.startsWith('WEIRD_XYZ')).toBe(false)
    expect(t).toContain('WEIRD_XYZ') // 编号次要信息
    expect(launchErrorText('网络波动，请重试')).toBe('网络波动，请重试')
    expect(launchErrorText('')).toContain('没成功')
  })

  it('大白话：批次生成/加载失败走 launchErrorText；未发布课时嵌入向导拦截生成', () => {
    expect(batchesSrc).toMatch(/launchErrorText\(/)
    expect(batchesSrc).not.toMatch(/生成失败：' \+ String\(r\.error/)
    expect(batchesSrc).not.toMatch(/加载失败：' \+ String\(r\.error/)
    expect(batchesSrc).toMatch(/courseReady/)
    expect(batchesSrc).toMatch(/UNKNOWN_COURSE_HINT|launchErrorText\('UNKNOWN_COURSE/)
  })

  it('大白话：向导加载/建档走 launchErrorText，同步到小程序走既有 publishErrorText', () => {
    expect(wizardSrc).toMatch(/launchErrorText\(/)
    expect(wizardSrc).toMatch(/publishErrorText\(/)
    expect(wizardSrc).not.toMatch(/同步到小程序没成功：' \+ String\(r\.error/)
    expect(wizardSrc).toMatch(/:course-ready|:courseReady/)
  })
})

describe('对账映射（approx 诚实·wxOnly 最危险）', () => {
  it('大白话：累计三卡金额两位小数；窗内触顶标近似；「微信有我方无」大于 0 必标红', () => {
    const recon = mapRecon({
      ok: true,
      cumulative: { income: 150, refund: 30, net: 120 },
      summary: { income: 100, refund: 0, net: 100, orders: 1, refunds: 0 },
      range: { from: '2026-07-01', to: '2026-07-01' },
      daily: [{ day: '2026-07-01', income: 100, refund: 0, net: 100, orders: 1, refunds: 0 }],
      approx: true,
      partial: true,
      exceptions: { feeMismatch: ['o-bad'], refundMismatch: [], stuckRefunds: ['a-stuck'] },
    })!
    expect(recon.cumulative[2]).toEqual({ label: '净额', value: '¥120.00' })
    // 窗内合计（所选区间真值·换皮误用全时累计致口径错乱：窗内订单数与全时钱额混在一排·tfoot 穿帮）
    expect(recon.summary).toEqual({ income: '¥100.00', refund: '¥0.00', net: '¥100.00', orders: 1, refunds: 0 })
    expect(recon.range).toEqual({ from: '2026-07-01', to: '2026-07-01' })
    expect(recon.approxNote).toContain('近似')
    expect(recon.partial).toBe(true)
    // B2 修：exceptions 是 {feeMismatch,refundMismatch,stuckRefunds} 对象·结构化成带单号明细（有则渲染·空类不显）
    expect(recon.exceptions).toEqual([
      { label: '金额不符单（先核对流水；支付异常走退款处理）', ids: ['o-bad'] },
      { label: '审批后卡单（死信·退款未走通）', ids: ['a-stuck'] },
    ])
    const clean = mapRecon({ ok: true, cumulative: { income: 0, refund: 0, net: 0 }, daily: [], approx: false })!
    expect(clean.approxNote).toBe('')
    expect(clean.partial).toBe(false)
    expect(clean.exceptions).toEqual([]) // 无异常空数组·不吓人
    expect(clean.summary).toEqual({ income: '¥0.00', refund: '¥0.00', net: '¥0.00', orders: 0, refunds: 0 }) // 缺 summary 安全归零
    expect(clean.range).toEqual({ from: '', to: '' })
    const m = mapBillMatch({ ok: true, summary: { matched: 5, wxOnly: 1, oursOnly: 2, amountMismatch: 0 }, discrepancies: { wxOnly: [{ transactionId: 'tx-ghost', amount: 5, date: '2026-07-01' }], oursOnly: [], amountMismatch: [] } })!
    expect(m.summary[1]).toMatchObject({ danger: true }) // wxOnly>0 标红
    expect(m.summary[0].danger).toBeFalsy() // 已平不标红
    expect(m.summary[2].danger).toBeFalsy() // 我方有微信无多为账单未拉·不与「收钱无单」同色标红
    expect(m.wxOnly[0].amount).toBe('¥5.00')
    expect(mapBillMatch({ ok: false })).toBeNull()
  })

  it('大白话：对账页用人话报错、CSV 带可见 BOM、降级不装成账平、没账单不装成已勾对', () => {
    expect(reconciliationSrc).toMatch(/orderErrorText\(/)
    expect(reconciliationSrc).not.toMatch(/String\([^;]*error/)
    expect(reconciliationSrc).toContain('\\uFEFF')
    expect(reconciliationSrc).toContain('recon!.partial')
    expect(reconciliationSrc).toContain('TriangleAlert')
    expect(reconciliationSrc).toContain('暂无勾对数据——请先拉取账单')
    expect(reconciliationSrc).toContain('当前区间暂无订单/退款记录')
    expect(reconciliationSrc).toContain('class="ld-table table-scroll"')
  })
})

describe('库存映射与保存错误人话', () => {
  it('大白话：null=不限量（绝不显成 0）；触顶如实标非全量；409 冲突说「刚被改过·拒绝覆盖」', () => {
    const { rows, truncNote } = mapStock(
      [
        { _id: 'p1__', productId: 'p1', spec: '', stock: 5, threshold: 8, updatedAt: 1000 },
        { _id: 'p2__', productId: 'p2', spec: '', stock: null, updatedAt: 1000 },
        { noid: 1 },
      ],
      true
    )
    expect(rows).toHaveLength(2)
    expect(rows[0].stockLabel).toBe('5')
    expect(rows[0].threshold).toBe(8) // per-SKU 阈值读回（换皮丢·硬编码 10·后端 saveStock 早支持 threshold）
    expect(rows[1].threshold).toBe(0) // 缺=0（无 per-SKU 阈值·前端退默认）
    expect(rows[1].stockLabel).toBe('不限量') // null 不显 0
    expect(truncNote).toContain('非全量')
    expect(mapStock([], false).truncNote).toBe('')
    expect(stockErrorText('STOCK_CONFLICT')).toContain('拒绝覆盖')
    expect(stockErrorText('', 409)).toContain('拒绝覆盖')
    expect(stockErrorText('BAD_STOCK')).toContain('非负整数')
    expect(stockErrorText('X_UNKNOWN')).toContain('X_UNKNOWN') // 原文兜底
  })
})

describe('审计日志映射（批 B6·纯函数）', () => {
  it('大白话：状态徽章归一中文（成功绿/失败红）；summary 对象拼成 k: v · k: v 展示串；operator/ip/摘要缺省显 —', () => {
    const rows = mapAuditEntries([
      { id: 'a1', ts: 1783046400000, operator: 'boss', action: 'saveDraft', ok: true, ip: '1.1.1.1', summary: { id: 'p1', qty: 2 } },
      { id: 'a2', ts: 1783046400000, action: 'shipOrder', ok: false, error: 'BAD_ARGS', summary: {} },
    ])
    expect(rows[0].statusLabel).toBe('成功')
    expect(rows[0].statusTone).toBe('green')
    expect(rows[0].summaryText).toBe('id: p1 · qty: 2')
    expect(rows[1].statusLabel).toBe('失败')
    expect(rows[1].statusTone).toBe('red')
    expect(rows[1].operator).toBe('—') // 缺省
    expect(rows[1].ip).toBe('—')
    expect(rows[1].summaryText).toBe('—') // 空 summary
    expect(rows[1].error).toBe('BAD_ARGS')
  })

  it('大白话：null 元素混入不崩、被过滤剔除；非数组输入回空数组', () => {
    expect(mapAuditEntries(null)).toEqual([])
    expect(mapAuditEntries('not-array')).toEqual([])
    const rows = mapAuditEntries([null, { id: 'x1', ts: 1, ok: true, operator: 'a', summary: {} }, null])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('x1')
  })
})
