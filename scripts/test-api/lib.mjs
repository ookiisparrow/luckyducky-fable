#!/usr/bin/env node
/**
 * 云函数 API 测试公共库（目录 test 行）
 * 用法：被 functional/concurrent/soak/security 脚本 import
 * 选环境：LD_TARGET=test（缺省按目录 test；生产/未知 id 拒）
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertMay, parseTargetFromArgv, resolveWriteTestTarget } from '../lib/env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const _target = resolveWriteTestTarget(parseTargetFromArgv() || 'test');
assertMay(_target, 'test-api');
export const ENV = _target.envId;
export const FUNCS = {
  app: 'app',           // 用户端网关
  inspect: 'inspect',   // 健康巡检
};

// ---------- callFunction 封装 ----------
let _app = null;
export async function getClient() {
  if (_app) return _app;
  const cloudbase = (await import('@cloudbase/node-sdk')).default;
  if (!process.env.TCB_SECRETID || !process.env.TCB_SECRETKEY) {
    throw new Error('缺 TCB_SECRETID/TCB_SECRETKEY（先 export，见 ~/.zshrc）');
  }
  _app = cloudbase.init({
    env: ENV,
    secretId: process.env.TCB_SECRETID,
    secretKey: process.env.TCB_SECRETKEY,
  });
  return _app;
}

/**
 * 调云函数（模拟小程序 wx.cloud.callFunction）
 * @returns {Promise<{ok:boolean, result:any, ms:number, error?:string}>}
 */
export async function callFn(name, action, data = {}) {
  const app = await getClient();
  const t0 = Date.now();
  try {
    const res = await app.callFunction({ name, data: { action, data } });
    const r = res?.result;
    return {
      ok: true,
      result: r,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      error: (e?.message || String(e)).slice(0, 300),
      ms: Date.now() - t0,
    };
  }
}

// ---------- 指标统计 ----------
export function stats(latencies) {
  if (!latencies.length) return { n: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  const p = (q) => sorted[Math.min(n - 1, Math.floor(q * n))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n,
    avg: Math.round(sum / n),
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

export function fmtStats(s) {
  if (!s.n) return '无样本';
  return `n=${s.n} avg=${s.avg}ms p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms min=${s.min} max=${s.max}`;
}

/**
 * 用户网关的「被拒绝」判定。
 * adminApi 经 callFunction 直调时，平台在看口令之前就回 HTTP 405（只要 POST）。
 * 那种结果不算鉴权拒绝——否则安全探针会把「还没验身份」记成「鉴权有效」。
 * 只有明确的 401/403，或网关自己的业务拒绝，才算拒绝。
 */
export function isGatewayRejected(r) {
  const result = r && r.result;
  const status = result && result.statusCode != null ? Number(result.statusCode) : NaN;
  if (status === 405) return false;
  let bodyErr = '';
  if (result && typeof result.body === 'string') {
    try { bodyErr = JSON.parse(result.body).error || ''; } catch { bodyErr = ''; }
  }
  if (bodyErr === 'POST_ONLY' || (result && result.error === 'POST_ONLY')) return false;
  if (status === 401 || status === 403) return true;
  if (!r || r.ok === false) return true;
  if (!result) return true;
  return result.ok === false || Boolean(result.error) || Boolean(result.code);
}

/** 并发报告的结论只复述本轮各档数字。没有样本就不宣称达标。 */
export function concurrentConclusions(rows) {
  if (!rows || !rows.length) return '- 本轮没有并发数据，不下性能结论。';
  return rows.map((r) => {
    const n = r.s && r.s.n;
    const p95 = n ? `${r.s.p95}ms` : '无成功样本';
    const err = Number(r.errRate);
    const sample = String(r.errorSample || '').replace(/\s+/g, ' ').slice(0, 80);
    const limited = /RATELIMIT|限流|429/.test(sample);
    let judge;
    if (!n) judge = '没有成功响应，这档不能算达标。';
    else if (r.s.p95 < 500 && err < 1) judge = '这一档 P95 低于 500ms，错误率低于 1%。';
    else if (limited) judge = '这一档的错误样本像限流。';
    else judge = '这一档没有同时满足 P95 低于 500ms、错误率低于 1%。';
    const extra = sample ? ` 错误样本：${sample}。` : '';
    return `- 并发 ${r.concurrency}：P95=${p95}，TPS=${r.tps}，错误率 ${r.errRate}%（${r.errors} 次）。${judge}${extra}`;
  }).join('\n');
}

/** 认证报告收尾只根据本轮每一条的成败来写。失败时不宣称防护成立。 */
export function authConclusions(lines) {
  const list = lines || [];
  const identity = list.filter((l) => String(l.name || '').startsWith('app.'));
  const forged = list.filter((l) => !String(l.name || '').startsWith('app.'));
  const parts = [];
  if (!identity.length) parts.push('- 本轮没有无身份调用，不能说受保护接口被挡住了。');
  else {
    const bad = identity.filter((l) => !l.ok);
    if (!bad.length) parts.push(`- 无身份调用 ${identity.length} 个受保护接口，这一轮全部被拒。`);
    else parts.push(`- 无身份调用有 ${bad.length} 个没有被拒（${bad.map((l) => l.name).join('、')}）。这一轮不能说身份防护成立。`);
  }
  if (!forged.length) parts.push('- 本轮没有伪造回调检查，不能说回调防伪成立。');
  else {
    const bad = forged.filter((l) => !l.ok);
    if (!bad.length) parts.push(`- 伪造回调相关 ${forged.length} 项检查，这一轮都通过。`);
    else parts.push(`- 伪造回调有 ${bad.length} 项没通过（${bad.map((l) => l.name).join('、')}）。这一轮不能说回调防伪成立。`);
  }
  return parts.join('\n');
}

// ---------- 报告 ----------
export async function writeReport(name, content) {
  const fs = await import('node:fs');
  const out = path.resolve(__dirname, `../../reports/test-api-${name}.md`);
  fs.writeFileSync(out, content);
  return out;
}
