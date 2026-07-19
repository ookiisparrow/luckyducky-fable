import { describe, it, expect } from 'vitest'
import { parseTcbSecretsJson, CredentialError } from '../../scripts/lib/cloud-manager.mjs'

// 只测纯函数 parseTcbSecretsJson（不实际调用 tcb/网络——getManager() 本体的 I/O 部分留给
// 人工冒烟，需要真实登录态）。安全红线（见 scripts/lib/cloud-manager.mjs 头注）：错误信息
// 必须给清晰指引、绝不回显传入的畸形 stdout 原文（可能含真实密钥）。
describe('cloud-manager parseTcbSecretsJson：tcb secrets get --json 输出解析', () => {
  it('合法 fixture JSON（虚构值，非真实凭证）解析成功', () => {
    const fixture = JSON.stringify({
      data: {
        secretId: 'FIXTURE_NOT_REAL_SECRET_ID',
        secretKey: 'FIXTURE_NOT_REAL_SECRET_KEY',
        token: 'FIXTURE_NOT_REAL_TOKEN',
        expiredAt: 9999999999,
        isTemporary: true,
        envId: 'fixture-env',
      },
    })
    expect(parseTcbSecretsJson(fixture)).toEqual({
      secretId: 'FIXTURE_NOT_REAL_SECRET_ID',
      secretKey: 'FIXTURE_NOT_REAL_SECRET_KEY',
      token: 'FIXTURE_NOT_REAL_TOKEN',
    })
  })

  it('畸形 JSON → 抛 CredentialError，指引文案含 tcb login 与 TENCENTCLOUD_SECRETID', () => {
    expect(() => parseTcbSecretsJson('not json{{{')).toThrow(CredentialError)
    try {
      parseTcbSecretsJson('not json{{{')
    } catch (e) {
      expect(e.message).toContain('tcb login')
      expect(e.message).toContain('TENCENTCLOUD_SECRETID')
    }
  })

  it('缺 secretKey 字段的合法 JSON → 抛 CredentialError', () => {
    expect(() => parseTcbSecretsJson(JSON.stringify({ data: { secretId: 'x' } }))).toThrow(CredentialError)
  })

  it('CredentialError message 不回显传入的畸形 stdout 原文（防泄漏面）', () => {
    const sentinel = 'SENTINEL_SHOULD_NOT_LEAK_INTO_MESSAGE'
    try {
      parseTcbSecretsJson(sentinel)
    } catch (e) {
      expect(e.message).not.toContain(sentinel)
    }
  })
})
