#!/usr/bin/env node
/**
 * 云函数 API 功能测试（yaliceshi）
 * 用例：正常 / 边界 / 异常 三维，只覆盖 app 网关。
 * 后台鉴权不在这里测：管理接口只收 HTTP POST，云函数直调在验口令前就被挡住，
 * 不能把这次拒绝当成鉴权通过。测试云没有单独的后台 HTTP 地址，也不打生产地址。
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

function cell(value) {
  return String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 180);
}

function record(name, group, ok, detail, ms) {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} [${group}] ${name} ${ok ? '' : '← ' + detail} (${ms}ms)`);
  ok ? passed++ : failed++;
  return { name, group, ok, detail, ms };
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
  addCase('app-正常', `${action} 公开接口`, async () => {
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

// ============ 执行 ============
async function main() {
  console.log('═══════════════════════════════════════');
  console.log(' 云函数 API 功能测试（yaliceshi）');
  console.log('═══════════════════════════════════════\n');

  // 预热（冷启动不计入）
  await callFn(FUNCS.app, 'getProducts', {});
  console.log('（预热完成）\n');

  const rows = [];
  for (const c of cases) {
    try {
      const { ok, detail, ms } = await c.fn();
      rows.push(record(c.name, c.group, ok, detail, ms));
    } catch (e) {
      rows.push(record(c.name, c.group, false, e.message.slice(0, 120), 0));
    }
  }

  console.log(`\n════════ 结果：${passed} 通过 / ${failed} 失败 / 共 ${cases.length} ════════`);

  const report = `# 云函数 API 功能测试报告（yaliceshi）

- 时间：${new Date().toLocaleString('zh-CN')}
- 环境：${ENV}
- 结果：${passed} 通过 / ${failed} 失败 / 共 ${cases.length}

| 结果 | 分组 | 用例 | 详情 |
|---|---|---|---|
${rows.map((r) => `| ${r.ok ? '✅' : '❌'} | ${cell(r.group)} | ${cell(r.name)} | ${cell(r.detail)} |`).join('\n')}
`;
  const out = await writeReport('functional', report);
  console.log(`\n📄 报告已存: ${out}`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('执行失败:', e.message); process.exit(1); });
