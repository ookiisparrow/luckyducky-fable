// 部署/密钥闸旁路（#400-6）：判定看「会不会读出/改动云端密钥与函数配置」，不看字面程序名。
// 只把命令字符串喂给 guard-deploy 的判定，绝不真跑这些命令。
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GUARD = resolve(ROOT, 'scripts/guard-deploy.mjs')

// 临时脚本只写不跑：hook 读它的内容做判定
const TMP = mkdtempSync(join(tmpdir(), 'r4-devgate-gd-'))
const tmpFile = (name, body) => {
  const p = join(TMP, name)
  writeFileSync(p, body)
  return p
}
const DETAIL_MJS = tmpFile('detail.mjs', "import { execSync } from 'node:child_process'\nexecSync('env -u http_proxy tcb fn detail adminApi', { stdio: 'inherit' })\n")
const MANAGER_MJS = tmpFile(
  'mgr.mjs',
  "import { getManager } from './scripts/lib/cloud-manager.mjs'\nconst m = await getManager()\nconsole.log(await m.functions.getFunctionDetail('adminApi'))\n"
)
const DUMP_SH = tmpFile('dump.sh', '#!/bin/sh\nenv -u http_proxy tcb fn detail adminApi\n')
const LOG_SH = tmpFile('log.sh', '#!/bin/sh\n# 只看日志\ntcb fn log app\n')
const PLAIN_MJS = tmpFile('plain.mjs', "console.log('tcb fn detail 只是字样')\n")

const decide = (command) => {
  const out = execFileSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    cwd: ROOT,
  })
  return /"ask"/.test(out) ? 'ask' : 'allow'
}

describe('旁路收口：这些命令会读出或改动云端密钥/函数配置 → ask', () => {
  it.each([
    // tccli：GetFunction 原样回显函数环境变量；Invoke 无 OPENID 被当服务端放行
    'tccli scf GetFunction --FunctionName adminApi',
    'tccli scf Invoke --FunctionName payCallback',
    'tccli scf UpdateFunctionConfiguration --FunctionName app',
    'env -u http_proxy tccli scf GetFunction --FunctionName app',
    'R=$(tccli scf GetFunction --FunctionName app)',
    '/usr/local/bin/tccli scf GetFunction --FunctionName app',
    // python 运维脚本：程序位是 python，真动作是脚本里调的 tccli/tcb
    'python3 ops/certs/cert-renew.py www.luckyducky.cn',
    'python3 ops/certs/cert-rebind.py www.luckyducky.cn X / STATIC_STORE staticstore',
    'CERT_OPS_LOG_DIR=/tmp python3 ops/certs/cert-dns-watch.py',
    './ops/certs/cert-renew.py www.luckyducky.cn',
    'timeout 600 python3 ops/certs/cert-renew.py q.luckyducky.cn',
    'cd ops/certs && python3 cert-renew.py www.luckyducky.cn', // 读不到脚本 → 往严
    `python3 -c "import subprocess; subprocess.run(['tccli','scf','GetFunction','--FunctionName','app'])"`,
    "python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['tcb', 'fn', 'detail', 'app'])\nEOF",
    'python3 -m tccli scf GetFunction --FunctionName app',
    `node -e "require('child_process').execSync('tcb fn detail app')"`,
    // db-export --include-secrets：导出 secureConfig；包进 npm script 也一样
    'node scripts/db-export.mjs --include-secrets',
    'npm run db:export -- --include-secrets',
    'SECRETS_EXPORT_ALLOWED=1 npm run db:export -- --collections=secureConfig --include-secrets',
    'pnpm run db:export -- --include-secrets',
    // 复审 P1：node 经仓内凭证桥读函数详情；代码里 tcb 前面带 npx/env 前缀；-pe、管道喂给 node
    `node -e "import('./scripts/lib/cloud-manager.mjs').then(m=>m.getManager()).then(g=>g.functions.getFunctionDetail('adminApi')).then(console.log)"`,
    `node -e "require('child_process').execSync('npx tcb fn detail app')"`,
    `node -e "require('child_process').execSync('env -u http_proxy tcb fn detail app')"`,
    `python3 -c "import subprocess; subprocess.run('env -u http_proxy tcb secrets get --json', shell=True)"`,
    `node -pe "require('child_process').execSync('tcb fn detail app').toString()"`,
    `echo "require('child_process').execSync('tcb fn detail app')" | node`,
    // 复审 P1：脚本文件（node / bash / sh / stdin 重定向）按内容判，读不到往严
    `node ${DETAIL_MJS}`,
    `node ${MANAGER_MJS}`,
    `node < ${DETAIL_MJS}`,
    `env -u http_proxy node ${DETAIL_MJS}`,
    `npx tsx ${DETAIL_MJS}`,
    'node /nonexistent-r4-devgate/x.mjs',
    `bash ${DUMP_SH}`,
    `sh ${DUMP_SH}`,
    `source ${DUMP_SH}`,
    DUMP_SH,
    'bash /nonexistent-r4-devgate/x.sh',
    // 复审 P1：tccli 是 pip 包，command not found 后最自然的改写走 python runner
    'uvx tccli scf GetFunction --FunctionName adminApi',
    'uv run tccli scf GetFunction --FunctionName adminApi',
    'pipx run tccli scf GetFunction --FunctionName adminApi',
    'poetry run tccli scf GetFunction --FunctionName adminApi',
    'python3 < ops/certs/cert-renew.py www.luckyducky.cn',
    // 复审 P2：run 前带 npm 自己的选项
    'npm -s run db:export -- --include-secrets',
    'npm --prefix . run db:export -- --include-secrets',
  ])('%s → ask', (cmd) => {
    expect(decide(cmd)).toBe('ask')
  })
})

describe('不误拦：不碰密钥与函数配置的日常命令 → allow', () => {
  it.each([
    'npm run db:export',
    'node scripts/db-export.mjs --collections=orders,users',
    'npm run check',
    'npm test',
    'npm run preview:mp',
    'python3 -m json.tool package.json',
    `python3 -c "print(1)"`,
    "python3 - <<'EOF'\nimport json\nprint(json.dumps({}))\nEOF",
    `node -e "console.log(1)"`,
    'git commit -m "fix: tccli python3 ops/certs/cert-renew.py --include-secrets"',
    'echo tccli scf GetFunction',
    // 脚本文件只认真调用：注释、用例表里的 tcb 字样不算（check-structure 的闸用例表满是这类字样）
    'node scripts/check-structure.mjs',
    'npm run check:structure',
    'npm run build:rw-cloud',
    'npm run patrol',
    `node ${PLAIN_MJS}`,
    `bash ${LOG_SH}`,
    'npm -s run test',
  ])('%s → allow', (cmd) => {
    expect(decide(cmd)).toBe('allow')
  })
})

describe('settings.json：只会明文打印密钥的命令直接 deny', () => {
  it('fn detail / secrets get / GetFunction 在 deny 里', () => {
    const { deny = [] } = JSON.parse(readFileSync(resolve(ROOT, '.claude/settings.json'), 'utf8')).permissions ?? {}
    for (const rule of ['Bash(tcb fn detail:*)', 'Bash(tcb secrets get:*)', 'Bash(tccli scf GetFunction:*)'])
      expect(deny).toContain(rule)
  })
})
