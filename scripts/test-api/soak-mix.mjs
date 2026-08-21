#!/usr/bin/env node
/**
 * 云函数 API 混合场景恒测（soak-mix，yaliceshi）
 * 多接口按权重混合持续打，模拟真实用户行为（读为主 + 少量无登录写尝试）
 *
 * 接口池（按权重）：
 *   getProducts 25% · getCourses 20% · getContent 15% · getPageContent 15%
 *   getPublicFaq 10% · getRatingSummary 10% · submitFeedback 2.5% · trackEvent 2.5%
 *
 * 用法：node scripts/test-api/soak-mix.mjs [分钟数]
 * 输出：reports/test-api-soak-mix.csv（每分钟一行）+ 分接口汇总
 */
import { callFn, FUNCS, stats, writeReport } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MINUTES = Number(process.argv[2]) || 30;
const CONCURRENCY = 10;

// 混合池：weight 权重 / buildData 生成参数
const POOL = [
  { action: 'getProducts', weight: 25, buildData: () => ({}) },
  { action: 'getCourses', weight: 20, buildData: () => ({}) },
  { action: 'getContent', weight: 15, buildData: () => ({}) },
  { action: 'getPageContent', weight: 15, buildData: () => ({ page: ['welcome', 'about', 'agreement'][Math.floor(Math.random() * 3)] }) },
  { action: 'getPublicFaq', weight: 10, buildData: () => ({}) },
  { action: 'getRatingSummary', weight: 10, buildData: () => ({ productId: `prod-${Math.floor(Math.random() * 5) + 1}` }) },
  { action: 'submitFeedback', weight: 2.5, buildData: () => ({ type: 'suggestion', content: '__soakmix__ 无登录写尝试' }) },
  { action: 'trackEvent', weight: 2.5, buildData: () => ({ type: 'soak_mix', page: 'home', meta: { t: Date.now() } }) },
];

// 按权重构建选择数组
const WHEEL = [];
POOL.forEach((p, i) => { for (let k = 0; k < p.weight; k++) WHEEL.push(i); });

function pick() {
  const idx = WHEEL[Math.floor(Math.random() * WHEEL.length)];
  const p = POOL[idx];
  return { action: p.action, data: p.buildData() };
}

async function sampleOneMinute() {
  const byAction = {}; // action -> latencies[]
  let errors = 0;
  const deadline = Date.now() + 60000;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        const { action, data } = pick();
        const r = await callFn(FUNCS.app, action, data);
        if (r.ok) {
          (byAction[action] = byAction[action] || []).push(r.ms);
        } else {
          errors++;
        }
      }
    })
  );
  return { byAction, errors };
}

async function main() {
  const outCsv = path.resolve(__dirname, '../../reports/test-api-soak-mix.csv');
  fs.mkdirSync(path.dirname(outCsv), { recursive: true });
  fs.writeFileSync(outCsv, 'minute,total,avg,p50,p95,p99,max,errors,errRate\n');
  console.log(`混合恒测启动：${CONCURRENCY} 并发 × ${MINUTES} 分钟`);
  console.log(`接口池: ${POOL.map((p) => `${p.action}(${p.weight}%)`).join(' ')}\n`);

  const overall = []; // 每分钟 p95
  const actionAgg = {}; // action -> all latencies
  let errMinutes = 0;

  for (let m = 1; m <= MINUTES; m++) {
    const { byAction, errors } = await sampleOneMinute();
    // 合并本分钟延迟
    const all = Object.values(byAction).flat();
    const s = stats(all);
    const errRate = ((errors / (all.length + errors)) * 100).toFixed(2);
    if (errors > 0) errMinutes++;
    overall.push(s.p95);
    for (const [a, lats] of Object.entries(byAction)) {
      (actionAgg[a] = actionAgg[a] || []).push(...lats);
    }
    const line = `${m},${all.length},${s.avg},${s.p50},${s.p95},${s.p99},${s.max},${errors},${errRate}`;
    fs.appendFileSync(outCsv, line + '\n');
    const mark = errors > 0 ? '⚠️' : '✅';
    console.log(`[${m}/${MINUTES}] n=${all.length} avg=${s.avg}ms p95=${s.p95}ms p99=${s.p99}ms 错误=${errors} ${mark}`);
  }

  // 汇总
  console.log('\n════════ 分接口统计 ════════');
  console.log('接口 | 请求数 | avg | p95 | 占比');
  const totalAll = Object.values(actionAgg).flat().length;
  for (const [a, lats] of Object.entries(actionAgg)) {
    const s = stats(lats);
    console.log(`${a.padEnd(18)} | ${String(lats.length).padStart(6)} | ${String(s.avg).padStart(4)}ms | ${String(s.p95).padStart(4)}ms | ${(lats.length / totalAll * 100).toFixed(1)}%`);
  }

  const head = overall.slice(0, Math.min(5, overall.length));
  const tail = overall.slice(-5);
  const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  const drift = Math.abs(avg(head) - avg(tail)) / Math.max(1, avg(head));
  console.log(`\nP95 漂移: ${(drift * 100).toFixed(1)}%（开始 ${avg(head)}ms → 结束 ${avg(tail)}ms）${drift < 0.2 ? '✅ 达标' : '⚠️ 超限'}`);
  console.log(`错误分钟数: ${errMinutes}/${MINUTES}`);

  const report = `# 云函数 API 混合场景恒测报告（yaliceshi）

- 时间：${new Date().toLocaleString('zh-CN')}
- 并发：${CONCURRENCY} · 时长：${MINUTES} 分钟
- 接口池：${POOL.map((p) => `${p.action} ${p.weight}%`).join('、')}

## 分接口统计

| 接口 | 请求数 | avg | p95 | 占比 |
|---|---|---|---|---|
${Object.entries(actionAgg).map(([a, l]) => { const s = stats(l); return `| ${a} | ${l.length} | ${s.avg}ms | ${s.p95}ms | ${(l.length / totalAll * 100).toFixed(1)}% |`; }).join('\n')}

## 总体

- P95 漂移：${(drift * 100).toFixed(1)}%（开始 ${avg(head)}ms → 结束 ${avg(tail)}ms）${drift < 0.2 ? '✅ 达标(<20%)' : '⚠️ 超限'}
- 错误分钟数：${errMinutes}/${MINUTES}
- 写操作（submitFeedback/trackEvent）因 node-sdk 无 openid 被拒属预期（模拟无登录用户行为），不计为故障
`;
  const out = await writeReport('soak-mix', report);
  console.log(`\n📄 报告已存: ${out}`);
}

main().catch((e) => { console.error('混合恒测失败:', e.message); process.exit(1); });
