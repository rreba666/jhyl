/**
 * 送达凭证（照片）采集工具
 *
 * 后端口径（`api_doc.json` 的 `POST /api/delivery/tasks/{taskId}/proof`）：
 * - **送达后 24h 内**上传；`proofType` 默认 `PHOTO`，`objectKey` 必传；
 * - 一次调用只传一张（一个 `objectKey`），多张要多次调用；
 * - 门店可在配送规则里配 `proofTypes`（如 `PHOTO,VIDEO`），任务返回的 `proofTypes` 即本单要求。
 *
 * 交互口径（2026-09-17 确认）：**送达时引导拍照（可跳过）**；跳过的可在「已完成」详情页 24h 内补传。
 */
import { toObjectKey, uploadTaskProof } from '@/api/delivery'
import { parseTime } from '@/utils/datetime'
import { uploadFile } from '@/utils/request'

/** 一次最多拍几张（与「上报异常」保持一致）。 */
export const PROOF_MAX_COUNT = 3

/** 送达凭证可补传的时长（后端口径 24h）。 */
export const PROOF_UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 弹「拍照 / 从相册选择 / 暂不拍摄」，把选中的图片上传到 OSS 后返回 `objectKey` 列表。
 * 选「暂不拍摄」或直接取消 → 返回空数组（调用方按"跳过"处理，不阻断送达）。
 */
export function captureProofImages(): Promise<string[]> {
  return new Promise((resolve) => {
    uni.showActionSheet({
      itemList: ['拍照', '从相册选择', '暂不拍摄'],
      success: (sheet) => {
        if (sheet.tapIndex === 2) {
          // 明确告诉骑手还能补，避免以为"不拍就永远没凭证了"
          uni.showToast({ title: '可在送达后 24 小时内补传', icon: 'none' })
          return resolve([])
        }
        uni.chooseImage({
          count: PROOF_MAX_COUNT,
          sourceType: sheet.tapIndex === 0 ? ['camera'] : ['album'],
          success: async (res) => {
            const keys: string[] = []
            uni.showLoading({ title: '上传中…', mask: true })
            try {
              for (const path of res.tempFilePaths || []) {
                keys.push(toObjectKey(await uploadFile(path)))
              }
            } catch (error) {
              uni.showToast({ title: error instanceof Error ? error.message : '照片上传失败', icon: 'none' })
            } finally {
              uni.hideLoading()
            }
            resolve(keys)
          },
          // 在系统选择器里取消也算跳过
          fail: () => resolve([]),
        })
      },
      fail: () => resolve([]),
    })
  })
}

/**
 * 批量提交送达凭证：一张一次调用（后端按张存），单张失败不阻断其余。
 * @returns 成功张数
 */
export async function submitProofImages(
  taskId: number | string,
  objectKeys: string[],
  receiverName?: string,
): Promise<number> {
  let uploaded = 0
  for (const objectKey of objectKeys) {
    try {
      await uploadTaskProof(taskId, { proofType: 'PHOTO', objectKey, receiverName })
      uploaded += 1
    } catch (error) {
      // 一张都没成功 → 交给调用方提示；已经有成功的就静默跳过，避免打断骑手
      if (!uploaded) throw error
    }
  }
  return uploaded
}

/** 是否还在「送达后 24h」的补传窗口内（没送达时间或解析不了时按可传处理，避免误判成不可传）。 */
export function canStillUploadProof(deliveredAt?: string | null): boolean {
  const time = parseTime(deliveredAt)
  if (!Number.isFinite(time)) return true
  return Date.now() - time < PROOF_UPLOAD_WINDOW_MS
}
