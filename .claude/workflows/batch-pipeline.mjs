export const meta = {
  name: 'batch-pipeline',
  description: '通用批次流水线：规格预审 → 执行（错题本注入）→ 白名单边界断言 → 定向+无镜头评审 → 修订 → 边界复核',
  phases: [
    { title: '预审', detail: '规格自相矛盾/关键歧义扫描' },
    { title: '实现', detail: '执行者按规格落地（先守卫红后实现绿+反向自检）' },
    { title: '边界', detail: '改动文件 ⊆ 白名单（脚本级确定性断言）' },
    { title: '评审', detail: '定向镜头 + 无镜头评审员（区分真干净与镜头饱和）' },
    { title: '修订', detail: 'P0-P2 修复后边界复核' },
  ],
}

// 用法（主脑调用，2026-07-08 复盘流程 v2 的机器化落地）：
// Workflow({ scriptPath: '<repo>/.claude/workflows/batch-pipeline.mjs', args: {
//   specPath: '/abs/path/spec.md',            // 必填：批次规格文件（执行者/评审员都读它）
//   whitelist: ['docs/重构日志.md', 'rewrite/mp/pages/foo/'],  // 必填：允许改动路径；以 / 结尾=前缀匹配，否则精确匹配
//   ignore: ['design/console.pen'],           // 选填：并行会话已知改动，边界断言忽略
//   lenses: [{ key: '正确性', prompt: '……' }], // 选填：定向评审镜头；无镜头评审员总是自动追加
//   execModel: 'sonnet', execEffort: 'high',   // 选填：执行者档位（默认 sonnet/high）
//   skipSpecLint: false,                       // 选填：规格已人工预审过可跳过预审段
// }})
// 中止语义：预审出矛盾 / 执行未完成 / 边界越界 → 提前 return {aborted: ...}，工作区保持现场供主脑裁决。

// args 有时以 JSON 字符串形态到达（调用方编码差异），先容错解析再校验
let A = args || {}
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch { A = {} }
}
if (!A.specPath || !Array.isArray(A.whitelist) || A.whitelist.length === 0) {
  return { aborted: 'bad-args', hint: '必须提供 specPath 与非空 whitelist（对象或其 JSON 字符串均可）' }
}
const REPO = '/Users/sparrow/luckyducky-fable'
const NOTEBOOK = REPO + '/.claude/skills/refactor-batch/执行者错题本.md'
const MODEL = A.execModel || 'sonnet'
const EFFORT = A.execEffort || 'high'
const IGNORE = A.ignore || []

const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    filesChanged: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, change: { type: 'string', description: '一句话' } }, required: ['path', 'change'] } },
    guardRedProof: { type: 'string', description: '守卫先行红灯输出片段（无新守卫则写「本批无新守卫」）' },
    reverseSelfTest: { type: 'string', description: '反向自检：篡改什么→红输出片段→已还原绿' },
    checkResult: { type: 'string', description: 'npm run check 最终结果与测试计数' },
    decisions: { type: 'array', items: { type: 'string' }, description: '规格未覆盖处你做的小决策' },
    openQuestions: { type: 'array', items: { type: 'string' } },
    done: { type: 'boolean' },
  },
  required: ['filesChanged', 'guardRedProof', 'reverseSelfTest', 'checkResult', 'decisions', 'openQuestions', 'done'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', description: 'P0/P1/P2/P3' }, file: { type: 'string' }, line: { type: 'number' }, summary: { type: 'string' }, evidence: { type: 'string' }, suggestedFix: { type: 'string' } }, required: ['severity', 'file', 'summary', 'evidence'] } },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
}

const LINT_SCHEMA = {
  type: 'object',
  properties: {
    contradictions: { type: 'array', items: { type: 'string' }, description: '规格内部两处指令互相冲突' },
    ambiguities: { type: 'array', items: { type: 'string' }, description: '会迫使执行者擅自设计的关键歧义' },
  },
  required: ['contradictions', 'ambiguities'],
}

const PATHS_SCHEMA = {
  type: 'object',
  properties: { paths: { type: 'array', items: { type: 'string' }, description: '改动文件路径（相对仓根、非引号转义形式）' } },
  required: ['paths'],
}

const inList = (list) => (p) => list.some((w) => (w.endsWith('/') ? p.startsWith(w) : p === w))
const allowed = inList(A.whitelist)
const ignored = inList(IGNORE)

const boundaryPrompt = '在 ' + REPO + ' 只执行一条命令：git -c core.quotepath=false status --porcelain -uall（-c 防中文路径引号转义；-uall 让未跟踪目录下的文件逐个列出而非折叠成「目录/」——折叠形态会让白名单精确匹配误报越界）。把每一行的文件路径（含未跟踪 ?? 行；重命名行 a -> b 两个路径都列）原样输出为 paths 数组，相对仓根、不带状态前缀。不做任何修改、不做解读。'

phase('预审')
if (!A.skipSpecLint) {
  const lint = await agent('你是规格预审员（只读）。读规格文件 ' + A.specPath + '，只找两类问题：①内部自相矛盾（两处指令冲突，执行者无所适从）②会让执行者被迫擅自设计的关键歧义。风格/措辞问题不报。可在仓库 ' + REPO + ' 核对规格引用的 file:line 是否属实。输出精简结构化。', { label: 'lint:规格预审', model: 'sonnet', schema: LINT_SCHEMA })
  if (lint && lint.contradictions.length > 0) {
    log('规格预审发现矛盾，中止——先改规格再重跑')
    return { aborted: 'spec-lint', lint }
  }
  if (lint && lint.ambiguities.length > 0) log('预审歧义提示（未中止）：' + lint.ambiguities.join('；'))
}

phase('实现')
const exec = await agent('你是本仓 /refactor-batch 纪律下的批次执行者。第一步：读 ' + NOTEBOOK + '（执行者错题本——历任执行者踩过的坑，每条必须避开）。第二步：读批次规格 ' + A.specPath + ' 并严格执行全部步骤（能立守卫的先立且先红→实现到绿→反向自检留证→记账）。铁律：改动只允许落在白名单 ' + JSON.stringify(A.whitelist) + ' 内；不 git commit；不碰 packages/ 与 design/*.pen；npm run check 必须全绿（Bash timeout 给 600000）。规格冲突或现场与规格不符→记 openQuestions 停手，不擅自设计。返回精简结构化。', { label: 'exec:实现', model: MODEL, effort: EFFORT, schema: EXEC_SCHEMA })
if (!exec || !exec.done) {
  log('执行者未完成，中止')
  return { aborted: 'exec-incomplete', exec }
}

phase('边界')
const changed = await agent(boundaryPrompt, { label: 'boundary:改动清单', model: 'sonnet', schema: PATHS_SCHEMA })
const paths1 = changed ? changed.paths : []
const violations = paths1.filter((p) => !allowed(p) && !ignored(p))
if (violations.length > 0) {
  log('边界断言失败：' + violations.join('、'))
  return { aborted: 'boundary', violations, exec }
}

phase('评审')
const lensThunks = (A.lenses || []).map((l) => () =>
  agent('你是只读评审员——铁律：绝不执行任何写/还原命令（git checkout/restore/stash/clean、覆盖写文件一律禁止），验证性篡改也不许（工作区与其他并行评审共享，你的还原会清掉本批全部未提交改动并污染其他评审）；需要验证守卫咬合时只读推演或复制文件到 /tmp 沙盘做。（镜头：' + l.key + '）。仓库 ' + REPO + '，先读批次规格 ' + A.specPath + '，再用 git status / git diff（working tree 未提交部分）+ 读文件核实。' + l.prompt + '\n执行者自述（对照用，不可轻信）：' + JSON.stringify({ files: exec.filesChanged, decisions: exec.decisions }) + '\n只报确证问题（P0-P3）带 file:line 证据；无问题返回空 findings，不为凑数硬找。', { label: 'review:' + l.key, phase: '评审', model: 'sonnet', schema: REVIEW_SCHEMA })
)
const unprimedThunk = () =>
  agent('你是独立评审员——铁律：绝不执行任何写/还原命令（git checkout/restore/stash/clean、覆盖写文件一律禁止），验证性篡改也不许（工作区与其他并行评审共享）；需要验证时只读推演或复制文件到 /tmp 沙盘做。仓库 ' + REPO + ' 的 working tree 有一批未提交改动。除仓规 CLAUDE.md 外不给你任何背景提示：先用 git status / git diff 自行读懂这批改动想干什么，再以挑剔眼光找出任何你认为真实存在的问题（正确性/约定/安全/回归/账实不符），每条带 file:line 证据与严重度 P0-P3。发现不了就返回空 findings——不为凑数硬找。', { label: 'review:无镜头', phase: '评审', model: 'sonnet', schema: REVIEW_SCHEMA })
const reviews = await parallel([...lensThunks, unprimedThunk])

const allFindings = reviews.filter(Boolean).flatMap((r) => r.findings || [])
const serious = allFindings.filter((f) => ['P0', 'P1', 'P2'].includes(f.severity))
log('评审 findings ' + allFindings.length + ' 条，P0-P2 ' + serious.length + ' 条')

let fix = null
if (serious.length > 0) {
  phase('修订')
  fix = await agent('你是批次修订者。仓库 ' + REPO + '，working tree 有本批未提交改动。先读 ' + NOTEBOOK + ' 与规格 ' + A.specPath + '。逐条核实并修复以下 findings（核实为误报则给证据说明不修）；修完 npm run check 全绿（timeout 600000）；改动仍只许落在白名单 ' + JSON.stringify(A.whitelist) + '；不 commit、不碰 packages/ 与 design/*.pen。findings：\n' + JSON.stringify(serious, null, 2), { label: 'fix:修订', model: MODEL, effort: EFFORT, schema: EXEC_SCHEMA })
  const changed2 = await agent(boundaryPrompt, { label: 'boundary:复核', phase: '修订', model: 'sonnet', schema: PATHS_SCHEMA })
  const violations2 = (changed2 ? changed2.paths : []).filter((p) => !allowed(p) && !ignored(p))
  if (violations2.length > 0) {
    log('修订后边界断言失败：' + violations2.join('、'))
    return { aborted: 'boundary-after-fix', violations: violations2, exec, reviews, fix }
  }
}

return { exec, reviews, fix, p3Deferred: allFindings.filter((f) => f.severity === 'P3'), changedPaths: paths1 }
