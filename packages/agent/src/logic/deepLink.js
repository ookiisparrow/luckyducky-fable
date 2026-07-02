// 会话直达（M⑦ 车道C·推送卡片 `?session=<id>` 点入）纯决策函数（便于单测·根因#8 逻辑与 I/O 分离）。
// 给定目标 sessionId + 当前「我的在接」myActive 和「待接队列」queue（各 SessionView[]），决定动作：
//   - 已在我名下（myActive 命中）→ open（直接打开会话窗口，无需认领）；
//   - 在待接队列（queue 命中·未被我认领）→ claim（先认领再打开）；
//   - 都不在（已被他人接走 / 已结束 / 越权不可见）→ notfound（提示，不硬闯）；
//   - 无目标 → none。
// 纯函数不碰网络：调用方（Desk.vue）拉 listMyActive/listQueue 后喂进来，据 action 决定 open/claim/toast。
export function resolveSessionDeepLink(sessionId, { myActive = [], queue = [] } = {}) {
  if (!sessionId) return { action: 'none' }
  const mine = (myActive || []).find((s) => s && s.sessionId === sessionId)
  if (mine) return { action: 'open', session: mine }
  const inQueue = (queue || []).find((s) => s && s.sessionId === sessionId)
  if (inQueue) return { action: 'claim', sessionId }
  return { action: 'notfound' }
}
