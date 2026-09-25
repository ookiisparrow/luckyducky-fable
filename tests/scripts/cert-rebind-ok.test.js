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

describe('证书换绑成功判断', () => {
  it('成功回包判成功：退出码 0，且 data 里有 RequestId，没有 error', () => {
    expect(judge({
      data: { RequestId: 'e9f7150d-e942-4c5b-a2df-b45b3db55e2a' },
    }, 0)).toBe(true)
  })

  it('带 message 的失败回包判失败，不能接着拆域名', () => {
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
    // 旧判断只看字符串里有没有 message，这种也会被当成成功
    expect(judge({
      data: { message: '操作失败', code: 'API_ERROR' },
    }, 0)).toBe(false)
  })

  it('空回包和解析失败判失败', () => {
    expect(judge(null, 0)).toBe(false)
    expect(judge(null, 1)).toBe(false)
    expect(judge({}, 0)).toBe(false)
    expect(judge({ data: {} }, 0)).toBe(false)
    expect(parsedOk('', 0)).toBe(false)
    expect(parsedOk('不是 JSON，但是正文里有 message', 0)).toBe(false)
    expect(parsedOk('{这不是合法 JSON，message', 0)).toBe(false)
  })

  it('有 RequestId 但仍带着 Error，或进程没成功，都判失败', () => {
    expect(judge({
      data: {
        RequestId: 'e9f7150d-e942-4c5b-a2df-b45b3db55e2a',
        Error: { Code: 'FailedOperation', Message: '绑定失败' },
      },
    }, 0)).toBe(false)
    expect(judge({
      data: { RequestId: 'e9f7150d-e942-4c5b-a2df-b45b3db55e2a' },
    }, 1)).toBe(false)
    expect(judge({
      data: {
        RequestId: 'e9f7150d-e942-4c5b-a2df-b45b3db55e2a',
        OwnershipVerification: { DnsVerification: [{ Subdomain: '_dnsauth' }] },
      },
    }, 0)).toBe(false)
  })
})
