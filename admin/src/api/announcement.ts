import { request } from './request'
import type { Announcement, AnnouncementResponse, AnnouncementSaveDTO } from '@/types/announcement'

function unwrap<T>(response: { data: AnnouncementResponse<T> }, fallback: string): T {
  const result = response.data
  if (result.code !== 0 || result.success === false) throw new Error(result.message || fallback)
  return result.data as T
}

function normalize(value: unknown): Announcement {
  const row = (value || {}) as Partial<Announcement>
  return {
    ...(row as Announcement),
    id: String(row.id ?? ''),
    content: String(row.content ?? ''),
    enabled: Number(row.enabled ?? 0),
    sortOrder: Number(row.sortOrder ?? 0),
    createTime: String(row.createTime ?? ''),
    updateTime: String(row.updateTime ?? ''),
  }
}

/** 查询全部公告（含停用），按 sortOrder 倒序。 */
export async function getAnnouncements(): Promise<Announcement[]> {
  const data = unwrap(await request.get<AnnouncementResponse<unknown>>('/api/admin/announcement/list'), '公告列表查询失败')
  return Array.isArray(data) ? data.map(normalize) : []
}

/** 新增公告。 */
export async function createAnnouncement(payload: AnnouncementSaveDTO): Promise<void> {
  unwrap(await request.post<AnnouncementResponse<null>>('/api/admin/announcement', payload), '公告新增失败')
}

/** 修改公告（只更新传了的字段）。 */
export async function updateAnnouncement(id: string, payload: AnnouncementSaveDTO): Promise<void> {
  unwrap(await request.put<AnnouncementResponse<null>>(`/api/admin/announcement/${id}`, payload), '公告修改失败')
}

/** 软删除公告。 */
export async function deleteAnnouncement(id: string): Promise<void> {
  unwrap(await request.delete<AnnouncementResponse<null>>(`/api/admin/announcement/${id}`), '公告删除失败')
}
