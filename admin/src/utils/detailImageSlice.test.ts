import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DETAIL_IMAGE_MAX_COUNT,
  DETAIL_SLICE_JPEG_QUALITY,
  DETAIL_SLICE_MAX_SEGMENT_BYTES,
  DETAIL_SLICE_MAX_SEGMENT_HEIGHT,
  DETAIL_SLICE_MAX_WIDTH,
  buildDetailSegmentName,
  planDetailImageSlices,
} from './detailImageSlice.ts'

/** 实测事故图：生产商品 id=5/6/7 的详情图（9.0MB / 790 × 21222px）。 */
const INCIDENT = { width: 790, height: 21222 }

test('切片阈值常量与实测依据一致', () => {
  assert.equal(DETAIL_SLICE_MAX_SEGMENT_HEIGHT, 3000)
  assert.equal(DETAIL_SLICE_MAX_WIDTH, 1200)
  assert.equal(DETAIL_SLICE_JPEG_QUALITY, 0.85)
  assert.equal(DETAIL_SLICE_MAX_SEGMENT_BYTES, 2 * 1024 * 1024)
  assert.equal(DETAIL_IMAGE_MAX_COUNT, 15)
})

test('790×21222（事故图）切成 8 段，段高合计 21222，无重叠无遗漏', () => {
  const plan = planDetailImageSlices(INCIDENT.width, INCIDENT.height)

  assert.equal(plan.needSlice, true)
  assert.equal(plan.totalSegments, 8)
  assert.equal(plan.scale, 1)
  assert.equal(plan.outputWidth, 790)
  assert.equal(plan.outputHeight, 21222)

  // 段高：[3000 ×7, 222]
  assert.deepEqual(plan.segments.map((segment) => segment.height), [3000, 3000, 3000, 3000, 3000, 3000, 3000, 222])
  assert.equal(plan.segments.reduce((sum, segment) => sum + segment.height, 0), 21222)
  assert.equal(plan.segments.reduce((sum, segment) => sum + segment.sHeight, 0), 21222)

  // 首段从 0 开始；相邻段严格首尾相接（无重叠、无遗漏）
  assert.equal(plan.segments[0].sy, 0)
  for (let index = 1; index < plan.segments.length; index += 1) {
    const previous = plan.segments[index - 1]
    assert.equal(previous.sy + previous.sHeight, plan.segments[index].sy)
  }
  const last = plan.segments[plan.segments.length - 1]
  assert.equal(last.sy + last.sHeight, 21222)

  // 段号从 1 开始且顺序递增（文件名 part1..part8 → 保证阅读顺序）
  assert.deepEqual(plan.segments.map((segment) => segment.index), [1, 2, 3, 4, 5, 6, 7, 8])
})

test('高度 ≤ 3000 不切片（既有行为不变），3001 才切', () => {
  const noSlice = planDetailImageSlices(790, 3000)
  assert.equal(noSlice.needSlice, false)
  assert.equal(noSlice.totalSegments, 1)
  assert.equal(noSlice.segments[0].sHeight, 3000)

  const slice = planDetailImageSlices(790, 3001)
  assert.equal(slice.needSlice, true)
  assert.equal(slice.totalSegments, 2)
  assert.deepEqual(slice.segments.map((segment) => segment.height), [3000, 1])
})

test('宽度 > 1200 时等比收敛，缩放后仍无重叠无遗漏（源坐标与输出坐标同时成立）', () => {
  const plan = planDetailImageSlices(2400, 9000)
  assert.equal(plan.scale, 0.5)
  assert.equal(plan.outputWidth, 1200)
  assert.equal(plan.outputHeight, 4500)
  assert.equal(plan.totalSegments, 2)
  assert.deepEqual(plan.segments.map((segment) => segment.height), [3000, 1500])
  assert.equal(plan.segments.reduce((sum, segment) => sum + segment.height, 0), 4500)
  assert.deepEqual(plan.segments.map((segment) => [segment.sy, segment.sHeight]), [[0, 6000], [6000, 3000]])
  assert.equal(plan.segments.reduce((sum, segment) => sum + segment.sHeight, 0), 9000)
})

test('宽度 ≤ 1200 不放大（避免糊图）', () => {
  const plan = planDetailImageSlices(750, 21222)
  assert.equal(plan.scale, 1)
  assert.equal(plan.outputWidth, 750)
})

test('尺寸非法时返回 0 段，调用方按原图上传', () => {
  for (const [width, height] of [[0, 100], [100, 0], [Number.NaN, 100], [100, Number.NaN]]) {
    const plan = planDetailImageSlices(width, height)
    assert.equal(plan.needSlice, false)
    assert.equal(plan.totalSegments, 0)
    assert.equal(plan.segments.length, 0)
  }
})

test('切片文件名保留原主名并统一为 .jpg，段号连续', () => {
  assert.equal(buildDetailSegmentName('详情图.png', 1), '详情图-part1.jpg')
  assert.equal(buildDetailSegmentName('detail.jpeg', 8), 'detail-part8.jpg')
  assert.equal(buildDetailSegmentName('a.b.jpg', 2), 'a.b-part2.jpg')
  assert.equal(buildDetailSegmentName('noext', 3), 'noext-part3.jpg')
})
