/**
 * Vite 构建配置（**HBuilderX 项目也认这个文件**）。
 *
 * ## ⚠️⚠️ 为什么需要它（2026-10-01 真机踩坑，排查了 7 轮）
 *
 * 现象：**发行模式**（`dist/build`）下，uni API 调用处随机抛
 * `Cannot read properties of undefined (reading 'index')`；**运行模式**（`dist/dev`）完全正常。
 *
 * 根因：**terser 压缩时的变量命名冲突**（不是业务代码问题）：
 * ```
 * 模块级：  const common_vendor = require("../../common/vendor.js")  → 被 mangle 成  const e = ...
 * 局部：    源码里的 prepay / isDirectBuy / detail 等                → 也被 mangle 成  const e = ...
 * ⇒ 源码的 uni.showToast() 被编译成 e.index.showToast()
 * ⇒ 该函数内 e 已指向那个局部变量 ⇒ undefined.index ⇒ 💥
 * ```
 *
 * 决定性证据（同一次改动的两种产物）：
 * | | `dist/dev` | `dist/build` |
 * |---|---|---|
 * | `e.index` 调用 | **0 处** | **58 处** |
 * | `prepay` / `isDirectBuy` | ✅ 原名保留 | ❌ 被重命名为 `e` |
 * | vendor 绑定 | `const common_vendor = require(...)` | ⚠️ `const e = require(...)` |
 *
 * ## ✅ 解法：只关掉**顶层**重命名（`mangle.toplevel`）
 *
 * ⚠️ 对照发现：`@dcloudio/uni-mp-alipay` 在 production 下设置的是
 * `terserOptions = { compress: false, mangle: false }`（**支付宝端完全不混淆**），
 * 而**微信端没有这个设置** ⇒ 这就是只有微信小程序复现的原因。
 *
 * ⚠️ 但**不能照抄支付宝那样全关**：实测关掉压缩后主包
 * **2157 KB > 2048 KB** 超限（`main package source size ... exceed max limit`），传不上去。
 *
 * ⇒ 所以只关 `mangle.toplevel`：
 *   · **模块级绑定**（`common_vendor` / `api_order` 等）**保留原名** ⇒ **不再与局部短名冲突**；
 *   · **局部变量**照旧缩成 `e` / `a` / `t` ⇒ **体积几乎不变**（只多出几十个模块级名字）。
 *
 * ⚠️ 注意：Vite 默认会给 terser 传 `toplevel: true`（这正是模块级被缩成 `e` 的原因），
 * 这里显式覆盖回 `false`。
 */
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

export default defineConfig({
  plugins: [uni()],
  build: {
    // ⚠️ 保持 uni 默认的压缩器（terser），只是把"顶层重命名"关掉
    minify: 'terser',
    terserOptions: {
      mangle: {
        // ⚠️⚠️ 关键：不重命名**顶层/模块级**绑定
        //    ⇒ `const common_vendor = require(...)` 不再变成 `const e = require(...)`
        //    ⇒ 源码里 `uni.showToast()` 编译出的 `e.index.showToast()` 不会再撞上局部变量
        toplevel: false,
      },
      // ⚠️ 不动 compress：保持默认压缩强度，避免包体积超标
    },
  },
})
