const fs = require('node:fs');
const ts = require('typescript');
const assert = require('node:assert/strict');

/** 从真实调用中提取键，只补入显式提供的翻译；缺失翻译时不覆盖原文件。 */
const keys = new Set();
for (const file of ['src/extension.ts', 'src/monitor.ts', 'src/dashboard/messages.ts']) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  /** t(...) 与 this.t(...) 都必须使用静态消息，以便检查覆盖及参数。 */
  function visit(node) {
    if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === 't' || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't')) {
      assert.ok(ts.isStringLiteral(node.arguments[0]), `翻译键必须是字面量：${file}`);
      keys.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const additions = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : {};
const output = [];
for (const locale of ['zh-cn', 'zh-tw']) {
  const file = `l10n/bundle.l10n.${locale}.json`;
  const old = JSON.parse(fs.readFileSync(file, 'utf8'));
  const catalog = Object.fromEntries([...keys].map(key => {
    const value = additions[locale]?.[key] ?? old[key];
    assert.ok(typeof value === 'string' && value.trim(), `${locale} 缺少翻译：${key}`);
    return [key, value];
  }));
  output.push([file, catalog]);
}
for (const [file, catalog] of output) fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + '\n');
console.log(`已同步两份中文资源，各 ${keys.size} 条，未使用的词条已移除。`);
