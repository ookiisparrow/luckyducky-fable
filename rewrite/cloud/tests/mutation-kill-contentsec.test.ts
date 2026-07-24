// 变异测试幸存者击杀：kit/contentsec（内容安全审核接缝·守卫 ugc-imgsecchecked 的执行体·根因#3 fail-closed）。
// StrykerJS 该文件 57 个变异体幸存/无覆盖（变异分 46.7%）——本文件把「桩可测」的 A 类全部钉死：
//   ① imgSecCheck 空 fileId 前置拒（NO_FILE·一次都不出站）；② 成功路径出站参数完整形状
//      （media.contentType/value——参数残缺=审核形同虚设）；③ 取不到图内容 fail-closed 拒且不打审核；
//   ④ errCode 87014（RISKY）→ IMG_RISKY、非 0 非违规码 → 保守拒、小写 errcode 同认（?? 双壳）；
//   ⑤ 抛错路径带码/不带码全部收敛 { ok:false }，绝不上抛（UGC 越权写面·「证明安全」才放行）；
//   ⑥ msgSecCheck 空串/纯空白/非 string 直接过且不外呼（省无谓计费调用）、trim 后才送审、
//      v2 请求形状（openid+content+version:2+scene）、errCode 非 0 / suggest==='risky' 拒、异常拒。
// 期望值全部来自 contentsec.ts 内注释（fail-CLOSED、87014=违规、空文本无需检测、v2 scene 规范），不发明行为。
// 等价幸存（C 类·本文件不追杀）：L31 `dl && dl.fileList && …` → `true && dl.fileList[0]`——dl falsy 时
// 变异体抛 TypeError 被 catch 收成 SEC_CHECK_FAIL，与原码 !buf 分支产出完全同形，外部不可分辨。
import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { imgSecCheck, msgSecCheck, SCENE_PROFILE, SCENE_COMMENT } from '../src/kit/contentsec'

beforeEach(() => control.reset())

// 桩里 downloadFile 固定回的图字节（openapiCalls 走 JSON 往返，Buffer 会序列化成 {type:'Buffer',data:[…]}）
const MOCK_IMG_JSON = JSON.parse(JSON.stringify(Buffer.from('mock-image-bytes')))

describe('imgSecCheck（UGC 图片审核·fail-closed）', () => {
  it('大白话：空 fileId 直接拒（NO_FILE），下载/审核一次都不出站', async () => {
    const r = await imgSecCheck('')
    expect(r).toEqual({ ok: false, error: 'NO_FILE' }) // 前置守门·ok 必 false、错误码必留原样
    expect(control.openapiCalls().length).toBe(0) // 守门失效（if(false) 变异）会打到审核 → 必红
  })

  it('大白话：好图放行 { ok:true }，且送审参数形状完整——contentType 是 image/png、value 是真图字节', async () => {
    const r = await imgSecCheck('cloud://test/ugc/photo-1.png')
    expect(r).toEqual({ ok: true }) // 成功=纯 ok:true·无 error 字段
    const calls = control.openapiCalls()
    expect(calls.length).toBe(1)
    // media 缺件/contentType 被清空/value 不是图字节（如整个文件对象、true）＝审核请求失真必红
    expect(calls[0]).toEqual({ media: { contentType: 'image/png', value: MOCK_IMG_JSON } })
  })

  it('大白话：下载回来没有图内容 → fail-closed 拒（SEC_CHECK_FAIL），不拿空参数去打审核', async () => {
    // 桩的 downloadFile 固定回 buffer，盖不到「取不到图」分支——临时换掉 downloadFile 节点
    // （同一 CJS 模块实例，源码与测试共享），用完还原，不动桩本体（同 mutation-kill-shipping 范式）。
    const cloudAny = cloud as any
    const realDownload = cloudAny.downloadFile
    try {
      cloudAny.downloadFile = async () => ({ fileList: [{ fileID: 'x' }] }) // 有条目、无 fileContent
      expect(await imgSecCheck('cloud://x')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
      expect(control.openapiCalls().length).toBe(0) // !buf 守门被拆（if(false)）会继续出站 → 必红

      cloudAny.downloadFile = async () => undefined // 下载整体没回包（dl falsy）→ 同款 fail-closed
      expect(await imgSecCheck('cloud://y')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
      expect(control.openapiCalls().length).toBe(0)
    } finally {
      cloudAny.downloadFile = realDownload
    }
  })

  it('大白话：微信回 87014（图含违规信息）→ 拒且错误码是 IMG_RISKY（跟设施故障分得开）', async () => {
    control.setOpenapiResult({ errCode: 87014 })
    expect(await imgSecCheck('cloud://bad')).toEqual({ ok: false, error: 'IMG_RISKY' })
  })

  it('大白话：小写 errcode 87014 一样认违规（?? 双壳·云调用两种壳都见过）', async () => {
    control.setOpenapiResult({ errcode: 87014 })
    expect(await imgSecCheck('cloud://bad2')).toEqual({ ok: false, error: 'IMG_RISKY' })
  })

  it('大白话：非 0 非违规码（如 40001）→ 保守拒 SEC_CHECK_FAIL；回包 {}（无错误码字段）→ 按通过算', async () => {
    control.setOpenapiResult({ errCode: 40001 })
    expect(await imgSecCheck('cloud://a')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
    control.setOpenapiResult({})
    expect(await imgSecCheck('cloud://b')).toEqual({ ok: true }) // code==null 不算失败（云调用正常返回）
  })

  it('大白话：审核云调用抛错——带 87014 算违规（IMG_RISKY），带别的码算设施故障（SEC_CHECK_FAIL），总之不上抛', async () => {
    control.setOpenapiFail(true, 87014)
    expect(await imgSecCheck('cloud://throw-risky')).toEqual({ ok: false, error: 'IMG_RISKY' })
    control.setOpenapiFail(true, 48001) // 48001=api 功能未授权（能力未开通·真机常见首错）
    expect(await imgSecCheck('cloud://throw-infra')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
  })
})

describe('msgSecCheck（UGC 文本审核·fail-closed·空文本不外呼）', () => {
  it('大白话：空串/纯空白/压根不是字符串 → 直接过 { ok:true }，一次审核都不打（省无谓计费）', async () => {
    expect(await msgSecCheck('', 'oUser-1')).toEqual({ ok: true }) // 形状必须恰好 {ok:true}
    expect(await msgSecCheck('   \n\t ', 'oUser-1')).toEqual({ ok: true }) // trim 后为空＝空（去掉 trim 必红）
    expect(await msgSecCheck(null as any, 'oUser-1')).toEqual({ ok: true }) // 非 string 不 trim 不外呼（变异后会抛 TypeError）
    expect(await msgSecCheck(0 as any, 'oUser-1')).toEqual({ ok: true })
    expect(control.openapiCalls().length).toBe(0) // 早退守门被拆（if(false)/if(text)）会出站 → 必红
  })

  it('大白话：正常文本送审的请求形状完整——openid+修剪后的 content+version:2+scene（默认评论场景 2）', async () => {
    const r = await msgSecCheck(' 这鸭子真可爱 ', 'oUser-1')
    expect(r).toEqual({ ok: true })
    const calls = control.openapiCalls()
    expect(calls.length).toBe(1)
    // v2 四件套缺任一＝审核请求失真；content 必须是 trim 后原文（前后空白不送审）
    expect(calls[0]).toEqual({ openid: 'oUser-1', content: '这鸭子真可爱', version: 2, scene: SCENE_COMMENT })
  })

  it('大白话：显式传资料场景（scene=1·昵称/签名面）要原样带给微信', async () => {
    await msgSecCheck('鸭鸭本鸭', 'oUser-2', SCENE_PROFILE)
    expect(control.openapiCalls()[0]).toEqual({ openid: 'oUser-2', content: '鸭鸭本鸭', version: 2, scene: 1 })
  })

  it('大白话：errCode 非 0（大小写两种壳都认）→ 保守拒；回包 {} / errCode:0 → 放行', async () => {
    control.setOpenapiResult({ errCode: 87014 })
    expect(await msgSecCheck('文本A', 'oU')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
    control.setOpenapiResult({ errcode: 40001 }) // 小写壳（?? 变异成 && 会把它漏成放行）
    expect(await msgSecCheck('文本B', 'oU')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
    control.setOpenapiResult({})
    expect(await msgSecCheck('文本C', 'oU')).toEqual({ ok: true }) // code==null 不算失败
    control.setOpenapiResult({ errCode: 0 })
    expect(await msgSecCheck('文本D', 'oU')).toEqual({ ok: true })
  })

  it('大白话：errCode 0 但平台建议 risky → 拒；pass/review/没有 suggest → 放行', async () => {
    control.setOpenapiResult({ errCode: 0, result: { suggest: 'risky' } })
    expect(await msgSecCheck('擦边文本', 'oU')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
    control.setOpenapiResult({ errCode: 0, result: { suggest: 'pass' } })
    expect(await msgSecCheck('正常文本', 'oU')).toEqual({ ok: true })
    control.setOpenapiResult({ errCode: 0, result: { suggest: 'review' } })
    expect(await msgSecCheck('存疑文本', 'oU')).toEqual({ ok: true }) // 源码注释：含 review/无 suggest → 放行
  })

  it('大白话：审核云调用抛错（能力未开通/网络）→ fail-closed 拒 SEC_CHECK_FAIL，绝不上抛', async () => {
    control.setOpenapiFail(true, 48001)
    expect(await msgSecCheck('任意文本', 'oU')).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
  })
})
