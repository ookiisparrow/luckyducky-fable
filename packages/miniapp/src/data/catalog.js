/**
 * 商品总表（同步身份视图）。canonical 种子在 @luckyducky/shared（单一来源，根因账本 #5），
 * 本文件只把它派生成「按 id 取」的同步视图——首页横滑 / 购物车 / 详情头部按 id 同步取，
 * 改样例商品只改 shared 一处（cloud seedProducts 与本文件同源）。
 *
 * 订单/售后里的商品是「历史快照」（当时买了啥），不从这里取（快照在云端 orders / afterSales）。
 * 「活的」真实商品列表由 store/products.js 从云端拉；本视图是同步身份兜底（样例商品）。
 */
import { SEED_PRODUCTS } from '@luckyducky/shared'

export const CATALOG = Object.fromEntries(SEED_PRODUCTS.map((p) => [p.id, p]))

// 按 id 取单个商品（取不到返回 null）
export const getProduct = (id) => CATALOG[id] || null

// 首页横滑展示的商品（featured）
export const FEATURED_IDS = SEED_PRODUCTS.filter((p) => p.featured).map((p) => p.id)
