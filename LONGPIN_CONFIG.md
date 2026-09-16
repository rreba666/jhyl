# 隆平优选（LonPin）配置清单

> 所属：E:\work\JJ\LonPin · 日期：2026-08-26
> 说明：隆平优选小程序，模式与今华有一致（后台/核销复用），多同城配送，首页不同。
> 本清单标注各配置项当前状态：✅ 已改 / ⚠️ 占位待补 / 🔲 等设计稿或后端。

## 一、已改（确定）

| 配置项 | 位置 | 值 | 状态 |
|--------|------|-----|------|
| 小程序名 | mini_shop/pages.json | 「隆平优选」 | ✅ |
| 首页品牌名 | mini_shop/pages/index/index.vue | 「隆平优选·甄选品质生活」 | ✅ |
| VITE_APP_KEY | mini_shop/.env / .env.production | `longping` | ✅ |

## 二、占位待补（等后端/微信）

| 配置项 | 位置 | 当前值 | 待补 |
|--------|------|--------|------|
| VITE_API_BASE_URL | mini_shop/.env* | api.jinhuayou365.com（今华有） | 隆平后端域名 |
| VITE_MERCHANT_TRANSFER_MCH_ID | mini_shop/.env* | 1749568111 | 隆平微信商户号 |
| VITE_MERCHANT_TRANSFER_APP_ID | mini_shop/.env* | wx07b085c3aaddaf2f | 隆平小程序 appid |
| 微信小程序 appid | mini_shop/manifest.json、project.config.json | wx07b085c3aaddaf2f | 隆平微信 appid |
| 核销 H5 域名跳转 | mini_shop/api/order.ts normalizePickupUrl | api.jinhuayou365.com→cqcode.* | 隆平核销域名 |
| admin/staff-h5 后端地址 | admin/.env*、staff-h5/.env* | api.jinhuayou365.com | 隆平后端域名 |

> 注：隆平后端/微信配置尚未确定，**先不改**（避免配错），等后端域名、微信小程序、商户号开通后填入。

## 三、等设计稿/后端

| 项 | 状态 | 说明 |
|----|------|------|
| 首页布局 | 🔲 等设计稿 | 隆平是完全不同的布局（待提供设计稿） |
| 主题色/主色 | 🔲 等设计稿 | 今华有 `#007aff`，隆平主色待定 |
| 同城配送 | 🔲 等后端 | 后端接口未开发，本期占位 |
| 用户协议/隐私主体 | 🔲 待确认 | 隆平运营主体（公司名）未定，先不动 |

## 四、说明

- 后台（admin）、核销（staff-h5）：跟今华有一致，**无需改**（除后端地址占位）。
- 小程序（mini_shop）：品牌名/APP_KEY 已改；主题色/域名/微信配置等后端和设计稿。
- 三端已拷贝到 LonPin，admin/staff-h5 依赖已装、构建通过。
