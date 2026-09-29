// 数据共享授权「登录即默认开启、可随时撤回」（老板 2026-09-30·决策记录 §40）：
// 只在「已同意协议」的登录（agreed:true）且用户从没自己选过时写默认开启；主动撤回/开启过的一律不覆盖；
// 删过资料被重置的（csDataShare.at === deletedAt）重新登录按新用户处理。没勾协议的静默登录永远不写。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>
const me = () => control.dump('users').find((u: any) => u._openid === 'oME')

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('登录默认开启数据共享（§40）', () => {
  it('大白话：没勾协议的静默登录——不写授权', async () => {
    const r = await call('login')
    expect(r.ok).toBe(true)
    expect(me().csDataShare).toBeUndefined()
  })

  it('大白话：勾协议登录的新用户——默认开启，回包里就带着（授权页据此显示已开启）', async () => {
    const r = await call('login', { agreed: true })
    expect(me().csDataShare).toMatchObject({ agreed: true, via: 'login' })
    expect(r.user.csDataShare).toMatchObject({ agreed: true, via: 'login' })
  })

  it('大白话：自己撤回过——再登录也保持撤回，不被默认值覆盖', async () => {
    await call('login', { agreed: true })
    await call('dataConsent', { agree: false })
    const r = await call('login', { agreed: true })
    expect(me().csDataShare.agreed).toBe(false)
    expect(r.user.csDataShare.agreed).toBe(false)
  })

  it('大白话：自己开启过——保持原样，不重写时间', async () => {
    await call('login')
    await call('dataConsent', { agree: true })
    const at = me().csDataShare.at
    await call('login', { agreed: true })
    expect(me().csDataShare).toMatchObject({ agreed: true, at })
    expect(me().csDataShare.via).toBeUndefined()
  })

  it('大白话：删过资料（授权被重置）再勾协议登录——按新用户重新默认开启', async () => {
    await call('login', { agreed: true })
    await call('deleteAccount')
    expect(me().csDataShare.agreed).toBe(false)
    await call('login', { agreed: true })
    expect(me().csDataShare).toMatchObject({ agreed: true, via: 'login' })
  })
})
