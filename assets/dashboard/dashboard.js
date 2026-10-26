/* 仪表盘脚本只消费元数据；不会发起网络请求、执行日志内容或直接访问文件。 */
(() => {
  const api = acquireVsCodeApi();
  const saved = api.getState();
  let range = [60, 120, 300].includes(saved?.range) ? saved.range : 60;
  let latest;
  const namespace = 'http://www.w3.org/2000/svg';
  /** 仅使用纯文本写入用户目录、模型和翻译，避免日志字段成为可执行 HTML。 */
  function text(id, value) { document.getElementById(id).textContent = value; }
  /** 创建具有有限 SVG 属性的图形节点。 */
  function svg(tag, attributes, content) {
    const node = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (content !== undefined) node.textContent = content;
    return node;
  }
  /** 按当前手动选择的语言格式化数量，悬停可查看完整计数。 */
  function number(value, compact = false) {
    return new Intl.NumberFormat(latest.locale, { notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(value);
  }
  /** 根据当前时间窗口绘图；断档留空，估算段使用虚线，绝不补造离线历史。 */
  function drawChart() {
    const { data, labels } = latest;
    const chart = document.getElementById('chart');
    const start = data.now - range * 1000;
    const points = data.points.filter(point => point.time >= start && point.time <= data.now);
    const max = Math.max(10, Math.ceil(Math.max(...points.map(point => point.rate), 0) / 25) * 25);
    const width = Math.max(240, chart.getBoundingClientRect().width);
    chart.setAttribute('viewBox', `0 0 ${width} 190`);
    const left = 33, right = width - 7, top = 18, bottom = 161;
    const x = point => left + (point.time - start) / (range * 1000) * (right - left);
    const y = point => bottom - point.rate / max * (bottom - top);
    chart.replaceChildren();
    chart.setAttribute('aria-label', labels.chartLabel);
    const defs = svg('defs', {}), gradient = svg('linearGradient', { id: 'trend-fill', x1: 0, y1: 0, x2: 0, y2: 1 });
    gradient.append(svg('stop', { offset: 0, 'stop-color': 'var(--accent)', 'stop-opacity': .2 }), svg('stop', { offset: 1, 'stop-color': 'var(--accent)', 'stop-opacity': 0 }));
    defs.append(gradient); chart.append(defs);
    for (let index = 0; index <= 3; index++) {
      const ordinate = top + index * (bottom - top) / 3;
      chart.append(svg('line', { x1: left, y1: ordinate, x2: right, y2: ordinate, class: 'grid-line' }), svg('text', { x: 0, y: ordinate + 3 }, number(max * (1 - index / 3))));
    }
    for (const fraction of [0, .5, 1]) {
      chart.append(svg('text', { x: left + fraction * (right - left), y: 184, 'text-anchor': fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle' }, fraction === 1 ? labels.now : `−${number(range * (1 - fraction))}s`));
    }
    // 面积底色只覆盖已观测的连续片段，不横跨离线断档。
    const segments = [];
    for (const point of points) {
      const segment = segments.at(-1);
      if (!segment || point.time - segment.at(-1).time > 15000) segments.push([point]);
      else segment.push(point);
    }
    for (const segment of segments) if (segment.length > 1) {
      const area = `M${x(segment[0])},${bottom} ` + segment.map(point => `L${x(point)},${y(point)}`).join(' ') + ` L${x(segment.at(-1))},${bottom} Z`;
      chart.append(svg('path', { d: area, fill: 'url(#trend-fill)' }));
    }
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1], point = points[index];
      if (point.time - previous.time > 15000) continue;
      chart.append(svg('path', { d: `M${x(previous)},${y(previous)} L${x(point)},${y(point)}`, class: `speed-line${point.kind === 'estimated' || previous.kind === 'estimated' ? ' estimated' : ''}` }));
    }
    if (points.length) {
      const point = points[points.length - 1];
      chart.append(svg('circle', { cx: x(point), cy: y(point), r: 3, fill: point.kind === 'estimated' ? 'var(--estimate)' : 'var(--accent)' }));
    }
    document.getElementById('chart-empty').hidden = points.length >= 2;
    text('chart-empty', labels.collecting);
    for (const button of document.querySelectorAll('[data-range]')) {
      const selected = Number(button.dataset.range) === range;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }
  /** 会话列表以元数据构造 DOM，不使用 innerHTML。 */
  function drawSessions() {
    const { data, labels } = latest;
    const container = document.getElementById('sessions');
    const scroll = container.scrollTop;
    container.replaceChildren();
    text('sessions-count', `${data.sessions.length} ${labels.totalSessions}`);
    if (!data.sessions.length) {
      const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = labels.noSessions; container.append(empty);
    }
    for (const [index, session] of data.sessions.entries()) {
      const row = document.createElement('div'); row.className = 'session';
      const info = document.createElement('div'); info.className = 'session-identity';
      const ordinal = document.createElement('span'); ordinal.className = 'session-index'; ordinal.textContent = String(index + 1).padStart(2, '0'); ordinal.setAttribute('aria-hidden', 'true');
      const identity = document.createElement('div');
      const name = document.createElement('span'); name.className = 'session-name'; name.textContent = session.name || labels.unnamed; name.title = session.cwd || session.id;
      const key = document.createElement('span'); key.className = 'session-key'; key.textContent = `# ${session.id.includes('/') || session.id.includes('\\') ? session.id.split(/[\\/]/).at(-1).slice(-12) : session.id.slice(0, 8)}`;
      identity.append(name, key); info.append(ordinal, identity);
      const model = document.createElement('span'); model.className = 'session-model'; model.textContent = session.model || labels.unknownModel; model.title = model.textContent;
      const usage = document.createElement('div'); usage.className = 'session-usage';
      const output = document.createElement('span'); output.className = 'session-output'; output.textContent = number(session.output, true); output.title = `${number(session.output)} ${labels.outputUnit}`; output.dataset.unit = labels.outputUnit;
      const counts = document.createElement('span'); counts.className = 'session-counts'; counts.textContent = `${number(session.responses)} ${labels.requestUnit}`;
      usage.append(output, document.createTextNode(' '), counts);
      const value = document.createElement('div'); value.className = 'session-speed';
      const rate = document.createElement('div'); rate.className = 'session-rate'; rate.textContent = `${session.kind === 'estimated' ? '~' : ''}${session.rate.toFixed(1)} tok/s`;
      const phase = document.createElement('div'); phase.className = 'session-phase';
      const label = document.createElement('span'); label.textContent = labels[session.phase];
      const meter = svg('svg', { viewBox: '0 0 100 3', class: `session-meter ${session.kind}`, 'aria-hidden': 'true' });
      const fraction = Math.max(0, Math.min(1, session.rate / Math.max(100, data.usage.peak, data.snapshot.rate)));
      meter.append(svg('rect', { x: 0, y: 0, width: 100, height: 3, class: 'track' }), svg('rect', { x: 0, y: 0, width: fraction * 100, height: 3, class: 'progress' }));
      phase.append(label); value.append(rate, phase, meter); row.append(info, model, usage, value); container.append(row);
    }
    container.scrollTop = scroll;
  }
  /** 更新监控台，沿用 VS Code 主题颜色及用户选择的语言。 */
  function render(payload) {
    latest = payload;
    const { data, labels, context } = payload, snapshot = data.snapshot;
    document.documentElement.lang = payload.locale;
    const mapping = { 'dashboard-title': 'console', 'live-label': 'live', 'curve-title': 'curve', 'range-60': 'oneMinute', 'range-120': 'twoMinutes', 'range-300': 'fiveMinutes', 'measured-label': 'measured', 'estimated-label': 'estimated', 'curve-note': 'curveNote', 'source-note': 'sourceNote', 'sessions-title': 'sessions', 'usage-title': 'usage', 'output-label': 'output', 'input-label': 'input', 'responses-label': 'responses', 'average-label': 'average', 'peak-label': 'peak', 'usage-note': 'usageNote', 'host-label': 'host', 'directory-label': 'directory', 'scope-label': 'scope', 'language-label': 'language', 'language-auto': 'auto', 'estimate-note': 'estimateNote', 'last-note': 'lastNote', 'stale-note': 'stale', 'privacy-note': 'noCosts', 'connection-title': 'connection', 'session-name-heading': 'sessions', 'session-model-heading': 'model', 'session-output-heading': 'output', 'session-rate-heading': 'rate', 'timezone-label': 'timeZone' };
    for (const [id, key] of Object.entries(mapping)) text(id, labels[key]);
    for (const [value, key] of [['30m', 'last30m'], ['today', 'today'], ['7d', 'last7d'], ['30d', 'last30d']]) text(`usage-${value}`, labels[key]);
    const period = document.getElementById('usage-range');
    period.value = data.usage.range; period.setAttribute('aria-label', labels.usageRange);
    text('history-note', labels.historyNote);
    text('timezone-value', data.usage.timeZone);
    text('usage-timezone', `${labels.timeZone}: ${data.usage.timeZone}`);
    text('stale-note', `${labels.stale} ${labels.sessionPeriod}`);
    const history = data.history;
    const indexing = history.indexing ? `${context.enabled ? labels.indexing : labels.incomplete} · ${number(history.scanned)} / ${number(history.total)} ${labels.indexedFiles}. ${labels.incomplete}` : '';
    const warnings = [indexing, history.limited || history.readErrors ? `${labels.historyPartial} ${labels.incomplete}` : '', history.cacheError ? labels.cacheError : '', history.cacheReset ? labels.cacheReset : ''].filter(Boolean);
    text('history-status', warnings.join(' ')); document.getElementById('history-status').hidden = !warnings.length;
    for (const id of ['refresh', 'settings']) { document.getElementById(id).title = labels[id]; document.getElementById(id).setAttribute('aria-label', labels[id]); }
    const phase = context.error ? 'error' : snapshot.kind;
    document.body.dataset.state = !context.enabled ? 'disabled' : phase;
    text('rate', context.error || !context.enabled ? '—' : `${snapshot.kind === 'estimated' ? '~' : ''}${snapshot.rate.toFixed(1)}`);
    document.getElementById('rate').dataset.digits = document.getElementById('rate').textContent.length > 6 ? 'long' : 'normal';
    text('phase', !context.enabled ? labels.disabled : labels[phase]);
    document.getElementById('phase-dot').className = `dot ${phase === 'tools' ? 'tools' : ['idle', 'error'].includes(phase) ? 'idle' : ''}`;
    text('activity', `${labels.generating} ${number(snapshot.active)} · ${labels.tools} ${number(data.sessions.filter(session => session.phase === 'tools').length)}`);
    const notice = [!context.enabled ? labels.disabled : context.notice, context.limited ? labels.partial : ''].filter(Boolean).join(' ');
    text('notice', notice); document.getElementById('notice').hidden = !notice; document.getElementById('notice').classList.toggle('error', context.error);
    for (const key of ['output', 'input', 'responses']) { text(`${key}-value`, number(data.usage[key], true)); document.getElementById(`${key}-value`).title = number(data.usage[key]); }
    text('average-value', `${data.usage.average.toFixed(1)} tok/s`); text('peak-value', `${data.usage.peak.toFixed(1)} tok/s`);
    text('connection-host', context.host); text('host-value', context.host); text('directory-value', context.home); text('scope-value', context.scope === 'all' ? labels.all : labels.workspace);
    text('updated', `${labels.updated} ${new Date(data.now).toLocaleTimeString(payload.locale, { hour12: false })}`);
    // 上次调用独立展示并附时间，不参与当前读数或曲线；缺失耗时不得编造速度。
    const last = snapshot.latest;
    const hasLast = last && last.start !== undefined && last.end > last.start && last.end <= data.now;
    text('last-note', hasLast ? `${labels.lastNote}: ${(last.output * 1000 / (last.end - last.start)).toFixed(1)} tok/s · ${new Date(last.end).toLocaleTimeString(payload.locale, { hour12: false })}` : '');
    document.getElementById('last-note').hidden = !hasLast || !context.enabled || context.error;
    document.getElementById('language').value = payload.selectedLanguage;
    drawChart(); drawSessions();
    // 只用于宿主确认脚本收到并绘制了真实数据，不回传路径、模型或会话内容。
    api.postMessage({ type: 'rendered', locale: payload.locale, sessions: data.sessions.length, usageRange: data.usage.range, output: data.usage.output });
  }
  for (const button of document.querySelectorAll('[data-range]')) button.addEventListener('click', () => {
    range = Number(button.dataset.range); api.setState({ range }); if (latest) drawChart();
  });
  for (const type of ['refresh', 'settings']) document.getElementById(type).addEventListener('click', () => api.postMessage({ type }));
  document.getElementById('language').addEventListener('change', event => api.postMessage({ type: 'language', value: event.target.value }));
  document.getElementById('usage-range').addEventListener('change', event => api.postMessage({ type: 'usageRange', value: event.target.value }));
  window.addEventListener('message', event => { if (event.data?.type === 'update') render(event.data.payload); });
  new ResizeObserver(() => { if (latest) drawChart(); }).observe(document.getElementById('chart'));
  api.postMessage({ type: 'ready', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
})();
