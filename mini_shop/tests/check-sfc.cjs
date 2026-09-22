/**
 * SFC 语法自检脚本（替代 HBuilderX 编译，用于本地回归）
 *
 * 项目是 HBuilderX-only，没有 CLI 构建，改完 .vue 无法用命令验证语法。
 * 这里借用 PC 后台（`../admin`）pnpm 虚拟 store 里的 `@vue/compiler-sfc`，
 * 对指定 .vue 做 parse + compileScript + compileTemplate，确认解析与编译都不报错。
 *
 * 用法（在 mini_shop 目录下）：
 *   node tests/check-sfc.cjs pages/user-agreement/user-agreement.vue pages/privacy/privacy.vue
 *
 * ⚠️ 依赖 admin 的 node_modules 存在且装了 vue 3.x；缺失时脚本会明确报路径错误，
 *    不会静默"全通过"。
 */
const path = require('path')
const fs = require('fs')

/** admin 的 @vue/compiler-sfc 入口（pnpm 虚拟 store 路径，版本随 admin 的 vue 版本走）。 */
const COMPILER_SFC_PATH = 'E:/work/JJ/LonPin/admin/node_modules/.pnpm/@vue+compiler-sfc@3.5.40/node_modules/@vue/compiler-sfc'

if (!fs.existsSync(COMPILER_SFC_PATH)) {
  console.error('[check-sfc] 找不到 @vue/compiler-sfc：' + COMPILER_SFC_PATH)
  console.error('[check-sfc] 请确认 admin 已安装依赖，或把路径改成实际存在的版本目录。')
  process.exit(2)
}

const compiler = require(COMPILER_SFC_PATH)

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node scripts/check-sfc.cjs <file.vue> [...]')
  process.exit(2)
}

let failed = 0
for (const file of files) {
  const absolute = path.resolve(file)
  const source = fs.readFileSync(absolute, 'utf8')
  const id = path.basename(absolute)
  try {
    const { descriptor, errors } = compiler.parse(source, { filename: absolute })
    if (errors && errors.length) {
      throw new Error('parse: ' + errors.map((e) => e.message || String(e)).join(' | '))
    }
    if (descriptor.scriptSetup || descriptor.script) {
      const scriptResult = compiler.compileScript(descriptor, { id })
      if (!scriptResult) throw new Error('compileScript returned empty')
    }
    if (descriptor.template) {
      const templateResult = compiler.compileTemplate({
        source: descriptor.template.content,
        filename: absolute,
        id,
        compilerOptions: { mode: 'module' },
      })
      if (templateResult.errors && templateResult.errors.length) {
        throw new Error('template: ' + templateResult.errors.map((e) => e.message || String(e)).join(' | '))
      }
    }
    console.log('OK   ' + file)
  } catch (error) {
    failed += 1
    console.log('FAIL ' + file + ' -> ' + (error && error.message ? error.message : String(error)))
  }
}

process.exit(failed === 0 ? 0 : 1)
