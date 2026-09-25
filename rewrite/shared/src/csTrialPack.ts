/**
 * 测版配置包 lucky-ducky-2026-09-19 的代码真相。
 * 设计基线：客服系统设计-测版打磨-v0.3.1（§1.4 对标映射不改 T1；§5/§8 刷新核心）。
 * T1 刷新文案。
 * T2 话术/分流 JSON 挂在 kfCallback/cs-pack，由 bundle-cs-pack 打进运行时。
 */

export const CS_REFRESH_PASSPHRASES = ['刷新', '#reset'] as const

export const CS_REFRESH_COPY = {
  confirmPassphrase: '确认当作新客重新开始吗？当前会话进度会清空。',
  confirmButton: '确认重新开始？会话进度会清空，订单真实数据不受影响。',
  done: '已刷新。你现在是测试号·第 {epoch} 次进线。',
  rejectInHuman: '人工处理中，默认不能刷新。如需强制请走管理端并写原因。',
  adminListHint: '测版会话刷新（无刷金）',
  adminReasonPlaceholder: '请填写刷新原因（必填）',
  adminSuccess: '已刷新，epoch 已 +1',
  buttonLabel: '当作新客重新开始',
} as const

export function formatRefreshDone(epoch: number): string {
  return CS_REFRESH_COPY.done.replace('{epoch}', String(epoch))
}
