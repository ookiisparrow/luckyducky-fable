import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = resolve(REPO, 'ops/certs/cert-rebind.py')

// 不联网：只问脚本里的成功判断。解析失败用 null 表示（和脚本解析不到 JSON 时一样）。
function loadJudge() {
  return `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("cert_rebind", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
`
}

function judge(payload, returncode = 0) {
  const py = `${loadJudge()}
raw, code = sys.argv[2], int(sys.argv[3])
parsed = None if raw == "null" else json.loads(raw)
print("yes" if mod.tcb_step_ok(parsed, code) else "no")
`
  const raw = payload === null ? 'null' : JSON.stringify(payload)
  const r = spawnSync('python3', ['-c', py, SCRIPT, raw, String(returncode)], {
    encoding: 'utf8',
    cwd: REPO,
  })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `python 退出 ${r.status}`)
  return r.stdout.trim() === 'yes'
}

function parsedOk(text, returncode = 0) {
  const py = `${loadJudge()}
text, code = sys.argv[2], int(sys.argv[3])
print("yes" if mod.tcb_step_ok(mod.parse_tcb_output(text), code) else "no")
`
  const r = spawnSync('python3', ['-c', py, SCRIPT, text, String(returncode)], {
    encoding: 'utf8',
    cwd: REPO,
  })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `python 退出 ${r.status}`)
  return r.stdout.trim() === 'yes'
}

const RID = 'e9f7150d-e942-4c5b-a2df-b45b3db55e2a'

describe('证书换绑成功判断', () => {
  // 文案取自 @cloudbase/cli 3.7.3 源码里四个命令 --json 成功分支的 outputJson 原文
  it('tcb 3.7.3 四步真实成功回包判成功（data 里只有 message，没有 RequestId）', () => {
    expect(judge({
      data: { domain: 'www.luckyducky.cn', paths: ['/'], message: '成功删除 1 个路由' },
    }, 0)).toBe(true)
    expect(judge({
      data: { domain: 'www.luckyducky.cn', message: '解绑自定义域名成功' },
    }, 0)).toBe(true)
    expect(judge({
      data: {
        domain: 'www.luckyducky.cn',
        certId: 'cert-id-placeholder',
        accessType: 'DIRECT',
        enable: true,
        message: '绑定自定义域名成功',
      },
    }, 0)).toBe(true)
    expect(judge({
      data: { domain: 'www.luckyducky.cn', routeCount: 1, message: '成功创建 HTTP 服务路由' },
    }, 0)).toBe(true)
  })

  it('tcb 3.8.x 成功回包判成功（data 里有 RequestId）', () => {
    expect(judge({ data: { RequestId: RID } }, 0)).toBe(true)
  })

  it('带 error 键或退出码非 0 判失败，不能接着拆域名', () => {
    expect(judge({
      error: {
        code: 'API_ERROR',
        message: '域名下还有路由，解绑失败',
        exit_code: 1,
      },
    }, 1)).toBe(false)
    // 进程碰巧是 0、正文里还有 requestId，只要包在 error 里仍是失败
    expect(judge({
      error: {
        code: 'API_ERROR',
        message: '域名下还有路由，解绑失败',
        exit_code: 1,
        requestId: 'still-a-failure',
      },
    }, 0)).toBe(false)
  })

  it('空回包、不是 dict、解析失败判失败', () => {
    expect(judge(null, 0)).toBe(false)
    expect(judge(null, 1)).toBe(false)
    expect(judge({}, 0)).toBe(false)
    expect(judge({ data: {} }, 0)).toBe(false)
    expect(judge([{ data: { RequestId: RID } }], 0)).toBe(false)
    expect(judge({ data: 'ok' }, 0)).toBe(false)
    expect(parsedOk('', 0)).toBe(false)
    expect(parsedOk('不是 JSON，但是正文里有 message', 0)).toBe(false)
    expect(parsedOk('{这不是合法 JSON，message', 0)).toBe(false)
  })

  it('成功 JSON 后面跟着警告文字（stderr 拼在 stdout 后）仍判成功', () => {
    const ok = JSON.stringify({ data: { domain: 'www.luckyducky.cn', paths: ['/'], message: '成功删除 1 个路由' } }, null, 2)
    expect(parsedOk('? 确认删除路由？ Yes\n' + ok + '\n(node:1) Warning: something deprecated\n', 0)).toBe(true)
  })

  it('顶层带 error 即使退出码 0、data 像成功也判失败', () => {
    expect(judge({ error: { code: 'API_ERROR', message: '解绑失败' }, data: { RequestId: RID } }, 0)).toBe(false)
  })

  it('成功形状但带着 Error，或进程没成功，都判失败', () => {
    expect(judge({
      data: { RequestId: RID, Error: { Code: 'FailedOperation', Message: '绑定失败' } },
    }, 0)).toBe(false)
    expect(judge({ data: { RequestId: RID } }, 1)).toBe(false)
    expect(judge({ data: { domain: 'www.luckyducky.cn', message: '解绑自定义域名成功' } }, 1)).toBe(false)
  })

  it('归属权：DnsVerification 非空才判失败，和 CLI 3.8.4 一致', () => {
    expect(judge({
      data: {
        RequestId: RID,
        OwnershipVerification: { DnsVerification: [{ Subdomain: '_dnsauth' }] },
      },
    }, 0)).toBe(false)
    expect(judge({
      data: { RequestId: RID, OwnershipVerification: { DnsVerification: [] } },
    }, 0)).toBe(true)
    expect(judge({
      data: { RequestId: RID, OwnershipVerification: {} },
    }, 0)).toBe(true)
  })
})
