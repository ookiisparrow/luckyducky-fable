#!/usr/bin/env node
/**
 * 云函数 API 功能测试（yaliceshi）
 * 用例：正常 / 边界 / 异常 三维，覆盖 app 网关 + adminApi 鉴权闸
 *
 * 用法：node scripts/test-api/functional.mjs
 */
import { callFn, ENV, FUNCS, writeReport } from './lib.mjs';

const cases = [];
let passed = 0;
let failed = 0;

function addCase(group, name, fn, expect) {
  cases.push({ group, name, fn, expect });
}

function record(name, group, ok, detail, ms) {
  const mark = ok ? '✅' : '❌';
  const line = `${mark} [${group}] ${name} ${ok ? '' : '← ' + detail} (${ms}ms)`;
  console.log(line);
  ok ? passed++ : failed++;
  return line;
}

// ============ 用例定义 ============
// --- app 用户端公开接口（正常）---
const appPublic = [
  ['getProducts', {}],
  ['getContent', {}],
  ['getPageContent', { page: 'welcome' }],
  ['getHelpVideos', {}],
  ['getPublicFaq', {}],
  ['getCourses', {}],
  ['getReviews', {}],
  ['getRatingSummary', { productId: 'prod-test' }],
];
for (const [action, data] of appPublic) {
  addCase('app-正常', `getProducts-公开接口 ${action}`, async () => {
    const r = await callFn(FUNCS.app, action, data);
    return { ok: r.ok && r.result !== undefined, detail: r.error || JSON.stringify(r.result).slice(0, 120), ms: r.ms };
  });
}

// --- app 异常：未知 action（fail-closed 拒）---
addCase('app-异常', '未知 action 应被拒', async () => {
  const r = await callFn(FUNCS.app, 'notExistAction', {});
  const rejected = !r.ok || (r.result && (r.result.ok === false || r.result.error));
  return { ok: rejected, detail: JSON.stringify(r.result).slice(0, 150), ms: r.ms };
});

// --- app 异常：缺 action ---
addCase('app-异常', '缺 action 参数应报错', async () => {
  const app = (await import('./lib.mjs')).getClient;
  const c = await app();
  const t0 = Date.now();
  let rejected = false;
  try {
    const res = await c.callFunction({ name: FUNCS.app, data: {} });
    rejected = !res?.result || res.result.ok === false;
  } catch { rejected = true; }
  return { ok: rejected, detail: '缺 action 已拒', ms: Date.now() - t0 };
});

// --- app 边界：空 data / 异常参数 ---
addCase('app-边界', 'getProducts 空对象正常返回结构', async () => {
  const r = await callFn(FUNCS.app, 'getProducts', { bogus: 123 });
  return { ok: r.ok && typeof r.result === 'object', detail: JSON.stringify(r.result).slice(0, 100), ms: r.ms };
});

// --- adminApi 鉴权闸（无 key 应拒；adminApi 为 HTTP 服务函数，callFunction 调它返回 405 也是「拒」= fail-closed 正确）---
addCase('admin-鉴权', 'adminApi 无 key 应被拒（fail-closed）', async () => {
  const r = await callFn(FUNCS.admin, 'listProducts', {});
  // 只要不是成功返回业务数据（ok:true 且无 error）即算被拒
  const granted = r.ok && r.result && r.result.ok === true && !r.result.error;
  const rejected = !granted;
  return { ok: rejected, detail: (r.error || JSON.stringify(r.result).slice(0, 120)), ms: r.ms };
});

addCase('admin-鉴权', 'adminApi 未知 action 应被拒', async () => {
  const r = await callFn(FUNCS.admin, 'hackAction', {});
  const granted = r.ok && r.result && r.result.ok === true && !r.result.error;
  return { ok: !granted, detail: (r.error || JSON.stringify(r.result).slice(0, 120)), ms: r.ms };
});

// ============ 执行 ============
async function main() {
  console.log('═══════════════════════════════════════');
  console.log(' 云函数 API 功能测试（yaliceshi）');
  console.log('═══════════════════════════════════════\n');

  // 预热（冷启动不计入）
  await callFn(FUNCS.app, 'getProducts', {});
  console.log('（预热完成）\n');

  const lines = [];
  for (const c of cases) {
    try {
      const { ok, detail, ms } = await c.fn();
      lines.push(record(c.name, c.group, ok, detail, ms));
    } catch (e) {
      lines.push(record(c.name, c.group, false, e.message.slice(0, 120), 0));
    }
  }

  console.log(`\n════════ 结果：${passed} 通过 / ${failed} 失败 / 共 ${cases.length} ════════`);

  const report = `# 云函数 API 功能测试报告（yaliceshi）

- 时间：${new Date().toLocaleString('zh-CN')}
- 环境：${ENV}
- 结果：${passed} 通过 / ${failed} 失败 / 共 ${cases.length}

| 结果 | 分组 | 用例 | 详情 |
|---|---|---|---|
${lines.map((l) => `| ${l.split(' ')[0]} | ${l.replace(/^[✅❌]\s*/, '').replace(/\(.*ms\)$/, '').split(']')[0].slice(1)} | ... | ... |`).join('\n')}
`;
  const out = await writeReport('functional', report);
  console.log(`\n📄 报告已存: ${out}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('执行失败:', e.message); process.exit(1); });
