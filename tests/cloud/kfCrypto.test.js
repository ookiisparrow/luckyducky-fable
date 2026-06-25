import { describe, it, expect, vi } from 'vitest'
import crypto from 'node:crypto'
import { kfSignature, verifyKfSignature, decryptKfMessage, defineKfCallback } from '../../packages/cloud/src/kit/wecom'

// 微信客服回调验签 + AES 解密 + fail-closed（根因#3 全场最关键：验签不过不给处理通道）。
// 反向自检：篡改签名 → onEvent 绝不被调 + 告警；正确签名 → 正常解出 syncToken/openKfId。

const TOKEN = 'verify-token-xyz'
const AESKEY = crypto.randomBytes(32).toString('base64').slice(0, 43) // EncodingAESKey 43 字符
const CORPID = 'wwcorpid123'

// 测试侧实现 WeCom 加密格式（random16 | len(4 BE) | msg | receiveId，PKCS7），证 decrypt 是真逆运算
function encryptKf(encodingAESKey, msg, receiveId) {
  const key = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = key.subarray(0, 16)
  const msgBuf = Buffer.from(msg)
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(msgBuf.length, 0)
  const raw = Buffer.concat([crypto.randomBytes(16), lenBuf, msgBuf, Buffer.from(receiveId)])
  const pad = 32 - (raw.length % 32)
  const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)]) // PKCS7
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
}

describe('WXBizMsgCrypt 验签 + 解密', () => {
  it('decrypt 是 encrypt 的逆：取回原文 + receiveId', () => {
    const enc = encryptKf(AESKEY, 'hello-客服', CORPID)
    const { message, receiveId } = decryptKfMessage(AESKEY, enc)
    expect(message).toBe('hello-客服')
    expect(receiveId).toBe(CORPID)
  })

  it('verifyKfSignature：自算签名通过，篡改任一参数即拒', () => {
    const enc = 'ENCRYPTED'
    const sig = kfSignature(TOKEN, '1700000000', 'nonce1', enc)
    expect(verifyKfSignature(TOKEN, '1700000000', 'nonce1', enc, sig)).toBe(true)
    expect(verifyKfSignature(TOKEN, '1700000000', 'nonce1', enc, sig + 'x')).toBe(false)
    expect(verifyKfSignature(TOKEN, '1700000000', 'nonceX', enc, sig)).toBe(false)
    expect(verifyKfSignature('wrong-token', '1700000000', 'nonce1', enc, sig)).toBe(false)
  })
})

// 构造「合法加密但 raw 结构非法」的密文（绕过 encryptKf 的正确 len 字段）——验 decrypt 边界纵深
function encryptRaw(encodingAESKey, rawBuf) {
  const key = Buffer.from(encodingAESKey + '=', 'base64')
  const iv = key.subarray(0, 16)
  const pad = 32 - (rawBuf.length % 32)
  const padded = Buffer.concat([rawBuf, Buffer.alloc(pad, pad)])
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
}

describe('decryptKfMessage 边界纵深（审计 P1·根因#3）', () => {
  it('msgLen 越界 → 抛错（不返回错位切片）', () => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(9999, 0) // 声明 9999 字节但实际只有 5 字节
    const raw = Buffer.concat([crypto.randomBytes(16), len, Buffer.from('short')])
    expect(() => decryptKfMessage(AESKEY, encryptRaw(AESKEY, raw))).toThrow()
  })
})

describe('defineKfCallback fail-closed（反向自检·根因#3）', () => {
  const make = (onEvent) => defineKfCallback({ token: () => TOKEN, aesKey: () => AESKEY, onEvent })
  const makeWithCorp = (onEvent, corpid) =>
    defineKfCallback({ token: () => TOKEN, aesKey: () => AESKEY, corpid: () => corpid, onEvent })

  it('POST receiveId≠corpid（跨 corp 伪造·企业内部单 corp）：onEvent 不调 + 告警', async () => {
    const inner = '<xml><Token><![CDATA[T]]></Token><OpenKfId><![CDATA[K]]></OpenKfId></xml>'
    const enc = encryptKf(AESKEY, inner, 'wwOTHERCORP') // 异 corp，签名合法
    const ts = '1700000004'
    const nonce = 'n-corp'
    const sig = kfSignature(TOKEN, ts, nonce, enc)
    const spy = vi.fn(async () => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = makeWithCorp(spy, CORPID)
    const body = `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`
    const res = await handler({ httpMethod: 'POST', queryStringParameters: { msg_signature: sig, timestamp: ts, nonce }, body })
    expect(spy).not.toHaveBeenCalled()
    expect(res.body).toBe('')
    expect(errSpy.mock.calls.flat().join(' ')).toContain('RECEIVEID_MISMATCH')
    errSpy.mockRestore()
  })

  it('POST receiveId===corpid：配 corpid 不误伤本 corp，照常处理', async () => {
    const inner = '<xml><Token><![CDATA[SYNC-TOK]]></Token><OpenKfId><![CDATA[wkOpenKf]]></OpenKfId></xml>'
    const enc = encryptKf(AESKEY, inner, CORPID)
    const ts = '1700000005'
    const nonce = 'n-corp-ok'
    const sig = kfSignature(TOKEN, ts, nonce, enc)
    const spy = vi.fn(async () => {})
    const handler = makeWithCorp(spy, CORPID)
    const body = `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`
    await handler({ httpMethod: 'POST', queryStringParameters: { msg_signature: sig, timestamp: ts, nonce }, body })
    expect(spy).toHaveBeenCalledOnce()
  })

  it('GET 验 URL：签名对 → 回解密后明文 echostr；签名错 → 回空', async () => {
    const echo = encryptKf(AESKEY, 'echo-plaintext-123', CORPID)
    const ts = '1700000001'
    const nonce = 'n-get'
    const sig = kfSignature(TOKEN, ts, nonce, echo)
    const handler = make(async () => {})
    const ok = await handler({ httpMethod: 'GET', queryStringParameters: { msg_signature: sig, timestamp: ts, nonce, echostr: echo } })
    expect(ok.body).toBe('echo-plaintext-123')
    const bad = await handler({ httpMethod: 'GET', queryStringParameters: { msg_signature: sig + 'x', timestamp: ts, nonce, echostr: echo } })
    expect(bad.body).toBe('')
  })

  it('POST 事件：签名对 → 解出 syncToken/openKfId 并调 onEvent', async () => {
    const inner = '<xml><Token><![CDATA[SYNC-TOK]]></Token><OpenKfId><![CDATA[wkOpenKf]]></OpenKfId></xml>'
    const enc = encryptKf(AESKEY, inner, CORPID)
    const ts = '1700000002'
    const nonce = 'n-post'
    const sig = kfSignature(TOKEN, ts, nonce, enc)
    const spy = vi.fn(async () => {})
    const handler = make(spy)
    const body = `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`
    await handler({ httpMethod: 'POST', queryStringParameters: { msg_signature: sig, timestamp: ts, nonce }, body })
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toMatchObject({ syncToken: 'SYNC-TOK', openKfId: 'wkOpenKf' })
  })

  it('POST 篡改签名（伪造）：onEvent 绝不被调 + [LD_ALERT] 告警', async () => {
    const inner = '<xml><Token><![CDATA[T]]></Token><OpenKfId><![CDATA[K]]></OpenKfId></xml>'
    const enc = encryptKf(AESKEY, inner, CORPID)
    const ts = '1700000003'
    const nonce = 'n-forge'
    const sig = kfSignature(TOKEN, ts, nonce, enc)
    const spy = vi.fn(async () => {})
    const handler = make(spy)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`
    const res = await handler({ httpMethod: 'POST', queryStringParameters: { msg_signature: sig + 'tamper', timestamp: ts, nonce }, body })
    expect(spy).not.toHaveBeenCalled()
    expect(res.body).toBe('')
    expect(errSpy.mock.calls.flat().join(' ')).toContain('FORGED_CALLBACK')
    errSpy.mockRestore()
  })
})
