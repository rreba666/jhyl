/**
 * 「申请售后」弹层的状态与提交逻辑（C 端订单详情 / 订单列表**共用**）。
 *
 * ## 为什么要抽出它（2026-10-02 代码审查发现）
 * 后端 P1P2 §一.2 的售后窗口新口径要求「**已完成订单也可以申请售后**」，
 * 于是订单**详情页**与**列表页**各加了一份完全同形的实现：
 * 同样的 guard、同样的三个 ref（visible / submitting / error）、
 * 同一句 toast「售后申请已提交，等待审核」、同一句 fallback「售后申请失败，请稍后重试」，
 * 只有**收尾动作**不同（详情页跳「退款/售后」分类；列表页切页签并刷新当前页）。
 *
 * ⇒ 重复的正是「**怎么提交**」，不同的只是「**提交成功后做什么**」，
 *   所以这里把前者收进来，把后者作为 `onSuccess` 回调交给调用方。
 *
 * ## 与另外两个退款入口的区别（**不要混用**）
 * | 入口 | 接口 | 特点 |
 * |---|---|---|
 * | 秒退 | `POST /api/order/refund/fast/{orderId}` | 免审核、**立即原路退款**（本文件**不**涉及） |
 * | 用户自助退款 | `POST /api/order/refund/{orderId}` | **仅 PAID**（本文件**不**涉及） |
 * | **售后申请**（本文件） | **`POST /api/after-sale/submit`** | 创建售后单 ⇒ **待审核**、**不会立即退款** |
 *
 * ⚠️ 因此**文案必须区分**：本弹层的说明要写"提交后进入审核"，**不能**写"立即原路退款"（会误导用户）。
 *
 * ⚠️ **窗口判定在后端**（**2026-10-08 Step2 + W8 §5；2026-10-10 §四 物流锚点再扩**）：
 *    物流 = 「确认收货 / **快递签收** / 完成」三者**最晚者**的**次日 0 点**起 7 天内
 *           （W8 §5 改的是起算点，2026-10-10 §四 新增签收并取三者最晚；**天数仍是 7 天**）；
 *    自提 = 支付后 30 天内且**核销后不可退**（**始终未变**）；
 *    **同城 = 送达次日 0 点起，普通 7 天 / 生鲜（`timingCategory=1`）48 小时** ← Step2 改的是这一行。
 *    超期后端返回 `8703`，前端**直接展示后端文案**（本项目未硬编码该错误码文案，见下文 `submit`），故这里不翻译错误。
 *    ⚠️ 用户可见的窗口说明统一取自 `@/utils/timing-category`，不要在页面里另拼一份。
 */
import { ref } from 'vue'
import { submitAfterSale } from '@/api/after-sale'

/** {@link useAfterSaleSubmit} 的参数。 */
export interface UseAfterSaleSubmitOptions {
  /**
   * ⚠️ 提交**成功**后的收尾动作 —— 这是两个页面**唯一**不同之处：
   * 详情页 `uni.redirectTo('/subpkg-order/orders/list?tab=aftersale')`；
   * 列表页 `activeIndex = AFTER_SALE_TAB_INDEX` 后 `await load(true)`。
   */
  onSuccess: () => void | Promise<void>
  /** 成功提示文案（默认「售后申请已提交，等待审核」）。 */
  successText?: string
  /** 失败兜底文案（后端未下发 message 时用；默认「售后申请失败，请稍后重试」）。 */
  failText?: string
}

/**
 * 申请售后弹层：`open(orderId)` 打开、`submit(reason)` 提交。
 *
 * ⚠️ 失败时**不关闭弹层**：理由留在输入框里，用户改完可直接重试（与秒退弹层同一交互约定）。
 */
export function useAfterSaleSubmit(options: UseAfterSaleSubmitOptions) {
  const sheetVisible = ref(false)
  const sheetSubmitting = ref(false)
  const sheetError = ref('')
  /** 当前正在申请售后的订单 ID（null = 弹层关闭）。 */
  const targetOrderId = ref<number | string | null>(null)

  /** 打开弹层（同一时刻只服务一个订单）。 */
  function open(orderId: number | string): void {
    targetOrderId.value = orderId
    sheetError.value = ''
    sheetVisible.value = true
  }

  /** 关闭弹层并清空目标（提交成功后调用）。 */
  function close(): void {
    sheetVisible.value = false
    targetOrderId.value = null
  }

  /**
   * 提交售后申请。
   * ⚠️ 失败只写 `sheetError`、**不上抛**（避免调用方多写一层 try/catch），
   *    且**不关弹层**（理由不丢）。
   */
  async function submit(reason: string): Promise<void> {
    const orderId = targetOrderId.value
    if (orderId == null || sheetSubmitting.value) return
    sheetSubmitting.value = true
    sheetError.value = ''
    try {
      await submitAfterSale({ orderId, reason })
      close()
      uni.showToast({ title: options.successText ?? '售后申请已提交，等待审核', icon: 'success' })
      await options.onSuccess()
    } catch (error) {
      // ⚠️ 超期（8703）等业务错误由后端下发文案 ⇒ 直接展示，不在此处拼中文
      sheetError.value = error instanceof Error ? error.message : (options.failText ?? '售后申请失败，请稍后重试')
    } finally {
      sheetSubmitting.value = false
    }
  }

  return { sheetVisible, sheetSubmitting, sheetError, targetOrderId, open, close, submit }
}
