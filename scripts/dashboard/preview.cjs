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
  samples: Array.from({ length: 24 }, (_, item) => ({ key: `${name}:${item}`, start: now - 720000 + item * 30000 + index * 1500,
    end: now - 720000 + item * 30000 + index * 1500 + 8000 + item % 4 * 2000, output: 500 + (item % 5) * 160 + index * 120, input: 11000 + item * 170,
    inputKnown: true, cachedInput: 8000 + item * 100, model: index === 1 ? 'gpt-6.1-sol' : 'gpt-6-astra' }))
}));
const history = new DashboardHistory();
/** 生成与真实 Webview 相同的数据及翻译，只改变日志来源为虚拟记录。 */
function payload(selectedLanguage, selectedRange = 'today', selectedZone = 'Asia/Shanghai', scenario = '') {
  const locale = ['en', 'zh-cn', 'zh-tw'].includes(selectedLanguage) ? selectedLanguage : 'zh-cn';
  const t = createTranslator(locale, name => JSON.parse(fs.readFileSync(`l10n/bundle.l10n.${name}.json`, 'utf8')));
  // 完成记录、等待、工具、缺少耗时和首次调用场景均只使用虚拟日志计数。
  const stopped = ['tools', 'idle'].includes(scenario);
  let currentSessions = stopped ? [{ ...sessions[0], phase: scenario, pendingStart: undefined, lastEvent: now - 4000,
    samples: [{ key: 'stopped-call', start: now - 15000, end: now - 5000, output: 133, input: 1000, model: 'gpt-6-astra' }] }] : sessions;
  if (['first', 'unknown', 'counted'].includes(scenario)) {
    currentSessions = [{ ...sessions[0], phase: 'generating', pendingStart: now - 300, lastEvent: now - 100,
      samples: scenario === 'first' ? [] : [{ key: 'scenario-call', start: scenario === 'unknown' ? undefined : now - 10500, end: now - 500, output: 270, input: 1000, model: 'gpt-6-astra' }] }];
  }
  if (['reconcile', 'corrected'].includes(scenario)) {
    currentSessions = [{ ...sessions[0], phase: scenario === 'corrected' ? 'tools' : 'generating', pendingStart: now - (scenario === 'corrected' ? 2000 : 20000), lastEvent: now - 1000,
      samples: [{ key: 'reference', start: now - 50000, end: now - 40000, output: 300, input: 1000, model: 'gpt-6-astra' },
        ...(scenario === 'corrected' ? [{ key: 'late-usage', start: now - 20000, end: now - 2000, output: 900, input: 1000, model: 'gpt-6-astra' }] : [])] }];
  }
  if (scenario === 'partial-cost') currentSessions = [{ ...sessions[0], samples: [
    { key: 'known', start: now - 2000, end: now - 1000, input: 100000, inputKnown: true, cachedInput: 80000, output: 10000, model: 'gpt-6.1-sol' },
    { key: 'missing-cache', start: now - 2000, end: now - 1000, input: 100000, inputKnown: true, output: 10000, model: 'gpt-6.1-sol' },
    { key: 'unknown-model', start: now - 2000, end: now - 1000, input: 100000, inputKnown: true, cachedInput: 80000, output: 10000, model: 'private-model' }
  ] }];
  if (scenario === 'tiny-cost') currentSessions = [{ ...sessions[0], samples: [{ key: 'tiny', start: now - 2000, end: now - 1000, input: 1, inputKnown: true, cachedInput: 0, output: 0, model: 'gpt-6.1-sol' }] }];
  const currentSnapshot = calculate(currentSessions, options, now);
  const records = currentSessions.flatMap(session => [...session.samples.map(sample => ({ ...sample, cwd: session.cwd, session: session.id })),
    ...[7200000, 2 * 86400000, 5 * 86400000, 12 * 86400000, 25 * 86400000].map((age, index) => ({ key: `${session.id}:old:${index}`, start: now - age - 10000, end: now - age,
      input: 50000, inputKnown: true, cachedInput: 40000, output: 3000, model: session.model, cwd: session.cwd, session: session.id }))]);
  const totals = summarize(records, usageRange(selectedRange), validTimeZone(selectedZone), options, now);
  return { data: history.data(currentSessions, options, currentSnapshot, now, totals), labels: dashboardMessages(t), locale, selectedLanguage,
    context: { host: 'ssh-remote / ubuntu', home: options.home, scope: 'all', notice: '', error: false, limited: false, enabled: true } };
}
const bridge = `(() => {
  let language='zh-cn',period='today',zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  let scenario=new URLSearchParams(location.search).get('scene')||'',state;
  async function update(){
    const response=await fetch('/api/data?language='+encodeURIComponent(language)+'&period='+period+'&zone='+encodeURIComponent(zone)+'&scene='+encodeURIComponent(scenario));
    window.dispatchEvent(new MessageEvent('message',{data:{type:'update',payload:await response.json()}}));
  }
  window.acquireVsCodeApi=()=>({getState:()=>state,setState:value=>{state=value;},postMessage:async message=>{
    if(message.type==='language')language=message.value;
    if(message.type==='usageRange')period=message.value;
    if(['ready','language','refresh','usageRange'].includes(message.type))await update();
  }});
  document.addEventListener('DOMContentLoaded',()=>{
    const marker=document.createElement('p');marker.id='preview-marker';marker.textContent='显示预览 · 虚拟日志数据 / Preview · Sample data';marker.className='small muted';document.querySelector('.dashboard').prepend(marker);
    if(scenario==='reconcile'){
      const button=document.createElement('button');button.id='preview-complete';button.textContent='模拟完成计数 / Simulate completion';
      button.onclick=async()=>{scenario='corrected';button.disabled=true;await update();};marker.append(document.createTextNode(' · '),button);
    }
  });
})();`;
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
