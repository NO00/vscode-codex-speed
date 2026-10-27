/** 由宿主或视觉预览提供本地资源 URI，不在 HTML 中插入日志数据。 */
export interface DashboardResources {
  /** 样式表资源地址。 */
  css: string;
  /** 脚本资源地址。 */
  script: string;
  /** VS Code 本地资源的内容安全来源。 */
  source: string;
  /** 每次创建页面生成的随机令牌。 */
  nonce: string;
}

/** HTML 属性转义，避免资源路径中的特殊字符影响标签结构。 */
function attribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/** 原生 Webview 与预览使用同一份结构，所有动态内容由脚本以 textContent 更新。 */
export function dashboardHtml(resources: DashboardResources): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${attribute(resources.source)}; script-src 'nonce-${attribute(resources.nonce)}'; font-src ${attribute(resources.source)};">
<link rel="stylesheet" href="${attribute(resources.css)}"><title>Codex Speed</title></head><body>
<main class="dashboard">
<header class="topbar">
  <div class="brand"><span class="brand-icon" aria-hidden="true">&gt;_</span><div><strong>CODEX<span class="brand-slash">/</span>SPEED</strong><span id="dashboard-title"></span></div></div>
  <div class="header-actions"><label for="language" id="language-label" class="sr-only"></label><select id="language"><option value="auto" id="language-auto"></option><option value="en">English</option><option value="zh-cn">简体中文</option><option value="zh-tw">繁體中文</option></select><button id="refresh" class="icon-button">↻</button><button id="settings" class="icon-button">⚙</button></div>
</header>
<div class="connection-strip"><span class="connection-signal" aria-hidden="true"></span><span id="source-note"></span><span class="connection-divider">/</span><code id="connection-host"></code><span id="updated"></span></div>
<div id="notice" class="notice" hidden></div>
<section class="overview">
  <div class="reading-panel"><div class="eyebrow"><span class="section-index">01</span><span id="live-label"></span></div><div class="rate-line"><span id="rate">—</span><span class="unit">tok/s</span></div><div class="phase"><span id="phase-dot" class="dot"></span><strong id="phase"></strong></div><p id="activity" class="muted"></p><p id="estimate-breakdown" hidden></p><p id="last-note" class="small muted" hidden></p><div class="peak-reading"><span id="peak-label"></span><strong id="peak-value"></strong></div></div>
  <div class="trend-panel"><div class="section-heading"><h2 id="curve-title"></h2><div class="range-tabs" role="group"><button data-range="60" class="selected" id="range-60"></button><button data-range="120" id="range-120"></button><button data-range="300" id="range-300"></button></div></div><div class="chart"><svg id="chart" viewBox="0 0 600 190" role="img"></svg><div id="chart-empty" class="empty-chart" hidden></div></div><div class="chart-bottom"><p id="curve-note" class="small muted"></p><div class="chart-legend"><span><i class="legend-line"></i><span id="measured-label"></span></span><span><i class="legend-line dashed"></i><span id="estimated-label"></span></span></div></div></div>
</section>
<section class="section usage-panel"><div class="section-heading"><div class="heading-title"><span class="section-index">02</span><h2 id="usage-title"></h2></div><div class="usage-controls"><span id="usage-timezone" class="small muted"></span><select id="usage-range"><option value="30m" id="usage-30m"></option><option value="today" id="usage-today"></option><option value="7d" id="usage-7d"></option><option value="30d" id="usage-30d"></option></select></div></div><p id="history-status" class="small history-status" hidden></p><div class="metrics"><div class="metric primary-metric"><span id="output-label"></span><strong id="output-value"></strong><span class="metric-marker" aria-hidden="true">OUT</span></div><div class="metric"><span id="input-label"></span><strong id="input-value"></strong><span class="metric-marker" aria-hidden="true">IN</span></div><div class="metric"><span id="responses-label"></span><strong id="responses-value"></strong><span class="metric-marker" aria-hidden="true">REQ</span></div><div class="metric"><span id="average-label"></span><strong id="average-value"></strong><span class="metric-marker" aria-hidden="true">AVG</span></div></div><p id="usage-note" class="small muted"></p><p id="history-note" class="small muted"></p></section>
<section class="section cost-panel" aria-labelledby="cost-title"><div class="section-heading"><div class="heading-title"><span class="section-index">03</span><h2 id="cost-title"></h2></div><span id="cost-period" class="badge"></span></div><div class="cost-overview"><div><span id="cost-state" class="small muted"></span><strong id="cost-total">—</strong><span class="small muted">USD</span></div><div class="cost-meta small muted"><span id="cost-coverage"></span><span id="cost-price-date"></span></div></div><div class="cost-parts"><div><span id="cost-ordinary-label"></span><strong id="cost-ordinary">—</strong></div><div><span id="cost-cached-label"></span><strong id="cost-cached">—</strong></div><div><span id="cost-output-label"></span><strong id="cost-output">—</strong></div></div><div id="cost-models"></div><p id="cost-warning" class="small history-status" hidden></p><p id="cost-note" class="small muted"></p><button id="cost-settings" class="text-button"></button></section>
<section class="section activity-panel"><div class="section-heading"><div class="heading-title"><span class="section-index">04</span><h2 id="sessions-title"></h2></div><span id="sessions-count" class="badge"></span></div><div class="session-columns" aria-hidden="true"><span id="session-name-heading"></span><span id="session-model-heading"></span><span id="session-output-heading"></span><span id="session-rate-heading"></span></div><div id="sessions" class="sessions"></div><p id="stale-note" class="small muted"></p></section>
<details class="connection-details"><summary><span class="heading-title"><span class="connection-chevron" aria-hidden="true">›</span><span id="connection-title"></span></span><span class="source-chip">Codex JSONL</span></summary><dl><dt id="host-label"></dt><dd id="host-value"></dd><dt id="directory-label"></dt><dd id="directory-value"></dd><dt id="scope-label"></dt><dd id="scope-value"></dd><dt id="timezone-label"></dt><dd id="timezone-value"></dd></dl></details>
<footer><p id="estimate-note"></p><span id="privacy-note"></span></footer>
</main><script nonce="${attribute(resources.nonce)}" src="${attribute(resources.script)}"></script></body></html>`;
}
