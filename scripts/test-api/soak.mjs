#!/usr/bin/env node
/**
 * 云函数 API 恒测（soak test，yaliceshi）
 * 10 并发持续 2 小时，每分钟采样：响应时间（avg/p50/p95/p99）+ 错误率
 * 目标：P95 波动 < 20%、无持续错误、无性能退化
 *
 * 用法：node scripts/test-api/soak.mjs [分钟数]
 * 输出：reports/test-api-soak.csv（每分钟一行）
 */
import { callFn, FUNCS, stats } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINUTES = Number(process.argv[2]) || 120;
const CONCURRENCY = 10;
const TARGET = { action: 'getProducts', name: FUNCS.app };

async function sampleOneMinute() {
  const latencies = [];
  let errors = 0;
  const deadline = Date.now() + 60000;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        const r = await callFn(TARGET.name, TARGET.action, {});
        if (r.ok) latencies.push(r.ms);
        else errors++;
      }
    })
  );
  const s = stats(latencies);
  return { ...s, errors, errRate: ((errors / (latencies.length + errors)) * 100).toFixed(2) };
}

async function main() {
  const outCsv = path.resolve(__dirname, '../../reports/test-api-soak.csv');
  fs.mkdirSync(path.dirname(outCsv), { recursive: true });
  fs.writeFileSync(outCsv, 'minute,total,avg,p50,p95,p99,max,errors,errRate\n');
  console.log(`恒测启动：${CONCURRENCY} 并发 × ${MINUTES} 分钟（对象 ${TARGET.name}.${TARGET.action}）`);
  console.log(`输出: ${outCsv}\n`);

  const rows = [];
  for (let m = 1; m <= MINUTES; m++) {
    const s = await sampleOneMinute();
    const line = `${m},${s.n},${s.avg},${s.p50},${s.p95},${s.p99},${s.max},${s.errors},${s.errRate}`;
    fs.appendFileSync(outCsv, line + '\n');
    rows.push(s);
    const mark = parseFloat(s.errRate) > 1 ? '⚠️' : '✅';
    console.log(`[${m}/${MINUTES}] n=${s.n} avg=${s.avg}ms p95=${s.p95}ms p99=${s.p99}ms 错误率=${s.errRate}% ${mark}`);
  }

  // 汇总：首 5 分钟 vs 末 5 分钟对比（退化检测）
  const head = rows.slice(0, Math.min(5, rows.length));
  const tail = rows.slice(-5);
  const avg = (arr, k) => Math.round(arr.reduce((a, r) => a + r[k], 0) / arr.length);
  console.log('\n════════ 恒测汇总 ════════');
  console.log(`开始 5 分钟: p95=${avg(head, 'p95')}ms 错误率=${avg(head, 'errRate')}%`);
  console.log(`结束 5 分钟: p95=${avg(tail, 'p95')}ms 错误率=${avg(tail, 'errRate')}%`);
  const drift = Math.abs(avg(head, 'p95') - avg(tail, 'p95')) / Math.max(1, avg(head, 'p95'));
  const over = !(drift < 0.2);
  console.log(`P95 漂移: ${(drift * 100).toFixed(1)}% ${over ? '⚠️ 超限' : '✅ 达标(<20%)'}`);
  if (over) process.exit(1);
}

main().catch((e) => { console.error('恒测失败:', e.message); process.exit(1); });
