/** 创建轻量点击节流器，返回 false 表示本次点击应被忽略。 */
export function createThrottle(wait = 300): () => boolean {
  let lastRunAt = 0

  return () => {
    const now = Date.now()
    if (now - lastRunAt < wait) return false
    lastRunAt = now
    return true
  }
}
