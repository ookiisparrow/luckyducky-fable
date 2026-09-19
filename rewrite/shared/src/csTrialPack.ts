/**
 * 测版配置包 lucky-ducky-2026-09-19 的代码真相。
 * 设计基线：客服系统设计-测版打磨-v0.3.1（§1.4 对标映射不改 T1；§5/§8 刷新核心）。
 * T1 刷新文案/重置清单 + 自修开关（供 T3/T4 读）。禁 auto_apply=true。
 * T2 话术/分流 JSON 挂在 kfCallback/cs-pack，由 bundle-cs-pack 打进运行时。
 */

export const CS_PACK_ID = 'lucky-ducky-2026-09-19'
export const CS_DESIGN_BASELINE = 'v0.3.1'

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

export const CS_REFRESH_RESET = {
  reset: [
    'session_rebuild',
    'session_epoch_increment',
    'state_to_new_then_greet',
    'jev_context_clear',
    'emotion_strategy_slots_clear',
    'session_order_logical_binding_clear',
    'script_progress_clear',
    'agent_unsubmitted_draft_clear',
    'consecutive_unknown_clear',
    'collect_rounds_clear',
  ],
  doNotReset: [
    'openid',
    'real_orders',
    'payments',
    'inventory',
    'audit_logs',
    'global_config',
    'production_user_data',
  ],
} as const

export const CS_SELF_HEAL = {
  version: '1.0',
  customerFacing: false,
  envPolicy: {
    test: { inspect: true, human_apply: true },
    staging: { inspect: 'readonly_optional' as const, human_apply: false },
    production: { inspect: 'readonly_or_off' as const, human_apply: false },
  },
  severity: {
    P0: { alert: true, ticket: true, one_click_apply: false, auto_apply: false },
    P1: { propose_required: true, auto_apply: false, human_click_apply_required: true },
    P2: { propose: true, auto_apply: false, human_click_apply_required: true },
    P3: { suggest_only: true, auto_apply: false },
  },
} as const
