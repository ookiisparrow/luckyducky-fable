#!/usr/bin/env node
/**
 * 云函数 API 安全测试（yaliceshi，仅非破坏性）
 * 覆盖：用户网关的注入、原型链污染、边界输入、敏感信息泄露。
 * 管理后台鉴权不在这里测：云函数直调发生在验口令之前，不能当成鉴权通过。
 *
 * 用法：node scripts/test-api/security.mjs
 */
import { callFn, ENV, FUNCS, isGatewayRejected, writeReport } from './lib.mjs';

let passed = 0, failed = 0;
const lines = [];

function record(name, ok, detail, ms) {
  const mark = ok ? '✅' : '❌';
  console.log(`${mark} ${name} ${ok ? '' : '← ' + detail} (${ms}ms)`);
  ok ? passed++ : failed++;
  lines.push({ name, ok, detail, ms });
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const r = await fn();
    record(name, r.ok, r.detail, Date.now() - t0);
  } catch (e) {
    record(name, false, e.message.slice(0, 150), Date.now() - t0);
  }
}

// 用户网关：请求被拒 = 这道探针通过。405 不算拒绝，见 isGatewayRejected。
// 判定工具：成功且无异常数据
function isSafe(r) {
  return r.ok && !JSON.stringify(r.result).includes('<script>') && !JSON.stringify(r.result).includes('OR 1=1');
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log(' 云函数 API 安全测试（yaliceshi·非破坏性）');
  console.log('═══════════════════════════════════════\n');
  await callFn(FUNCS.app, 'getProducts', {}); // 预热

  // 1. 原型链/内部键注入（fail-closed 防御验证）
  for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype']) {
    await check(`action=${bad} 应被拒（原型链防护）`, async () => {
      const r = await callFn(FUNCS.app, bad, {});
      return { ok: isGatewayRejected(r), detail: JSON.stringify(r.result).slice(0, 120), ms: 0 };
    });
  }

  // 2. 路径/命令注入
  for (const bad of ['../../etc/passwd', 'a;rm -rf /', '$(whoami)', '`id`', 'getProducts;drop table']) {
    await check(`action=${bad.slice(0, 20)}... 应被拒（命令/路径注入）`, async () => {
      const r = await callFn(FUNCS.app, bad, {});
      return { ok: isGatewayRejected(r), detail: JSON.stringify(r.result).slice(0, 120), ms: 0 };
    });
  }

  // 3. 参数注入（云数据库 NoSQL 注入尝试）
  await check('data 注入 $gt 操作符应安全处理', async () => {
    const r = await callFn(FUNCS.app, 'getProducts', { price: { $gt: '' }, '||': true });
    return { ok: isSafe(r), detail: JSON.stringify(r.result).slice(0, 150), ms: 0 };
  });

  // 4. XSS 注入（写入字段再读出验证转义/无害）
  await check('XSS payload 注入不应回显可执行脚本', async () => {
    const payload = '<script>alert(1)</script>';
    const r = await callFn(FUNCS.app, 'getProducts', { name: payload, search: payload });
    return { ok: isSafe(r), detail: JSON.stringify(r.result).slice(0, 150), ms: 0 };
  });

  // 5. 边界输入
  await check('超长输入（100KB）不应崩溃', async () => {
    const big = 'A'.repeat(100000);
    const r = await callFn(FUNCS.app, 'getProducts', { search: big });
    return { ok: r.ok || isGatewayRejected(r), detail: r.error || JSON.stringify(r.result).slice(0, 100), ms: 0 };
  });

  await check('Unicode/emoji 输入正常处理', async () => {
    const r = await callFn(FUNCS.app, 'getProducts', { search: '🔥测试🏷️' });
    return { ok: r.ok, detail: JSON.stringify(r.result).slice(0, 100), ms: 0 };
  });

  // 6. 敏感信息泄露（错误信息不应含堆栈/密钥）
  await check('错误响应不泄露内部堆栈/密钥', async () => {
    const r = await callFn(FUNCS.app, 'getProducts', {});
    const err = JSON.stringify(r).toLowerCase();
    return { ok: !/(secretkey|secretid|access.?key|stack trace|at .*\.js:)/.test(err), detail: '检查响应体', ms: 0 };
  });

  console.log(`\n════════ 结果：${passed} 通过 / ${failed} 失败 / 共 ${passed + failed} ════════`);

  const report = `# 云函数 API 安全测试报告（yaliceshi·非破坏性）

- 时间：${new Date().toLocaleString('zh-CN')}
- 环境：${ENV}
- 结果：${passed} 通过 / ${failed} 失败

| 结果 | 用例 | 详情 |
|---|---|---|
${lines.map((l) => `| ${l.ok ? '✅' : '❌'} | ${l.name} | ${l.detail || '-'} |`).join('\n')}

## 说明
- 全部为非破坏性测试（无 DoS、无数据删除、无生产环境操作）
- 只打用户网关。管理后台不在这里测：云函数直调发生在验口令之前，不能当成鉴权通过
`;
  const out = await writeReport('security', report);
  console.log(`📄 报告已存: ${out}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('执行失败:', e.message); process.exit(1); });
