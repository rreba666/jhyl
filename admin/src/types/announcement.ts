/** 公告（对应 AnnouncementVO）。 */
export interface Announcement {
  id: string
  content: string
  /** 是否启用：0=停用, 1=启用。 */
  enabled: number
  /** 排序权重（数值越大越靠前）。 */
  sortOrder: number
  createTime: string
  updateTime: string
}

/** 新增/修改公告请求体（对应 AnnouncementSaveDTO）。 */
export interface AnnouncementSaveDTO {
  content: string
  enabled?: number
  sortOrder?: number
}

export interface AnnouncementResponse<T> {
  code: number
  message: string
  data?: T | null
  success?: boolean
}
