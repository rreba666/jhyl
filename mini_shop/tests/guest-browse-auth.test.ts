import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const requestSource = readFileSync(resolve(root, 'utils/request.ts'), 'utf8')
const loginSource = readFileSync(resolve(root, 'pages/login/login.vue'), 'utf8')
const pagesJsonSource = readFileSync(resolve(root, 'pages.json'), 'utf8')
const privacySource = readFileSync(resolve(root, 'pages/privacy/privacy.vue'), 'utf8')
const userAgreementPath = resolve(root, 'pages/user-agreement/user-agreement.vue')
const userAgreementSource = existsSync(userAgreementPath) ? readFileSync(userAgreementPath, 'utf8') : ''
const categorySource = readFileSync(resolve(root, 'pages/category/category.vue'), 'utf8')
const detailSource = readFileSync(resolve(root, 'subpkg-goods/detail/detail.vue'), 'utf8')
const loginGuideSource = readFileSync(resolve(root, 'components/LoginGuide.vue'), 'utf8')
const mineSource = readFileSync(resolve(root, 'pages/mine/mine.vue'), 'utf8')
const paymentSource = readFileSync(resolve(root, 'subpkg-order/payment/payment.vue'), 'utf8')
const orderDetailSource = readFileSync(resolve(root, 'subpkg-order/orders/detail.vue'), 'utf8')
const invoiceSource = readFileSync(resolve(root, 'subpkg-order/invoice/list.vue'), 'utf8')

test('expired sessions do not force a guest page to relaunch into login', () => {
  assert.doesNotMatch(requestSource, /uni\.reLaunch\(\{\s*url:\s*['"]\/pages\/login\/login['"]/)
  assert.match(requestSource, /clearAuth\(\)/)
})

test('public browse requests retry once without an expired authorization header', () => {
  assert.match(requestSource, /isPublicBrowseRequest\(/)
  assert.match(requestSource, /\/api\/category\/list/)
  assert.match(requestSource, /\/api\/product\/list/)
  assert.match(requestSource, /product.*detail/)
  assert.match(requestSource, /\/api\/homepage/)
  assert.match(requestSource, /announcement/)
  assert.match(requestSource, /\/api\/shop\/all/)
  assert.match(requestSource, /retryWithoutAuthorization/)
})

test('login page provides an explicit cancel path back to browsing', () => {
  assert.match(loginSource, /暂不登录/)
  assert.match(loginSource, /function cancelLogin\(\)/)
  assert.match(loginSource, /uni\.navigateBack\(/)
  assert.match(loginSource, /uni\.switchTab\(\{\s*url:\s*['"]\/pages\/index\/index['"]/) 
})

test('login page exposes both independent agreement links', () => {
  assert.match(loginSource, /《用户协议》/)
  assert.match(loginSource, /《隐私保护指引》/)
  assert.match(loginSource, /function openUserAgreement\(\)/)
  assert.match(loginSource, /['"]\/pages\/user-agreement\/user-agreement['"]/) 
  assert.match(loginSource, /function openPrivacy\(\)/)
  assert.match(loginSource, /['"]\/pages\/privacy\/privacy['"]/) 
  assert.match(pagesJsonSource, /pages\/user-agreement\/user-agreement/)
})

test('login requires agreement before requesting phone login', () => {
  assert.match(loginSource, /:disabled="loading \|\| !privacyAgreed"/)
  assert.match(loginSource, /if \(!privacyAgreed\.value\)/)
  assert.match(loginSource, /请先阅读并同意用户协议和隐私保护指引/)
})

test('user agreement page contains the complete agreement sections', () => {
  assert.match(userAgreementSource, /今华有（江西）生物科技有限公司小程序商城用户协议/)
  assert.doesNotMatch(userAgreementSource, /今华有（江西）生物科技公司小程序商城用户协议/)
  assert.doesNotMatch(userAgreementSource, /生效日期/)
  assert.match(userAgreementSource, /最后更新：2026年8月23日/)
  assert.match(userAgreementSource, /一、定义与解释/)
  assert.match(userAgreementSource, /六、平台红包补贴规则/)
  assert.match(userAgreementSource, /八、用户信息保护/)
  assert.match(userAgreementSource, /十五、其他/)
  assert.match(userAgreementSource, /91360421MAKL2FCP56/)
})

test('privacy guidance uses the same 18-year-old minor standard as the user agreement', () => {
  assert.match(privacySource, /未满18周岁/)
  assert.doesNotMatch(privacySource, /14周岁以下/)
})

test('privacy guidance discloses the company agreement data categories and rights', () => {
  assert.match(privacySource, /微信昵称、头像、OpenID/)
  assert.match(privacySource, /收货人姓名、联系电话、收货地址/)
  assert.match(privacySource, /设备信息（设备型号、操作系统版本、唯一设备标识符）/)
  assert.match(privacySource, /支付信息（交易流水号、支付金额、支付时间）/)
  assert.match(privacySource, /您的个人信息权利/)
  assert.match(privacySource, /十、争议解决/)
})

test('personal page exposes both agreement entries', () => {
  assert.match(mineSource, /用户协议/)
  assert.match(mineSource, /\/pages\/user-agreement\/user-agreement/)
  assert.match(mineSource, /隐私保护指引/)
  assert.match(mineSource, /\/pages\/privacy\/privacy/)
})

test('category page keeps browsing public and gates add-to-cart at the action', () => {
  assert.match(categorySource, /import LoginGuide from ['"]@\/components\/LoginGuide\.vue['"]/
  )
  assert.match(categorySource, /if \(!isLoggedIn\(\)\)/)
  assert.match(categorySource, /loginGuideVisible\.value = true/)
  assert.match(categorySource, /<LoginGuide v-model="loginGuideVisible" \/>/)
})

test('product detail loads profile only for logged-in users and gates account actions', () => {
  assert.match(detailSource, /import \{ getAuth, isLoggedIn, isRegisteredUser \} from ['"]@\/utils\/auth['"]/
  )
  assert.match(detailSource, /const productRequest = getProductDetail\(/)
  assert.match(detailSource, /const profileRequest = isLoggedIn\(\)\s*\?\s*getUserProfile\(\)/)
  assert.match(detailSource, /import LoginGuide from ['"]@\/components\/LoginGuide\.vue['"]/
  )
  assert.match(detailSource, /loginGuideVisible\.value = true/)
  assert.match(detailSource, /<LoginGuide v-model="loginGuideVisible" \/>/)
})

test('login guide exposes explicit cancel and login actions', () => {
  assert.match(loginGuideSource, />取消</)
  assert.match(loginGuideSource, /去登录/)
})

test('protected direct-entry pages gate before requesting account APIs', () => {
  assert.match(paymentSource, /import \{ isLoggedIn \} from ['"]@\/utils\/auth['"]/
  )
  assert.match(paymentSource, /if \(!isLoggedIn\(\)\)[\s\S]*?loginGuideVisible\.value = true/)
  assert.match(paymentSource, /<LoginGuide v-model="loginGuideVisible" \/>/)
  assert.match(orderDetailSource, /import \{ getAuth, isLoggedIn \} from ['"]@\/utils\/auth['"]/
  )
  assert.match(orderDetailSource, /if \(!isLoggedIn\(\)\)[\s\S]*?loginGuideVisible\.value = true/)
  assert.match(orderDetailSource, /<LoginGuide v-model="loginGuideVisible" \/>/)
  assert.match(invoiceSource, /import \{ isLoggedIn \} from ['"]@\/utils\/auth['"]/
  )
  assert.match(invoiceSource, /if \(!isLoggedIn\(\)\)[\s\S]*?loginGuideVisible\.value = true/)
  assert.match(invoiceSource, /<LoginGuide v-model="loginGuideVisible" \/>/)
})

test('personal page skips the protected profile request for guests', () => {
  assert.match(mineSource, /if \(!isLoggedIn\(\)\) \{[\s\S]*?user\.value = null[\s\S]*?return\n  \}/)
})
