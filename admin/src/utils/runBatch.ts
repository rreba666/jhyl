export interface BatchResult<T> {
  succeeded: T[]
  failed: Array<{ item: T; error: unknown }>
}

/** Run independent async tasks with a small concurrency cap and keep both outcomes. */
export async function runBatch<T>(
  items: readonly T[],
  worker: (item: T) => Promise<void>,
  concurrency = 3,
): Promise<BatchResult<T>> {
  const succeeded: T[] = []
  const failed: Array<{ item: T; error: unknown }> = []
  let cursor = 0
  const workerCount = Math.min(Math.max(1, concurrency), items.length)

  async function consume(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      try {
        await worker(item)
        succeeded.push(item)
      } catch (error) {
        failed.push({ item, error })
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => consume()))
  return { succeeded, failed }
}

