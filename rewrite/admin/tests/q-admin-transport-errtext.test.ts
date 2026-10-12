// 传输层/鉴权层错误码（client.ts 与网关产出，任何 action 都可能回）在每张错误映射里都说同一句人话：
// 不落成「没成功（CODE）」——超时可能已生效，说成没成功会诱人重试（采购单无单号时每次重试都新建一张）。
import { describe, it, expect } from 'vitest'
import { orderErrorText } from '../src/lib/mapMoney'
import { launchErrorText, stockErrorText } from '../src/lib/mapSystem'
import { scmErrorText } from '../src/lib/mapScm'
import { publishErrorText } from '../src/lib/mapProducts'
import { loadErrors, failText, writeFailText } from '../src/lib/status'

const MAPPERS: Record<string, (c: string) => string> = {
  order: orderErrorText,
  launch: launchErrorText,
  stock: (c) => stockErrorText(c),
  scm: scmErrorText,
  publish: (c) => publishErrorText(c),
  load: (c) => loadErrors([[{ ok: false, error: c }, '采购单']]).replace(/^采购单加载失败：/, ''),
}

describe('传输层错误码公共兜底', () => {
  it.each(['CALL_TIMEOUT', 'AUTH_UNAVAILABLE', 'BAD_JSON_RESPONSE', 'NO_ENDPOINT', 'NETWORK:Failed to fetch'])('大白话：%s 在各映射里是同一句人话，不带码、不说没成功', (code) => {
    const texts = Object.values(MAPPERS).map((f) => f(code))
    for (const t of texts) expect(t).not.toMatch(/没成功|操作失败|[A-Z]{4,}/)
    expect(new Set(texts).size).toBe(1)
  })

  it('大白话：业务码仍走各自的表，不被公共兜底抢走', () => {
    expect(scmErrorText('INSUFFICIENT')).toContain('库存不够扣')
    expect(publishErrorText('NEED_COVER')).toContain('封面')
    expect(orderErrorText('FUTURE_UNKNOWN_CODE')).toBe('操作失败（FUTURE_UNKNOWN_CODE）')
  })
})

// adminApi/index.ts 网关在进 action 前后回的码：任何页都可能收到，不能掉进上新向导的「检查前面步骤」兜底
describe('网关通用码', () => {
  it.each([
    ['FORBIDDEN', /权限/],
    ['TOO_MANY_ATTEMPTS', /试错太多.*过几分钟/],
    ['SERVER_ERROR', /如果刚才是提交.*刷新/],
    ['UNKNOWN_ACTION', /云端.*更新/],
  ])('大白话：%s 在各映射里同一句贴切人话，不带码、不扯前面步骤；读写提示也用它', (code, meaning) => {
    const texts = Object.values(MAPPERS).map((f) => f(code))
    expect(new Set(texts).size).toBe(1)
    expect(texts[0]).toMatch(meaning)
    expect(texts[0]).not.toMatch(/前面步骤|没成功|操作失败|[A-Z]{4,}/)
    expect(failText('加载失败', code)).toBe('加载失败：' + texts[0])
    expect(writeFailText('保存失败', code)).toBe(texts[0])
  })

  // 各 action 读库失败统一回 DOC_READ_FAIL：没自带码表的页（帮助视频、配置清单等）也不能甩「加载失败（DOC_READ_FAIL）」；
  // 写操作（退款、发货、存配置）读库失败时什么都没做，要冠「X没成功：」，不能像超时那样只给一句
  it('大白话：DOC_READ_FAIL 读写都说中文，写失败仍冠「X没成功：」', () => {
    const T = '云端数据暂时读不出来。请稍后重试。'
    expect(failText('加载失败', 'DOC_READ_FAIL')).toBe('加载失败：' + T)
    expect(writeFailText('保存失败', 'DOC_READ_FAIL')).toBe('保存失败：' + T)
    expect(writeFailText('退款没成功', 'DOC_READ_FAIL', orderErrorText)).toBe('退款没成功：' + T)
    expect(writeFailText('发货没成功', 'DOC_READ_FAIL', orderErrorText)).toBe('发货没成功：' + T)
    expect(writeFailText('清除失败', 'DOC_READ_FAIL', launchErrorText)).toBe('清除失败：' + T)
    expect(loadErrors([[{ ok: false, error: 'DOC_READ_FAIL' }, '采购单']])).toBe('采购单加载失败：' + T)
  })

  it('大白话：查不到的码兜底不扯「前面步骤」、编号挂括号；步骤指引只在向导步骤自己的码上', () => {
    const t = launchErrorText('SEC_CHECK_FAIL')
    expect(t).not.toMatch(/前面步骤/)
    expect(t).toMatch(/（技术编号 SEC_CHECK_FAIL）$/)
    expect(launchErrorText('NO_COURSE_ID')).toMatch(/前面步骤/)
  })
})
