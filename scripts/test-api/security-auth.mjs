#!/usr/bin/env node
/**
 * 云函数 API 认证与回调安全测试（yaliceshi，非破坏性）
 * 覆盖：
 *   1. 无身份调用受保护接口应全部被拒（NO_OPENID / fail-closed）
 *   2. 伪造支付/退款回调：返回 ACK 但不产生业务影响（不落库、不改状态）
 *
 * 用法：node scripts/test-api/security-auth.mjs
 */
import { authConclusions, callFn, ENV, FUNCS, writeReport } from './lib.mjs';

let passed = 0, failed = 0;
const lines = [];

function record(name, ok, detail) {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${name} ${ok ? '' : '← ' + detail}`);
  ok ? passed++ : failed++;
  lines.push({ name, ok, detail });
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log(' 认证与回调安全测试（yaliceshi·非破坏性）');
  console.log('═══════════════════════════════════════\n');

  // ── 1. 无身份调用受保护接口应拒 ──
  console.log('【1】无身份调用受保护接口（应 NO_OPENID 拒）\n');
  const protectedApi = [
    ['login', {}], ['getMyOrders', {}], ['getMyCourses', {}],
    ['activateCourse', { courseId: 'c1' }], ['submitReview', { productId: 'p1', rating: 5 }],
    ['kfBind', { kfId: 'k1' }], ['dataConsent', {}], ['confirmEnter', {}],
    ['getPlaybackUrl', { courseId: 'c1' }], ['submitCheckpointPhoto', { checkpointId: 'cp1' }],
    ['submitFeedback', { type: 'x', content: 'y' }], ['trackEvent', { type: 'x' }],
  ];
  for (const [action, data] of protectedApi) {
    const r = await callFn(FUNCS.app, action, data);
    const body = r.error || JSON.stringify(r.result).slice(0, 100);
    const rejected = !r.ok || (r.result && (r.result.ok === false || r.result.error));
    record(`app.${action} 无身份应拒`, rejected, body);
  }

  // ── 2. 伪造回调不产生业务影响 ──
  console.log('\n【2】伪造支付/退款回调（应 ACK 但不落库）\n');
  const fakePay = { out_trade_no: `FAKE_${Date.now()}`, trade_state: 'SUCCESS', transaction_id: 'FAKE_TXN', amount: { payer_total: 100 } };
  const r1 = await callFn('payCallback', undefined, fakePay);
  const acked1 = r1.ok && JSON.stringify(r1.result).includes('errcode');
  record('payCallback 伪造回调返回 ACK', acked1, JSON.stringify(r1.result).slice(0, 100));

  const fakeRefund = { out_refund_no: `FAKE_REFUND_${Date.now()}`, refund_status: 'SUCCESS', amount: { refund: 100, total: 100 } };
  const r2 = await callFn('refundCallback', undefined, fakeRefund);
  const acked2 = r2.ok && JSON.stringify(r2.result).includes('errcode');
  record('refundCallback 伪造回调返回 ACK', acked2, JSON.stringify(r2.result).slice(0, 100));

  // 伪造订单未落库验证（需要数据库直查）
  const cloudbase = (await import('@cloudbase/node-sdk')).default;
  const app = cloudbase.init({ env: ENV, secretId: process.env.TCB_SECRETID, secretKey: process.env.TCB_SECRETKEY });
  const db = app.database();
  const fakeOrderId = fakePay.out_trade_no;
  const found = await db.collection('orders').where({ _id: fakeOrderId }).get();
  record(`伪造订单未落库（${fakeOrderId}）`, found.data.length === 0, `查得 ${found.data.length} 条`);

  console.log(`\n════════ 结果：${passed} 通过 / ${failed} 失败 / 共 ${passed + failed} ════════`);

  const report = `# 认证与回调安全测试报告（yaliceshi·非破坏性）

- 时间：${new Date().toLocaleString('zh-CN')}
- 结果：${passed} 通过 / ${failed} 失败

## 1. 无身份调用受保护接口

| 结果 | 接口 | 详情 |
|---|---|---|
${lines.filter((l) => l.name.startsWith('app.')).map((l) => `| ${l.ok ? '✅' : '❌'} | ${l.name} | ${l.detail || '-'} |`).join('\n')}

## 2. 伪造回调

| 结果 | 用例 | 详情 |
|---|---|---|
${lines.filter((l) => !l.name.startsWith('app.')).map((l) => `| ${l.ok ? '✅' : '❌'} | ${l.name} | ${l.detail || '-'} |`).join('\n')}

## 结论

${authConclusions(lines)}
`;
  const out = await writeReport('security-auth', report);
  console.log(`📄 报告已存: ${out}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('执行失败:', e.message); process.exit(1); });
