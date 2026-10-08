// 企业微信客服回调的测试报文：WXBizMsgCrypt 正向加密（与 decryptKfMessage 互为逆运算）+「有新消息」SYNC 通知事件。
import crypto from 'node:crypto'
import { kfSignature } from '../../src/kit'

export function kfEncrypt(aesKey: string, message: string, corpId: string): string {
  const key = Buffer.from(aesKey + '=', 'base64')
  const msg = Buffer.from(message, 'utf8')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(msg.length, 0)
  let buf = Buffer.concat([crypto.randomBytes(16), len, msg, Buffer.from(corpId, 'utf8')])
  const pad = 32 - (buf.length % 32 || 32) || 32
  buf = Buffer.concat([buf, Buffer.alloc(pad, pad)])
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(buf), cipher.final()]).toString('base64')
}

/** 一条 SYNC 通知的 kfCallback 入参（签名时间戳 '1'、随机串 '2'）。token/aesKey/corpId 须与测试设的 WXKF_* 环境一致。 */
export function kfSyncEvent(o: { token: string; aesKey: string; corpId: string; openKfId: string }) {
  const enc = kfEncrypt(o.aesKey, `<xml><Token>SYNC</Token><OpenKfId>${o.openKfId}</OpenKfId></xml>`, o.corpId)
  return {
    httpMethod: 'POST',
    queryStringParameters: { msg_signature: kfSignature(o.token, '1', '2', enc), timestamp: '1', nonce: '2' },
    body: `<xml><Encrypt><![CDATA[${enc}]]></Encrypt></xml>`,
  }
}
