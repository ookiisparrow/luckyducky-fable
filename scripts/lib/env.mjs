// 云环境目录 + 选择子单源（病根#5「样板复制即漂移」·Issue #106）。
//
// 怎么用（不连云、不要密钥）：
//   npm run env:resolve                         # 列出 stub / test / prod-readonly
//   npm run env:resolve -- --target test        # 解析测试云
//   npm run env:resolve -- --target stub
//   npm run env:resolve -- --target prod-readonly
//   node scripts/loadtest.mjs --target test --mode cas
//   node scripts/deploy-test.mjs --target test
//
// 规则：
//   · 生产是缺省只读保险：没点名就当 prod-readonly，绝不默认可写。
//   · 测试云必须显式 --target test（或 --env 命中目录里的测试 id）。
//   · 写操作（deploy-test / loadtest / test-api）只许 test。
//   · 生产写入只走 deploy-fns + DEPLOY_ALLOWED，不在本选择子里开「prod-write」。
//   · 门牌号只在本文件以 PROD_ENV / TEST_ENV 两处字面量出现；别处 import。
//   · 不进 git：密钥 / token / secretId。本目录只有公开 env id 与分支对照。

export const PROD_ENV = 'cloudbase-d4gcssqbv06865479'
export const TEST_ENV = 'yaliceshi-d3get0o7ja6c91f8f'

/** @typedef {'stub' | 'test' | 'prod-readonly'} EnvSelector */

export const ENV_SELECTORS = /** @type {const} */ (['stub', 'test', 'prod-readonly'])

/** @type {Record<EnvSelector, {
 *   selector: EnvSelector,
 *   label: string,
 *   envId: string | null,
 *   gitBranch: string | null,
 *   writes: boolean,
 *   cloud: boolean,
 *   may: string[],
 *   note?: string,
 * }>} */
export const ENV_CATALOG = {
  stub: {
    selector: 'stub',
    label: '内存桩',
    envId: null,
    gitBranch: null,
    writes: false,
    cloud: false,
    may: ['assert'],
  },
  test: {
    selector: 'test',
    label: '测试云',
    envId: TEST_ENV,
    gitBranch: 'test',
    writes: true,
    cloud: true,
    may: ['assert', 'deploy-test', 'loadtest', 'test-api'],
    note: '体验版 2026-12-15 到期',
  },
  'prod-readonly': {
    selector: 'prod-readonly',
    label: '生产只读',
    envId: PROD_ENV,
    gitBranch: 'main',
    writes: false,
    cloud: true,
    may: ['assert', 'inspect', 'patrol', 'db-export'],
  },
}

const SELECTOR_SET = new Set(ENV_SELECTORS)

function cloneEntry(selector) {
  const e = ENV_CATALOG[selector]
  return { ...e, may: e.may.slice() }
}

/**
 * 把选择子 / 别名 / 已入册 envId 收成目录行。
 * 空输入 → prod-readonly（生产只读保险，不默认可写、不滑进测试云）。
 * `prod` / 生产 envId → prod-readonly（本层永不给出生产写入）。
 */
export function resolveTarget(input) {
  const raw = input == null ? '' : String(input).trim()
  if (!raw) return cloneEntry('prod-readonly')
  if (SELECTOR_SET.has(raw)) return cloneEntry(raw)
  if (raw === 'prod' || raw === 'production' || raw === PROD_ENV) return cloneEntry('prod-readonly')
  if (raw === TEST_ENV) return cloneEntry('test')
  throw new Error(`未知环境选择「${raw}」——只认 stub | test | prod-readonly（或已入册的 envId）`)
}

/** 写测试云：必须显式点名 test；空输入 / 生产 / 桩一律拒。 */
export function resolveWriteTestTarget(input) {
  const raw = input == null ? '' : String(input).trim()
  if (!raw) {
    throw new Error('写测试须显式 --target test（测试云不会从缺省滑进去；也可用 --env 命中目录里的测试 id）')
  }
  const t = resolveTarget(raw)
  if (t.selector !== 'test' || !t.writes || !t.envId) {
    throw new Error(`拒绝：${t.selector} 不可写。压测/测部署只打测试云，须 --target test`)
  }
  return t
}

export function assertMay(entry, action) {
  if (!entry || !entry.may.includes(action)) {
    const sel = entry && entry.selector ? entry.selector : '?'
    throw new Error(`${sel} 不允许 ${action}（目录 may 名单）`)
  }
}

/** 从 argv / 环境变量取选择子。不设缺省——缺省由调用方决定（写=必显式，读=生产只读）。 */
export function parseTargetFromArgv(argv = process.argv, env = process.env) {
  const flag = (name) => {
    const i = argv.indexOf('--' + name)
    return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : ''
  }
  return flag('target') || flag('env') || env.LD_TARGET || env.LD_TEST_ENV || env.TEST_ENV || ''
}

export function listTargets() {
  return ENV_SELECTORS.map((s) => cloneEntry(s))
}
