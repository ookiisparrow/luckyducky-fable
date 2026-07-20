/**
 * 部署别名单源（病根#5 单源 / 病根#16 指针漂移）——产物名 → 实际要部署的云函数名清单。
 *
 * 为什么存在：M5 切换（2026-07-04/09）为「新名零覆盖」把 `adminApi` 产物部署成云函数 `adminApiV2`
 * （HTTP 触发路径 `/adminv2`；admin 前端 `.env.production` 的 VITE_ADMIN_API 指向它），旧名 `adminApi`
 * 保留。该映射此前只活在 `docs/系统事实.md` 的一行叙述里，`scripts/deploy-fns.mjs` 从未实现——
 * **自动部署会漏掉真正服务后台的那个函数**。2026-07-20 Phase3 战役部署时实测复现：17 个产物逐个部署完、
 * 后台改动却零生效（admin 走 adminApiV2、它还是旧代码），靠人工查 `tcb service list` 才发现。
 * 修复＝把映射落成代码单源，部署脚本与结构守卫共用，杜绝「文档写了、脚本没做」。
 *
 * 新增别名的判据：一份产物需要在云端存在多个函数名（灰度/并行/HTTP 路径绑定）时才登记；
 * 普通函数不进此表（`deployTargets` 默认返回其自身）。
 */
export const DEPLOY_ALIASES = {
  // adminApi 产物同时部署为 adminApi（旧名·保留）与 adminApiV2（/adminv2·admin 前端实际调用方）
  adminApi: ['adminApi', 'adminApiV2'],
}

/** 产物名 → 该产物要部署到的全部云函数名（无别名则为其自身） */
export const deployTargets = (name) => DEPLOY_ALIASES[name] || [name]

/** 产物名清单 → 展开别名后的全部云函数名（去重·供 cloudbaserc 完整性守卫比对） */
export const allDeployNames = (names) => [...new Set(names.flatMap((n) => deployTargets(n)))]
