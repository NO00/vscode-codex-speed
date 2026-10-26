const http = require('node:http');
const fs = require('node:fs');
const { DashboardHistory } = require('../../dist/src/dashboard/model');
const { dashboardHtml } = require('../../dist/src/dashboard/html');
const { dashboardMessages } = require('../../dist/src/dashboard/messages');
const { createTranslator } = require('../../dist/src/localization');
const { calculate } = require('../../dist/src/engine');
const { summarize, usageRange, validTimeZone } = require('../../dist/src/history/ranges');

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
function payload(selectedLanguage, selectedRange = 'today', selectedZone = 'Asia/Shanghai', scenario = '') {
  const locale = ['en', 'zh-cn', 'zh-tw'].includes(selectedLanguage) ? selectedLanguage : 'zh-cn';
  const t = createTranslator(locale, name => JSON.parse(fs.readFileSync(`l10n/bundle.l10n.${name}.json`, 'utf8')));
  // 固定的停止场景复现“曲线为零、上次调用为 13.3”问题，不读取真实日志。
  const stopped = ['tools', 'idle'].includes(scenario);
  const currentSessions = stopped ? [{ ...sessions[0], phase: scenario, pendingStart: undefined, lastEvent: now - 4000,
    samples: [{ key: 'stopped-call', start: now - 15000, end: now - 5000, output: 133, input: 1000, model: 'gpt-6-astra' }] }] : sessions;
  const currentSnapshot = stopped ? calculate(currentSessions, options, now) : snapshot;
  const currentHistory = stopped ? new DashboardHistory() : history;
  if (stopped) {
    for (const point of history.data(sessions, options, snapshot, now).points) {
      const quiet = point.time > now - 5000;
      currentHistory.record({ ...currentSnapshot, rate: quiet ? 0 : point.rate, kind: quiet ? currentSnapshot.kind : point.kind }, point.time);
    }
    currentHistory.record(currentSnapshot, now);
  }
  const records = currentSessions.flatMap(session => [...session.samples.map(sample => ({ ...sample, cwd: session.cwd, session: session.id })),
    ...[7200000, 2 * 86400000, 5 * 86400000, 12 * 86400000, 25 * 86400000].map((age, index) => ({ key: `${session.id}:old:${index}`, start: now - age - 10000, end: now - age,
      input: 50000, output: 3000, model: '', cwd: session.cwd, session: session.id }))]);
  const totals = summarize(records, usageRange(selectedRange), validTimeZone(selectedZone), options, now);
  return { data: currentHistory.data(currentSessions, options, currentSnapshot, now, totals), labels: dashboardMessages(t), locale, selectedLanguage,
    context: { host: 'ssh-remote / ubuntu', home: options.home, scope: 'all', notice: '', error: false, limited: false, enabled: true } };
}
const bridge = `(() => { let language='zh-cn',period='today',zone=Intl.DateTimeFormat().resolvedOptions().timeZone; let state; window.acquireVsCodeApi=()=>({getState:()=>state,setState:value=>{state=value;},postMessage:async message=>{if(message.type==='language')language=message.value;if(message.type==='usageRange')period=message.value;if(['ready','language','refresh','usageRange'].includes(message.type)){const response=await fetch('/api/data?language='+encodeURIComponent(language)+'&period='+period+'&zone='+encodeURIComponent(zone)+'&scene='+encodeURIComponent(new URLSearchParams(location.search).get('scene')||''));window.dispatchEvent(new MessageEvent('message',{data:{type:'update',payload:await response.json()}}));}}});document.addEventListener('DOMContentLoaded',()=>{const marker=document.createElement('p');marker.id='preview-marker';marker.textContent='显示预览 · 虚拟日志数据 / Preview · Sample data';marker.className='small muted';document.querySelector('.dashboard').prepend(marker);});})();`;
/** 固定路由，禁止将任意 URL 解析为磁盘路径；监听仅限本机回环地址。 */
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/data') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(payload(url.searchParams.get('language') || 'zh-cn', url.searchParams.get('period'), url.searchParams.get('zone'), url.searchParams.get('scene')))); return; }
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
