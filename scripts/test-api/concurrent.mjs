#!/usr/bin/env node
/**
 * 云函数 API 高并发测试（yaliceshi）
 * 并发梯度：10 / 50 / 100 / 200，每档持续 duration 秒
 * 指标：TPS、P50/P95/P99、错误率、限流行为
 *
 * 用法：node scripts/test-api/concurrent.mjs [每档秒数]
 */
import { callFn, FUNCS, stats, fmtStats, writeReport, concurrentConclusions } from './lib.mjs';

const DURATION = Number(process.argv[2]) || 30; // 每档秒数
const GRADIENTS = [10, 50, 100, 200];
const TARGET = { action: 'getProducts', name: FUNCS.app }; // 用户端公开读接口

async function runGradient(concurrency, seconds) {
  const latencies = [];
  const errors = [];
  const t0 = Date.now();
  const deadline = t0 + seconds * 1000;

  await new Promise((resolve) => {
    const workers = Array.from({ length: concurrency }, async () => {
      while (Date.now() < deadline) {
        const r = await callFn(TARGET.name, TARGET.action, {});
        if (r.ok) latencies.push(r.ms);
        else errors.push(r.error);
      }
    });
    Promise.all(workers).then(resolve);
  });

  const elapsed = (Date.now() - t0) / 1000;
  const s = stats(latencies);
  const total = latencies.length + errors.length;
  const tps = total ? Math.round(latencies.length / elapsed) : 0;
  const errRate = (total ? (errors.length / total) * 100 : 0).toFixed(2);
  const errorSample = errors[0] ? String(errors[0]).slice(0, 120) : '';
  return { concurrency, s, tps, errRate, errors: errors.length, errorSample, elapsed: Math.round(elapsed) };
}

function msOf(s, key) {
  return s && s.n ? `${s[key]}ms` : '-';
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log(` 云函数 API 高并发测试（yaliceshi）`);
  console.log(` 对象: ${TARGET.name}.${TARGET.action} · 每档 ${DURATION}s`);
  console.log('═══════════════════════════════════════\n');

  console.log('（预热 3s…）');
  await callFn(TARGET.name, TARGET.action, {});
  await new Promise((r) => setTimeout(r, 2000));

  const rows = [];
  for (const c of GRADIENTS) {
    console.log(`\n🚀 并发 ${c}（${DURATION}s）...`);
    const row = await runGradient(c, DURATION);
    console.log(`   ${fmtStats(row.s)} · TPS=${row.tps} · 错误率=${row.errRate}% (${row.errors})`);
    rows.push(row);
  }

  // 汇总表
  console.log('\n════════ 汇总 ════════');
  console.log('并发 | TPS | P50 | P95 | P99 | 错误率');
  for (const r of rows) {
    console.log(`${String(r.concurrency).padEnd(4)} | ${String(r.tps).padEnd(5)} | ${msOf(r.s, 'p50')} | ${msOf(r.s, 'p95')} | ${msOf(r.s, 'p99')} | ${r.errRate}%`);
  }

  // 判定只看本轮：P95<500ms 且错误率<1% 才打勾
  const report = `# 云函数 API 高并发测试报告（yaliceshi）

- 时间：${new Date().toLocaleString('zh-CN')}
- 对象：${TARGET.name}.${TARGET.action}（用户端公开读接口）
- 每档时长：${DURATION}s
- 目标：P95 < 500ms · 错误率 < 1%

## 结果

| 并发 | TPS | P50 | P95 | P99 | Min | Max | 错误率 | 判定 |
|---|---|---|---|---|---|---|---|---|
${rows.map((r) => {
  const err = Number(r.errRate);
  const ok = r.s.n && r.s.p95 < 500 && err < 1;
  return `| ${r.concurrency} | ${r.tps} | ${msOf(r.s, 'p50')} | ${msOf(r.s, 'p95')} | ${msOf(r.s, 'p99')} | ${msOf(r.s, 'min')} | ${msOf(r.s, 'max')} | ${r.errRate}% | ${ok ? '✅' : '⚠️'} |`;
}).join('\n')}

## 关键结论

${concurrentConclusions(rows)}

## 说明
- 云函数 Serverless 冷启动不纳入（已预热）
- 上面的句子只复述本轮各档的 P95、TPS 和错误样本
`;
  const out = await writeReport('concurrent', report);
  console.log(`\n📄 报告已存: ${out}`);
}

main().catch((e) => { console.error('执行失败:', e.message); process.exit(1); });
