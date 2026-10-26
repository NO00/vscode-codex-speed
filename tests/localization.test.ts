import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { createTranslator, formatMessage, resolveLanguage } from '../src/localization';

/** 提取实际运行时代码的翻译调用，避免只验证翻译文件自己的一致性。 */
function runtimeMessages(): Set<string> {
  const messages = new Set<string>();
  for (const file of ['src/extension.ts', 'src/monitor.ts']) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
    /** 递归寻找 t(...) 与 this.t(...)；翻译消息必须为可静态提取的字面量。 */
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && (ts.isIdentifier(node.expression) && node.expression.text === 't' || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't')) {
        const argument = node.arguments[0];
        assert.ok(argument && ts.isStringLiteral(argument), `翻译消息必须使用字面量：${file}`);
        messages.add(argument.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return messages;
}

/** 保留占位符出现次数，防止翻译漏掉速度、路径或计数。 */
function placeholders(message: string): string[] { return (message.match(/\{\d+\}/g) ?? []).sort(); }

for (const locale of ['zh-cn', 'zh-tw']) {
  test(`${locale} 完整覆盖运行时提示并保留全部参数`, () => {
    const bundle: Record<string, string> = JSON.parse(fs.readFileSync(`l10n/bundle.l10n.${locale}.json`, 'utf8'));
    assert.deepEqual(Object.keys(bundle).sort(), [...runtimeMessages()].sort());
    for (const [message, translation] of Object.entries(bundle)) {
      assert.ok(translation.trim());
      assert.deepEqual(placeholders(translation), placeholders(message), message);
    }
  });
}

test('清单中的命令、设置说明和枚举均有英文及两种中文翻译', () => {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const keys = [...JSON.stringify(manifest).matchAll(/%([\w.]+)%/g)].map(match => match[1]!);
  assert.ok(keys.length >= 13);
  for (const suffix of ['', '.zh-cn', '.zh-tw']) {
    const bundle = JSON.parse(fs.readFileSync(`package.nls${suffix}.json`, 'utf8'));
    assert.deepEqual(Object.keys(bundle).sort(), [...keys].sort());
    for (const key of keys) assert.ok(typeof bundle[key] === 'string' && bundle[key].trim(), key);
  }
  assert.equal(manifest.l10n, './l10n');
});

test('无编辑器回放使用英文并安全保留路径中的特殊字符', () => {
  assert.equal(formatMessage('Host: {0}; count: {1}', '/tmp/$&/{1}', 0), 'Host: /tmp/$&/{1}; count: 0');
  assert.equal(formatMessage('Missing {0}'), 'Missing {0}');
});

test('手动语言覆盖客户端语言，未知语言回退英文且不会读取任意路径', () => {
  assert.equal(resolveLanguage('auto', 'zh-cn'), 'zh-cn');
  assert.equal(resolveLanguage('auto', 'zh-tw'), 'zh-tw');
  assert.equal(resolveLanguage('auto', 'de'), 'en');
  assert.equal(resolveLanguage('en', 'zh-cn'), 'en');
  assert.equal(resolveLanguage('../../secret', 'zh-cn'), 'en');
  const english = createTranslator('en', () => { throw new Error('英文无需加载文件'); });
  assert.equal(english('Last'), 'Last');
  for (const locale of ['zh-cn', 'zh-tw']) {
    const translate = createTranslator(locale, name => JSON.parse(fs.readFileSync(`l10n/bundle.l10n.${name}.json`, 'utf8')));
    assert.equal(translate('Last'), '上次');
    assert.equal(translate('Diagnostic log file: {0}', '/tmp/$&/log'), `${locale === 'zh-cn' ? '诊断日志文件' : '診斷日誌檔案'}：/tmp/$&/log`);
    assert.equal(translate('Unknown {0}', 7), 'Unknown 7');
  }
});
