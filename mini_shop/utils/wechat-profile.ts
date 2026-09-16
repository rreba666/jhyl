export interface WechatProfile {
  nickname: string
  avatarUrl: string
}

interface WechatUserInfoResult {
  userInfo?: {
    nickName?: string
    avatarUrl?: string
  }
}

interface WechatProfileOptions {
  desc: string
  success: (result: WechatUserInfoResult) => void
  fail: (error: { errMsg?: string }) => void
}

/** 获取微信用户资料，并转换成后端用户资料字段。 */
export function getWechatProfile(): Promise<WechatProfile> {
  return new Promise((resolve, reject) => {
    const getUserProfile = (uni as unknown as { getUserProfile?: (options: WechatProfileOptions) => void }).getUserProfile
    if (typeof getUserProfile !== 'function') {
      reject(new Error('当前环境不支持微信用户资料授权'))
      return
    }

    getUserProfile({
      desc: '用于展示您的头像和昵称',
      success: (result) => {
        const nickname = result.userInfo?.nickName?.trim() || ''
        const avatarUrl = result.userInfo?.avatarUrl?.trim() || ''
        if (!nickname && !avatarUrl) {
          reject(new Error('未获取到微信用户资料'))
          return
        }
        resolve({ nickname, avatarUrl })
      },
      fail: (error) => reject(new Error(error?.errMsg || '微信用户资料授权失败')),
    })
  })
}
