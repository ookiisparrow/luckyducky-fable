// 集合册/错误码册与旧线逐键 parity（数据契约·并存期铁律；M5 清退旧线时本测试随之退役）。
import { describe, it, expect } from 'vitest'
import { COLLECTIONS } from '../src/collections'
import { ERR } from '../src/errors'
import { CHECKOUT_ADDONS, COUPON, SHIP } from '../src/checkout'
import { MAX_PRICE_YUAN, MAX_QTY, MAX_ORDER_LINES, PAY_WINDOW_MS } from '../src/limits'
import { COLLECTIONS as OLD_COLLECTIONS } from '../../../packages/cloud/src/kit/collections'
import { ERR as OLD_ERR } from '../../../packages/shared/src/errors'
import { CHECKOUT_ADDONS as OLD_ADDONS, COUPON as OLD_COUPON, SHIP as OLD_SHIP } from '../../../packages/shared/src/seed/checkout'
import * as OLD_LIMITS from '../../../packages/shared/src/limits'

describe('与旧线契约逐键 parity', () => {
  it('大白话：旧线 37 集合逐键逐值一致；新线只追加的观测集合走显式登记名单，不多不少', () => {
    // 旧集合逐字不动（同一生产库·名字是数据契约）；新线只追加的新集合在此点名登记
    // （collections.ts 头注「新集合先登记并去控制台锁权限再用」，同错误码册的新增机制）——
    // 巡检机 + bug 收集器地基（防治静默 bug）：anomalies（异常账本·指纹去重·仅管理端·recordAnomaly 单口写入）
    // secureConfig（决策 2026-07-12·人工配置清单可填写化）：wxkf/wxpay 敏感凭证入库单源·仅 saveSecureConfig 单口写入
    // orderIdempotency（批E·P1 防网络超时重试双建单）：createOrder 幂等键 claim·见 orders.ts
    const RW_NEW_COLLECTIONS = { anomalies: 'anomalies', inspectRuns: 'inspectRuns', secureConfig: 'secureConfig', orderIdempotency: 'orderIdempotency' }
    expect(COLLECTIONS).toEqual({ ...OLD_COLLECTIONS, ...RW_NEW_COLLECTIONS })
    expect(Object.keys(COLLECTIONS).length).toBe(37 + Object.keys(RW_NEW_COLLECTIONS).length)
  })
  it('大白话：错误码册逐键逐值一致（码是前端分支契约，不可改名）；新线新增码走显式登记名单，不多不少', () => {
    // 旧码逐字不动（前端分支契约）；新线只追加的新码在此点名登记（errors.ts 头注「新增只追加」）——
    // 深审 2026-07-05：COUPON_EXCEEDS_GOODS（占位券白送闸·旧线无此不变量）
    // 跨系统一致性收敛批（客服/ERP 域错误码接入 ERR 字典单源·此前散落字面量、旧线本就没有对应登记）
    // 批E：ORDER_CLAIM_PENDING（幂等键并发窗口内原请求未落定·前端稍候重试）
    const RW_NEW_ERR = {
      COUPON_EXCEEDS_GOODS: 'COUPON_EXCEEDS_GOODS',
      // 客服/坐席域
      NO_AGENT: 'NO_AGENT',
      AT_CAPACITY: 'AT_CAPACITY',
      NOT_CLAIMABLE: 'NOT_CLAIMABLE',
      NOT_ACTIVE: 'NOT_ACTIVE',
      NO_CHANNEL: 'NO_CHANNEL',
      SEND_FAIL: 'SEND_FAIL',
      MSG_NOT_FOUND: 'MSG_NOT_FOUND',
      NOT_IN_SESSION: 'NOT_IN_SESSION',
      NO_MEDIA: 'NO_MEDIA',
      DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
      EXPIRED: 'EXPIRED',
      UPLOAD_FAILED: 'UPLOAD_FAILED',
      URL_FAILED: 'URL_FAILED',
      WRITE_FAIL: 'WRITE_FAIL',
      ALREADY_CLOSED: 'ALREADY_CLOSED',
      NO_BRIDGE: 'NO_BRIDGE',
      NO_CONSENT: 'NO_CONSENT',
      BAD_SCOPE: 'BAD_SCOPE',
      NO_SESSION: 'NO_SESSION',
      NOT_OWNER: 'NOT_OWNER',
      USER_LOOKUP_FAIL: 'USER_LOOKUP_FAIL',
      PANEL_FETCH_FAIL: 'PANEL_FETCH_FAIL',
      FORBIDDEN: 'FORBIDDEN',
      // 进销存 ERP 域
      BAD_SETS: 'BAD_SETS',
      NO_PROFILE: 'NO_PROFILE',
      NO_REASON: 'NO_REASON',
      NO_TEMPLATE: 'NO_TEMPLATE',
      DUPLICATE: 'DUPLICATE',
      PRODUCE_FAIL: 'PRODUCE_FAIL',
      CLAIM_ROLLBACK_FAIL: 'CLAIM_ROLLBACK_FAIL',
      ASSEMBLY_LEDGER_FAIL: 'ASSEMBLY_LEDGER_FAIL',
      BAD_MOVE: 'BAD_MOVE',
      NO_MATERIAL: 'NO_MATERIAL',
      INSUFFICIENT: 'INSUFFICIENT',
      CONTENTION: 'CONTENTION',
      UOM_LOCKED: 'UOM_LOCKED',
      GIVEBACK_LOST: 'GIVEBACK_LOST',
      BAD_UOM: 'BAD_UOM',
      ROLLBACK_FAIL: 'ROLLBACK_FAIL',
      STOCK_APPLY_FAIL: 'STOCK_APPLY_FAIL',
      BAD_COLOR: 'BAD_COLOR',
      BAD_DELTA: 'BAD_DELTA',
      BAD_PRICE: 'BAD_PRICE',
      BAD_RATE: 'BAD_RATE',
      BAD_SLUG: 'BAD_SLUG',
      BAD_SUPPLIER: 'BAD_SUPPLIER',
      BAD_TARGETS: 'BAD_TARGETS',
      BAD_TEMPLATE: 'BAD_TEMPLATE',
      BAD_TYPE: 'BAD_TYPE',
      COLOR_NOT_ISSUED: 'COLOR_NOT_ISSUED',
      DUP_LINE: 'DUP_LINE',
      ISSUE_L_RAW_ONLY: 'ISSUE_L_RAW_ONLY',
      KNOT_ONLY_L: 'KNOT_ONLY_L',
      NOT_DELIVERED: 'NOT_DELIVERED',
      NOT_DRAFT: 'NOT_DRAFT',
      NOT_ISSUED: 'NOT_ISSUED',
      NOT_OUTWORKER: 'NOT_OUTWORKER',
      NO_SUPPLIER: 'NO_SUPPLIER',
      RECEIVE_EXCEEDS_ISSUE: 'RECEIVE_EXCEEDS_ISSUE',
      RECEIVE_L_KNOTTED_ONLY: 'RECEIVE_L_KNOTTED_ONLY',
      // 订单/支付域
      OUT_OF_STOCK: 'OUT_OF_STOCK',
      TOO_MANY_PENDING: 'TOO_MANY_PENDING',
      ORDER_CLAIM_PENDING: 'ORDER_CLAIM_PENDING',
      // 网关兜底（课程链路审计 2026-07-17）：app 网关顶层 catch 收敛未捕获异常统一回此码
      INTERNAL: 'INTERNAL',
    }
    expect(ERR).toEqual({ ...OLD_ERR, ...RW_NEW_ERR })
  })
  it('大白话：结算常量（搭配购/券/运费）与交易边界（价/量/条数/支付窗）逐值一致（钱的口径不漂移）', () => {
    expect(CHECKOUT_ADDONS).toEqual(OLD_ADDONS)
    expect(COUPON).toBe(OLD_COUPON)
    expect(SHIP).toBe(OLD_SHIP)
    expect(MAX_PRICE_YUAN).toBe(OLD_LIMITS.MAX_PRICE_YUAN)
    expect(MAX_QTY).toBe(OLD_LIMITS.MAX_QTY)
    expect(MAX_ORDER_LINES).toBe(OLD_LIMITS.MAX_ORDER_LINES)
    expect(PAY_WINDOW_MS).toBe(OLD_LIMITS.PAY_WINDOW_MS)
  })
})
