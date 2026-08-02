// omp 车道闸的守卫（2026-08-02 立·病根#16 守卫绑定漂移·根因#3 信任边界）。
//
// 病史：`.mcp.json` 是**两代理共用**的挂载清单，cloudbase 18 个生产写工具（云函数部署/静态托管/
// 产库直写/权限修改/callCloudApi 任意云 API 直通）对 Claude 与 omp 同时可见。但 deny 名单是**各家
// 自己的 schema**：Claude 读 `.claude/settings.json` 的 `permissions.deny`，omp 读 `.omp/config.yml`
// 的 `tools.approval`。此前只有 Claude 侧有闸，omp 侧实测为空——18 个写工具只有纸面禁令拦着。
// 而守卫 `mcp-write-tools-denied` 只核 `.claude` 那份，故一路全绿：多了一条车道，守卫指着的名单就
// 不再覆盖现实，**而守卫自己不会喊**。
//
// 本测试补的正是那个缺口，且**期望值从 Claude 那份名单自动推导**（不手抄第二份清单·错题本 E9）：
// 任何一侧新增/改名 deny 条目，另一侧没跟上就红——两车道由机器保持同步。
//
// 命名规则不同是本域最阴险处（照抄必静默失效）：
//   Claude 侧 `mcp__cloudbase__manageFunctions`（双下划线 + 驼峰）
//   omp   侧 `mcp__cloudbase_managefunctions`（单下划线 + 全小写·经 `omp -p` 实测 tools/list 取回）
//
// 诚实边界（本测试**管不到**的部分，靠人 + 全局配置兜）：
//   ① omp 项目层配置按 **cwd** 生效、不做祖先目录查找——从 `rewrite/mp` 等子目录启动会话时本文件
//      不生效（实测）。兜底＝同一份 deny 已写进全局 `~/.omp/agent/config.yml`（机器外、不在版本库、
//      故本测试核不到）。
//   ② 配置在**会话启动时**读取，改完须新开会话才生效。
//   ③ CLI `--config` 覆盖层优先级高于项目层，人工授权部署时可临时放行——刻意保留的旁路。
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const OMP_CFG = resolve(ROOT, '.omp/config.yml')
const CLAUDE_SETTINGS = resolve(ROOT, '.claude/settings.json')
const TOOL_REGISTRY = resolve(ROOT, 'tests/fixtures/cloudbase-mcp-tools.json')

/** Claude 条目名 → omp 条目名：`mcp__<server>__<Tool>` ⇒ `mcp__<server>_<tool 全小写>`。 */
const toOmpName = (claudeName) => {
  const m = /^mcp__([^_]+(?:-[^_]+)*)__(.+)$/.exec(claudeName)
  if (!m) return null
  return `mcp__${m[1]}_${m[2].toLowerCase()}`
}

describe('omp 车道闸（.omp/config.yml·与 .claude/settings.json 对等）', () => {
  it('闸文件存在且非空——被删/被清空即红（此前无人看守，是原病灶旁的同病灶）', () => {
    expect(existsSync(OMP_CFG), '.omp/config.yml 缺失——omp 车道的 MCP 写工具与部署命令闸没了').toBe(true)
    expect(readFileSync(OMP_CFG, 'utf8').trim().length).toBeGreaterThan(0)
  })

  // ── 白名单（fail-closed）那一半（2026-08-02 老板拍板「反过来」）──
  // 为什么需要：deny 名单天生 fail-open——未列名＝放行，server 升级多出一个写工具就自动不受管，
  // 而且**不会有任何提示**。实测 omp 的 tools.approval 是精确名匹配、不支持 `"*": deny` 通配默认拒
  // （已验：写了 `"*": deny` 后 glob 照样能用），故配置层做不出默认拒。补法＝全量工具册 + 本组断言：
  // 「册里每个非只读工具都必须有显式 deny」，未分类/新出现的工具即红，由人分类后才能过。
  it('cloudbase 全量册的每个非只读工具都有显式 deny——未分类即红（fail-closed 的机器半边）', () => {
    const reg = JSON.parse(readFileSync(TOOL_REGISTRY, 'utf8'))
    const cfg = readFileSync(OMP_CFG, 'utf8')
    const overlap = reg.read.filter((t) => reg.write.includes(t))
    expect(overlap, `工具册自相矛盾：这些既在 read 又在 write：${overlap.join(', ')}`).toEqual([])
    // 钉总数：只核「write 册每条有 deny」的话，把某条从册里整条删掉即可静默缩小受检集合
    // （本批反向自检 W② 当场发现守卫对此不咬，故补此条）
    expect(
      reg.read.length + reg.write.length,
      `工具册条目数（read ${reg.read.length} + write ${reg.write.length}）≠ 钉版实测总数 ${reg._totalTools}——有人删了条目或 server 换了版本`
    ).toBe(reg._totalTools)
    expect(new Set([...reg.read, ...reg.write]).size, '工具册有重复条目').toBe(reg._totalTools)

    const missing = reg.write.filter(
      (t) => !new RegExp(`^\\s*mcp__cloudbase_${t}\\s*:\\s*deny\\s*$`, 'm').test(cfg)
    )
    expect(missing, `这些非只读工具没有 deny（fail-open 缺口）：${missing.join(', ')}`).toEqual([])
  })

  it('工具册与 .mcp.json 的钉版一致——server 升版即红，逼人重新枚举再分类', () => {
    const reg = JSON.parse(readFileSync(TOOL_REGISTRY, 'utf8'))
    const mcp = readFileSync(resolve(ROOT, '.mcp.json'), 'utf8')
    expect(
      mcp.includes(`@cloudbase/cloudbase-mcp@${reg._pinnedVersion}`),
      `.mcp.json 的 cloudbase 版本与工具册钉版（${reg._pinnedVersion}）不符——新版可能多出未分类的写工具，须重新 tools/list 枚举后更新 ${'tests/fixtures/cloudbase-mcp-tools.json'}`
    ).toBe(true)
  })

  it('两车道 deny 名单逐条同步——期望值由 Claude 那份自动推导，不手抄第二份清单', () => {
    const deny = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf8'))?.permissions?.deny ?? []
    const mcpDeny = deny.filter((d) => d.startsWith('mcp__'))
    expect(mcpDeny.length, '.claude/settings.json 的 MCP deny 名单为空——两侧都失守了').toBeGreaterThan(0)

    const cfg = readFileSync(OMP_CFG, 'utf8')
    const missing = []
    for (const claudeName of mcpDeny) {
      const ompName = toOmpName(claudeName)
      expect(ompName, `无法从 ${claudeName} 推导 omp 名（命名规则变了？）`).not.toBeNull()
      // 必须是「该名: deny」，不能只是出现在注释里
      if (!new RegExp(`^\\s*${ompName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*deny\\s*$`, 'm').test(cfg)) {
        missing.push(`${claudeName} → 缺 ${ompName}: deny`)
      }
    }
    expect(missing, `omp 车道漏了这些写工具的 deny（照抄 Claude 的名字会静默失效，须用单下划线+全小写）：\n${missing.join('\n')}`).toEqual([])
  })

  it('裸部署命令闸在位（交接步1 列为「正式切换前置」的那条）', () => {
    const cfg = readFileSync(OMP_CFG, 'utf8')
    for (const cmd of ['tcb', 'wechatide']) {
      expect(
        new RegExp(`match:\\s*"${cmd} \\*"[\\s\\S]{0,60}?approval:\\s*deny`, 'm').test(cfg),
        `.omp/config.yml 缺 ${cmd} 的 bash.patterns deny——裸部署命令又没闸了`
      ).toBe(true)
    }
  })

  it('不许把整个 bash 一刀切 deny——那会废掉本车道且极易被误加', () => {
    const cfg = readFileSync(OMP_CFG, 'utf8')
    // tools.approval 下若出现裸 `bash: deny`，所有命令都跑不了（omp 的拒绝文案恰好也长这样，极易混淆）
    expect(/^\s{4}bash\s*:\s*deny\s*$/m.test(cfg), 'tools.approval 里出现了 `bash: deny`——这会禁掉全部命令，应改用 bash.patterns 按模式拦').toBe(false)
  })
})
