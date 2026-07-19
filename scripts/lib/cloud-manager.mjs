// 生产环境凭证桥接（本地运维脚本专用，只读面：db-export.mjs / check-indexes.mjs 消费）。
//
// 云函数运行时靠 SCF 自动注入 TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN（见
// rewrite/cloud/src/functions/adminApi/lib.ts::manager()），本地脚本没有这层注入。改走
// `tcb secrets get --json`——CloudBase CLI 官方支持的「登录态换临时密钥」桥接（--help 原文：
// 获取当前登录态的临时密钥，可用于初始化 manager-node / node-sdk），复用已登录的 CLI 会话、
// 不新落盘一份密钥文件。envId 默认取 scripts/lib/env.mjs 的生产环境单源，不新开定义。
//
// 【安全红线】凭证值（secretId/secretKey/token）任何时候不得原样出现在 console.log / 错误信息
// 里——本文件任何新增代码若要打印调试信息，只能打印"凭证来源分类"（env / tcb secrets），
// 不能插值密钥字符串本身。CredentialError 的 message 是固定指引文案，不插值任何凭证相关变量。

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { PROD_ENV } from './env.mjs'

const require = createRequire(import.meta.url)

const GUIDANCE =
  '拿不到云开发生产凭证。请任选其一：\n' +
  '① 运行 `tcb login` 后重跑（脚本会自动经 `tcb secrets get --json` 复用登录态）；\n' +
  '② 或设置环境变量 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY' +
  '（腾讯云 CAM 子账号密钥，需云开发管理权限，可复用 VOD 用的 ld-vod 子账号或新建只读子账号）后重跑。'

export class CredentialError extends Error {
  constructor(detail) {
    super(GUIDANCE + (detail ? `\n（诊断：${detail}）` : ''))
    this.name = 'CredentialError'
  }
}

// 纯函数：解析 `tcb secrets get --json` 的 stdout，取临时密钥三件套。
// 失败分支绝不回显 stdout 原文（可能含真实密钥）——诊断信息只报固定分类文案。
export function parseTcbSecretsJson(stdout) {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new CredentialError('解析 tcb secrets get 输出失败')
  }
  const data = parsed && parsed.data
  if (!data || typeof data.secretId !== 'string' || typeof data.secretKey !== 'string') {
    throw new CredentialError('解析 tcb secrets get 输出失败')
  }
  return { secretId: data.secretId, secretKey: data.secretKey, token: data.token }
}

let _manager = null

// 取 manager-node 实例（懒加载 + 单例缓存，同 adminApi/lib.ts::manager() 精神一致）。
// 凭证优先级：① 环境变量（与云函数运行时命名一致，便于 CAM 子账号密钥场景）；
// ② tcb secrets get --json 桥接已登录态。两者皆无 / 执行失败 → CredentialError。
export async function getManager(envId = PROD_ENV) {
  if (_manager) return _manager
  const Manager = require('@cloudbase/manager-node')

  let creds
  if (process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY) {
    creds = {
      secretId: process.env.TENCENTCLOUD_SECRETID,
      secretKey: process.env.TENCENTCLOUD_SECRETKEY,
      token: process.env.TENCENTCLOUD_SESSIONTOKEN,
    }
  } else {
    let stdout
    try {
      stdout = execFileSync('tcb', ['secrets', 'get', '--json'], { encoding: 'utf8' })
    } catch {
      throw new CredentialError('执行 tcb secrets get 失败（是否已 tcb login？）')
    }
    creds = parseTcbSecretsJson(stdout)
  }

  _manager = new Manager({ secretId: creds.secretId, secretKey: creds.secretKey, token: creds.token, envId })
  return _manager
}
