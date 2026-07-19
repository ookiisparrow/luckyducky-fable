import { ERR } from '@ldrw/shared'
import { isServerCall, ok, err, runInspection, sendDailyHeartbeat } from '../../kit'

// 巡检机定时入口（不依赖 AI·守卫 rw-inspect-golden）：定时触发器按期跑一轮体检
// （A 基建存活 + B 业务不变量），红项落 bug 账本 + 高危告警。手动触发走 adminApi.inspect.runNow（批3）。
// 服务端专用（同 kfHealthProbe）：客户端调用拒——防刷造巡检史/告警。
export const main = async () => {
  if (!isServerCall()) return err(ERR.SERVER_ONLY)
  const run = await runInspection('timer')
  // A5 每日心跳（去重·全绿也报平安）：仅定时线发（手动 adminApi.runInspect 不发心跳）·fail-soft 内部吞错。
  await sendDailyHeartbeat({ green: run.summary.green, red: run.summary.red })
  return ok({ summary: run.summary, red: run.results.filter((r) => r.status === 'red').map((r) => r.id) })
}
