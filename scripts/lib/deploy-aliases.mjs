/**
 * 部署别名单源（病根#5 单源 / 病根#16 指针漂移）——产物名 → 实际要部署的云函数名清单。
 *
 * 现值（2026-08-13 起）：别名册空。`adminApi` 产物只部署云函数 `adminApi`，不要再部署 `adminApiV2`。
 *
 * 这段表为什么还留着：M5 曾把同一份产物双发成 `adminApi` + `adminApiV2`（HTTP `/adminv2`）。
 * 映射当时只写在文档里、脚本没做，2026-07-20 实测「17 个产物都发了、后台零生效」。
 * 修法是把映射落成代码单源。双名收编后表清空，但 `deployTargets` 仍是展开入口——再有双发需求才往里加。
 *
 * 新增别名的判据：一份产物需要在云端存在多个函数名（灰度/并行/HTTP 路径绑定）时才登记；
 * 普通函数不进此表（`deployTargets` 默认返回其自身）。
 */
export const DEPLOY_ALIASES = {
  // 空：adminApi 只部署自身。勿把 adminApiV2 写回来。
}

/** 产物名 → 该产物要部署到的全部云函数名（无别名则为其自身） */
export const deployTargets = (name) => DEPLOY_ALIASES[name] || [name]

/** 产物名清单 → 展开别名后的全部云函数名（去重·供 cloudbaserc 完整性守卫比对） */
export const allDeployNames = (names) => [...new Set(names.flatMap((n) => deployTargets(n)))]
