#!/usr/bin/env node
/**
 * 云函数 API 测试公共库（yaliceshi 环境）
 * 用法：被 functional/concurrent/soak/security 脚本 import
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ENV = process.env.TEST_ENV || 'yaliceshi-d3get0o7ja6c91f8f';
export const FUNCS = {
  app: 'app',           // 用户端网关
  admin: 'adminApi',    // 管理后台 API（测试环境旧名）
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

// ---------- 报告 ----------
export async function writeReport(name, content) {
  const fs = await import('node:fs');
  const out = path.resolve(__dirname, `../../reports/test-api-${name}.md`);
  fs.writeFileSync(out, content);
  return out;
}
