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
  /** 初始化仪表刻度，不随每秒数据更新重建。 */
  for (let index = 0; index <= 36; index++) {
    const angle = (135 + index * 7.5) * Math.PI / 180;
    const radius = index % 6 === 0 ? 54 : 57;
    document.getElementById('dial-ticks').append(svg('line', { x1: 90 + radius * Math.cos(angle), y1: 90 + radius * Math.sin(angle), x2: 90 + 60 * Math.cos(angle), y2: 90 + 60 * Math.sin(angle) }));
  }
  /** 根据当前时间窗口绘图；断档留空，估算段使用虚线，绝不补造离线历史。 */
  function drawChart() {
    const { data, labels } = latest;
    const chart = document.getElementById('chart');
    const start = data.now - range * 1000;
    const points = data.points.filter(point => point.time >= start && point.time <= data.now);
    const max = Math.max(10, Math.ceil(Math.max(...points.map(point => point.rate), 0) / 25) * 25);
    const left = 35, right = 594, top = 12, bottom = 150;
    const x = point => left + (point.time - start) / (range * 1000) * (right - left);
    const y = point => bottom - point.rate / max * (bottom - top);
    chart.replaceChildren();
    chart.setAttribute('aria-label', labels.chartLabel);
    for (let index = 0; index <= 2; index++) {
      const ordinate = top + index * (bottom - top) / 2;
      chart.append(svg('line', { x1: left, y1: ordinate, x2: right, y2: ordinate, class: 'grid-line' }), svg('text', { x: 0, y: ordinate + 4 }, number(max * (1 - index / 2))));
    }
    for (const fraction of [0, .5, 1]) {
      chart.append(svg('text', { x: left + fraction * (right - left), y: 173, 'text-anchor': fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle' }, fraction === 1 ? labels.now : `−${number(range * (1 - fraction))}s`));
    }
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1], point = points[index];
      if (point.time - previous.time > 15000) continue;
      chart.append(svg('path', { d: `M${x(previous)},${y(previous)} L${x(point)},${y(point)}`, class: `speed-line${point.kind === 'estimated' || previous.kind === 'estimated' ? ' estimated' : ''}` }));
    }
    if (points.length) {
      const point = points[points.length - 1];
      chart.append(svg('circle', { cx: x(point), cy: y(point), r: 3, fill: '#5edeb1' }));
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
    for (const session of data.sessions) {
      const row = document.createElement('div'); row.className = 'session';
      const info = document.createElement('div');
      const name = document.createElement('span'); name.className = 'session-name'; name.textContent = session.name || labels.unnamed; name.title = session.cwd || session.id;
      const model = document.createElement('span'); model.className = 'session-model'; model.textContent = `Codex · ${session.model || labels.unknownModel}`;
      const counts = document.createElement('div'); counts.className = 'session-counts'; counts.textContent = `${number(session.output, true)} ${labels.outputUnit} · ${number(session.responses)} ${labels.requestUnit}`;
      info.append(name, model, counts);
      const value = document.createElement('div');
      const rate = document.createElement('div'); rate.className = 'session-rate'; rate.textContent = `${session.kind === 'estimated' ? '~' : ''}${session.rate.toFixed(1)} tok/s`;
      const phase = document.createElement('div'); phase.className = 'session-phase';
      const dot = document.createElement('span'); dot.className = `dot ${session.phase}`;
      const label = document.createElement('span'); label.textContent = session.kind === 'last' ? labels.last : labels[session.phase];
      phase.append(dot, label); value.append(rate, phase); row.append(info, value); container.append(row);
    }
    container.scrollTop = scroll;
  }
  /** 更新卡片和实时仪表，沿用 VS Code 主题颜色及用户选择的语言。 */
  function render(payload) {
    latest = payload;
    const { data, labels, context } = payload, snapshot = data.snapshot;
    document.documentElement.lang = payload.locale;
    const mapping = { 'dashboard-title': 'dashboard', 'live-label': 'live', 'curve-title': 'curve', 'range-60': 'oneMinute', 'range-120': 'twoMinutes', 'range-300': 'fiveMinutes', 'measured-label': 'measured', 'estimated-label': 'estimated', 'curve-note': 'curveNote', 'source-title': 'source', 'source-note': 'sourceNote', 'sessions-title': 'sessions', 'usage-title': 'usage', 'output-label': 'output', 'input-label': 'input', 'responses-label': 'responses', 'average-label': 'average', 'peak-label': 'peak', 'usage-note': 'usageNote', 'host-label': 'host', 'directory-label': 'directory', 'scope-label': 'scope', 'language-label': 'language', 'language-auto': 'auto', 'estimate-note': 'estimateNote', 'last-note': 'lastNote', 'stale-note': 'stale', 'privacy-note': 'noCosts' };
    for (const [id, key] of Object.entries(mapping)) text(id, labels[key]);
    for (const id of ['refresh', 'settings']) { document.getElementById(id).title = labels[id]; document.getElementById(id).setAttribute('aria-label', labels[id]); }
    const phase = context.error ? 'error' : snapshot.kind;
    text('rate', context.error || !context.enabled ? '—' : `${snapshot.kind === 'estimated' ? '~' : ''}${snapshot.rate.toFixed(1)}`);
    text('phase', !context.enabled ? labels.disabled : labels[phase]);
    document.getElementById('phase-dot').className = `dot ${phase === 'tools' ? 'tools' : ['idle', 'last', 'error'].includes(phase) ? 'idle' : ''}`;
    text('activity', `${labels.generating} ${number(snapshot.active)} · ${labels.tools} ${number(data.sessions.filter(session => session.phase === 'tools').length)}`);
    const scale = Math.max(100, data.usage.peak);
    const displayRate = context.error || !context.enabled ? 0 : snapshot.rate;
    const progress = Math.max(0, Math.min(1, displayRate / scale));
    document.getElementById('dial-progress').setAttribute('stroke-dasharray', `${progress * 311} 415`);
    document.getElementById('needle').setAttribute('transform', `rotate(${-135 + progress * 270} 90 90)`);
    const notice = [!context.enabled ? labels.disabled : context.notice, context.limited ? labels.partial : ''].filter(Boolean).join(' ');
    text('notice', notice); document.getElementById('notice').hidden = !notice; document.getElementById('notice').classList.toggle('error', context.error);
    text('source-output', `${number(data.usage.output, true)} ${labels.outputUnit}`);
    for (const key of ['output', 'input', 'responses']) { text(`${key}-value`, number(data.usage[key], true)); document.getElementById(`${key}-value`).title = number(data.usage[key]); }
    text('average-value', `${data.usage.average.toFixed(1)} tok/s`); text('peak-value', `${data.usage.peak.toFixed(1)} tok/s`);
    text('host-value', context.host); text('directory-value', context.home); text('scope-value', context.scope === 'all' ? labels.all : labels.workspace);
    text('updated', `${labels.updated} ${new Date(data.now).toLocaleTimeString(payload.locale, { hour12: false })}`);
    document.getElementById('last-note').hidden = snapshot.kind !== 'last';
    document.getElementById('language').value = payload.selectedLanguage;
    drawChart(); drawSessions();
    // 只用于宿主确认脚本收到并绘制了真实数据，不回传路径、模型或会话内容。
    api.postMessage({ type: 'rendered', locale: payload.locale, sessions: data.sessions.length });
  }
  for (const button of document.querySelectorAll('[data-range]')) button.addEventListener('click', () => {
    range = Number(button.dataset.range); api.setState({ range }); if (latest) drawChart();
  });
  for (const type of ['refresh', 'settings']) document.getElementById(type).addEventListener('click', () => api.postMessage({ type }));
  document.getElementById('language').addEventListener('change', event => api.postMessage({ type: 'language', value: event.target.value }));
  window.addEventListener('message', event => { if (event.data?.type === 'update') render(event.data.payload); });
  api.postMessage({ type: 'ready' });
})();
