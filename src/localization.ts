/** 与 VS Code 原生翻译函数兼容的最小接口，便于监控层在无编辑器环境下回放。 */
export type Translate = (message: string, ...args: (string | number)[]) => string;

/** 独立回放默认保留英文；实际运行由扩展入口注入 vscode.l10n.t。 */
export const formatMessage: Translate = (message, ...args) => message.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(args[Number(index)] ?? placeholder));

/** 手动语言选项仅接受随扩展发布的固定目录，禁止由配置拼接任意文件路径。 */
export function resolveLanguage(configured: string, clientLanguage: string): string {
  const selected = configured === 'auto' ? clientLanguage.toLowerCase() : configured;
  return selected === 'zh-cn' || selected === 'zh-tw' ? selected : 'en';
}

/** 使用同一组原生翻译资源实现手动覆盖，英文及缺失词条回退到源文本。 */
export function createTranslator(language: string, loadBundle: (locale: string) => Record<string, string>): Translate {
  const locale = resolveLanguage(language, 'en');
  const bundle = locale === 'en' ? {} : loadBundle(locale);
  return (message, ...args) => formatMessage(bundle[message] || message, ...args);
}
