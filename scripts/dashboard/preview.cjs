const http = require('node:http');
const fs = require('node:fs');
const { DashboardHistory } = require('../../dist/src/dashboard/model');
const { dashboardHtml } = require('../../dist/src/dashboard/html');
const { dashboardMessages } = require('../../dist/src/dashboard/messages');
const { createTranslator } = require('../../dist/src/localization');
const { calculate } = require('../../dist/src/engine');

/** 完全虚拟的本地演示记录，不读取用户的 Codex 目录或认证信息。 */
const now = Date.now();
const options = { home: '/home/ubuntu/.codex', scope: 'all', workspaces: [], showEstimates: true, scanDays: 3, pollIntervalMs: 1000 };
const sessions = ['vscode-codex-speed', 'api-service', 'docs'].map((name, index) => ({
  file: `/preview/${name}.jsonl`, id: name, cwd: `/workspace/${name}`, model: index === 1 ? 'gpt-6.1-sol' : 'gpt-6-astra',
  phase: ['generating', 'tools', 'idle'][index], pendingStart: now - 5000, lastEvent: now - (index === 2 ? 400000 : 1000),
  samples: Array.from({ length: 24 }, (_, item) => ({ key: `${name}:${item}`, start: now - 1500000 + item * 60000,
    end: now - 1500000 + item * 60000 + 12000, output: 500 + (item % 5) * 160 + index * 120, input: 11000 + item * 170, model: index === 1 ? 'gpt-6.1-sol' : 'gpt-6-astra' }))
}));
const snapshot = calculate(sessions, options, now);
const history = new DashboardHistory();
for (let index = 0; index <= 300; index++) {
  const rate = index % 83 < 9 ? 0 : Math.max(0, 50 + Math.sin(index / 14) * 24 + Math.cos(index / 5) * 8);
  history.record({ ...snapshot, rate, kind: index % 45 > 28 ? 'estimated' : 'measured' }, now - (300 - index) * 1000);
}
history.record(snapshot, now);
/** 生成与真实 Webview 相同的数据及翻译，只改变日志来源为虚拟记录。 */
function payload(selectedLanguage) {
  const locale = ['en', 'zh-cn', 'zh-tw'].includes(selectedLanguage) ? selectedLanguage : 'zh-cn';
  const t = createTranslator(locale, name => JSON.parse(fs.readFileSync(`l10n/bundle.l10n.${name}.json`, 'utf8')));
  return { data: history.data(sessions, options, snapshot, now), labels: dashboardMessages(t), locale, selectedLanguage,
    context: { host: 'ssh-remote / ubuntu', home: options.home, scope: 'all', notice: '', error: false, limited: false, enabled: true } };
}
const bridge = `(() => { let language='zh-cn'; let state; window.acquireVsCodeApi=()=>({getState:()=>state,setState:value=>{state=value;},postMessage:async message=>{if(message.type==='language')language=message.value;if(['ready','language','refresh'].includes(message.type)){const response=await fetch('/api/data?language='+encodeURIComponent(language));window.dispatchEvent(new MessageEvent('message',{data:{type:'update',payload:await response.json()}}));}}});document.addEventListener('DOMContentLoaded',()=>{const marker=document.createElement('p');marker.id='preview-marker';marker.textContent='显示预览 · 虚拟日志数据 / Preview · Sample data';marker.className='small muted';document.querySelector('.dashboard').prepend(marker);});})();`;
/** 固定路由，禁止将任意 URL 解析为磁盘路径；监听仅限本机回环地址。 */
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/data') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload(url.searchParams.get('language') || 'zh-cn'))); return; }
  if (url.pathname === '/preview-bridge.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bridge); return; }
  if (['/dashboard.css', '/dashboard.js'].includes(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('css') ? 'text/css' : 'text/javascript');
    response.end(fs.readFileSync(`assets/dashboard${url.pathname}`)); return;
  }
  if (url.pathname !== '/') { response.statusCode = 404; response.end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  const html = dashboardHtml({ css: '/dashboard.css', script: '/dashboard.js', source: "'self'", nonce: 'local-preview' })
    .replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
    .replace('</head>', '<script nonce="local-preview" src="/preview-bridge.js"></script></head>');
  response.end(html);
});
server.listen(4187, '127.0.0.1', () => console.log('仪表盘预览：http://127.0.0.1:4187（虚拟日志数据；与实际插件共用 HTML/CSS/JS）'));
