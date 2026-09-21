/**
 * 项目降熵测版入口：EntropyDecideRequest → EntropyDecideResponse。
 * 独立云函数，不挂 kfCallback / JEV_CS_ROUTE。调用说明见同目录 CALLER.md。
 */
import { withAdminGate } from '../../../kit'
import { entropyDecide, extractRequest } from './decide'

function httpReply(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export const main = withAdminGate(async ({ event, db }) => {
  const req = extractRequest(event)
  const result = await entropyDecide(req, { db })
  if (event && event.httpMethod) {
    const status = result && 'ok' in result && result.ok === false ? 400 : 200
    return httpReply(status, result)
  }
  return result
})
