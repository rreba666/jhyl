import { request } from '@/utils/request'

/** 公告（对应 AnnouncementVO）。 */
export interface Announcement {
  /** 公告 ID（int64，序列化为字符串）。 */
  id: string
  /** 公告文案。 */
  content: string
  /** 是否启用：0=停用, 1=启用。 */
  enabled: number
  /** 排序权重（数值越大越靠前）。 */
  sortOrder: number
  createTime: string
  updateTime: string
}

/** 查询启用中的公告列表（公开接口，无需登录，按 sortOrder 倒序）。 */
export async function getAnnouncementList(): Promise<Announcement[]> {
  const result = await request<Announcement[]>({ url: '/api/announcement/list', method: 'GET' })
  return (result || []).map((item) => ({ ...item, id: String(item.id) }))
}
