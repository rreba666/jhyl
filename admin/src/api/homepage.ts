import { request } from './request'
import { extractMediaUrl, resolveMediaArray, resolveMediaSlots, resolveMediaUrl } from './media'
import type {
  HomeConfigV2,
  HomepageConfigSaveDTO,
  HomepageConfigUpdateDTO,
  HomepageConfigVO,
  HomepageResponse,
  HomepageVO,
  HomepageProductCard,
  LandingConfigV2,
} from '@/types/homepage'

/** 读取主页配置列表，将后端 HomepageVO.mediaList 归一化为管理表格数据。 */
export async function getHomepageConfigs(): Promise<{ list: HomepageConfigVO[]; recommendedProducts: HomepageProductCard[] }> {
  const response = await request.get<HomepageResponse<HomepageVO>>('/api/admin/homepage/config')
  const result = response.data
  ensureSuccess(result, '主页配置查询失败')
  return {
    list: (result.data?.mediaList || []).map((item) => ({
      ...item,
      id: String(item.id),
      imageUrl: resolveMediaArray(item.imageUrl),
      videoUrl: resolveMediaArray(item.videoUrl),
      coverUrl: resolveMediaArray(item.coverUrl),
      bottomImageUrl: resolveMediaSlots(item.bottomImageUrl, 2),
      bottomLinkTarget: item.bottomLinkTarget || [],
      bottomTitle: item.bottomTitle || '',
    })),
    recommendedProducts: (result.data?.recommendedProducts || []).map((item) => ({ ...item, mainImage: resolveMediaUrl(item.mainImage) })),
  }
}

/** 新增主页配置。 */
export async function createHomepageConfig(payload: HomepageConfigSaveDTO): Promise<HomepageConfigVO | null> {
  const response = await request.post<HomepageResponse<HomepageConfigVO | null>>('/api/admin/homepage/config', payload)
  const result = response.data
  ensureSuccess(result, '主页配置新增失败')
  return result.data || null
}

/** 修改指定 ID 的主页配置。 */
export async function updateHomepageConfig(id: number | string, payload: HomepageConfigUpdateDTO): Promise<void> {
  const normalizedId = Number(String(id).trim())
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new Error('主页配置 ID 无效')
  }
  const response = await request.put<HomepageResponse<null>>(
    `/api/admin/homepage/config/${normalizedId}`,
    payload,
  )
  ensureSuccess(response.data, '主页配置保存失败')
}

/** 删除指定 ID 的主页配置。 */
export async function deleteHomepageConfig(id: number | string): Promise<void> {
  const normalizedId = Number(String(id).trim())
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) {
    throw new Error('主页配置 ID 无效')
  }
  const response = await request.delete<HomepageResponse<null>>(`/api/admin/homepage/config/${normalizedId}`)
  ensureSuccess(response.data, '主页配置删除失败')
}

/** 将选中的文件上传到主页管理 OSS 接口并返回文件地址。 */
export async function uploadHomepageFile(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await request.post<HomepageResponse<string>>('/api/admin/homepage/upload', formData)
  const result = response.data
  ensureSuccess(result, '主页文件上传失败')
  const url = extractMediaUrl(result.data)
  if (!url) throw new Error('主页文件上传未返回地址')
  return url
}

/** 统一校验主页管理接口的业务响应。 */
function ensureSuccess<T>(result: HomepageResponse<T>, fallbackMessage: string): void {
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallbackMessage)
}

/** 读取首页 V2 配置（hero 大图 + 金刚区）。 */
export async function getHomeConfigV2(): Promise<HomeConfigV2> {
  const response = await request.get<HomepageResponse<HomeConfigV2 | null>>('/api/v2/admin/home/config')
  const result = response.data
  ensureSuccess(result, '首页配置查询失败')
  return result.data ?? { heroImages: [], kingkong: [], welfare: null }
}

/** 保存首页 V2 配置（全量覆盖）。 */
export async function saveHomeConfigV2(payload: HomeConfigV2): Promise<void> {
  const response = await request.put<HomepageResponse<null>>('/api/v2/admin/home/config', payload)
  ensureSuccess(response.data, '首页配置保存失败')
}

/** 读取全部金刚区落地页配置。 */
export async function getLandingConfigsV2(): Promise<LandingConfigV2[]> {
  const response = await request.get<HomepageResponse<LandingConfigV2[] | null>>('/api/v2/admin/landing/config')
  const result = response.data
  ensureSuccess(result, '落地页配置查询失败')
  return result.data ?? []
}

/** 保存金刚区落地页配置（全量覆盖）。 */
export async function saveLandingConfigsV2(payload: LandingConfigV2[]): Promise<void> {
  const response = await request.put<HomepageResponse<null>>('/api/v2/admin/landing/config', payload)
  ensureSuccess(response.data, '落地页配置保存失败')
}

export type { HomepageVO }
