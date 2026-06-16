// 生产云环境 id 单源（病根#5「样板复制即漂移」·债#30①脚本侧）：
// deploy-fns 的部署目标 + loadtest/deploy-test 的「拒生产」安全闸 共用同一个生产 env id。
// 散在各脚本各写一份 → 改一处漏一处会致「拒生产」安全闸与部署目标不一致（最坏：往生产打了压测/测试部署）。
// 收口此处一份；守卫 prod-env-single-source 锁「scripts/ 里这个 id 只此处定义」。
// 注：guard-deploy.mjs 的同 id 仅在注释 + 确认消息文案里（非逻辑常量）——故不导入（避动 PreToolUse 钩子 runtime）、守卫豁免它。
export const PROD_ENV = 'cloudbase-d4gcssqbv06865479'
