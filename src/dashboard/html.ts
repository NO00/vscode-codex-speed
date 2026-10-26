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
<header class="topbar"><div class="brand"><span class="brand-icon">ϟ</span><div><strong>CODEX SPEED</strong><span id="dashboard-title"></span></div></div><div class="header-actions"><button id="refresh" class="icon-button">↻</button><button id="settings" class="icon-button">⚙</button></div></header>
<section class="hero"><div class="gauge"><svg viewBox="0 0 180 180" aria-hidden="true"><defs><linearGradient id="dial-gradient"><stop stop-color="#45d7ac"/><stop offset="1" stop-color="#8aebc7"/></linearGradient></defs><circle class="dial-shadow" cx="90" cy="90" r="77"/><circle class="dial-track" cx="90" cy="90" r="66"/><circle id="dial-progress" cx="90" cy="90" r="66" stroke="url(#dial-gradient)" stroke-dasharray="0 415" transform="rotate(135 90 90)"/><g id="dial-ticks"></g><path id="needle" d="M88 91 L90 44 L93 91 Z"/><circle class="dial-center" cx="90" cy="90" r="5"/></svg><span class="dial-mark">tok/s</span></div><div class="hero-reading"><div class="eyebrow" id="live-label"></div><div class="rate-line"><span id="rate">—</span><span class="unit">tok/s</span></div><div class="phase"><span id="phase-dot" class="dot"></span><strong id="phase"></strong></div><p id="activity" class="muted"></p></div></section>
<div id="notice" class="notice" hidden></div>
<section class="section curve-section"><div class="section-heading"><h2 id="curve-title"></h2><div class="range-tabs" role="group"><button data-range="60" class="selected" id="range-60"></button><button data-range="120" id="range-120"></button><button data-range="300" id="range-300"></button></div></div><div class="chart"><svg id="chart" viewBox="0 0 600 178" role="img"></svg><div id="chart-empty" class="empty-chart" hidden></div></div><div class="chart-legend"><span><i class="legend-line"></i><span id="measured-label"></span></span><span><i class="legend-line dashed"></i><span id="estimated-label"></span></span></div><p id="curve-note" class="small muted"></p></section>
<section class="section"><div class="section-heading"><h2 id="source-title"></h2><span class="connection"><span class="dot"></span>Codex</span></div><div class="source-card"><div><span class="dot"></span><strong>Codex</strong><span id="source-note" class="muted small"></span></div><span id="source-output"></span></div></section>
<section class="section"><div class="section-heading"><h2 id="sessions-title"></h2><span id="sessions-count" class="badge"></span></div><div id="sessions" class="sessions"></div><p id="stale-note" class="small muted"></p></section>
<section class="section"><div class="section-heading"><h2 id="usage-title"></h2><span class="period-icon">◷</span></div><div class="metrics"><div class="metric"><span id="output-label"></span><strong id="output-value"></strong></div><div class="metric"><span id="input-label"></span><strong id="input-value"></strong></div><div class="metric"><span id="responses-label"></span><strong id="responses-value"></strong></div><div class="metric"><span id="average-label"></span><strong id="average-value"></strong></div></div><div class="peak-row"><span id="peak-label"></span><strong id="peak-value"></strong></div><p id="usage-note" class="small muted"></p></section>
<section class="section context"><dl><dt id="host-label"></dt><dd id="host-value"></dd><dt id="directory-label"></dt><dd id="directory-value"></dd><dt id="scope-label"></dt><dd id="scope-value"></dd></dl><div class="language-row"><label for="language" id="language-label"></label><select id="language"><option value="auto" id="language-auto"></option><option value="en">English</option><option value="zh-cn">简体中文</option><option value="zh-tw">繁體中文</option></select></div></section>
<footer><p id="estimate-note"></p><p id="last-note" hidden></p><div class="footer-line"><span id="updated"></span><span id="privacy-note"></span></div></footer>
</main><script nonce="${attribute(resources.nonce)}" src="${attribute(resources.script)}"></script></body></html>`;
}
