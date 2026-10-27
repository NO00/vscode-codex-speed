import { Translate } from '../localization';

/** 向脚本传递已选择语言的界面词条；浏览器端不读取操作系统语言。 */
export function dashboardMessages(t: Translate): Record<string, string> {
  return {
    console: t('Monitoring console'), connection: t('Connection details'), rate: t('Rate'),
    dashboard: t('Dashboard'), live: t('Live output'), generating: t('Generating'), tools: t('Tools'), idle: t('Idle'),
    measured: t('Measured'), estimated: t('Estimated'), last: t('Last'), waiting: t('Waiting for counts'),
    curve: t('Output speed'), oneMinute: t('1 min'), twoMinutes: t('2 min'), fiveMinutes: t('5 min'),
    collecting: t('Collecting speed history…'), curveNote: t('One-second buckets rebuilt from logs. Completed usage corrects earlier estimates; hover to inspect each part.'),
    measuredPart: t('Measured part'), combined: t('Total including estimates'), estimateShare: t('Estimated share'),
    sessions: t('Sessions'), model: t('Model'), unknownModel: t('Unknown model'), unnamed: t('Unnamed session'),
    noSessions: t('No sessions in this scope yet.'), usage: t('Usage'), last30m: t('Last 30 minutes'), today: t('Today'), last7d: t('Last 7 days'), last30d: t('Last 30 days'), usageRange: t('Usage period'), input: t('Input tokens'), output: t('Output tokens'),
    responses: t('Responses'), average: t('Average speed'), peak: t('5-minute peak'), usageNote: t('Available log records only. Input may include cached tokens. Average uses completed calls with known duration.'),
    estimateNote: t('~ includes estimates. Completed logs reconstruct past speed uniformly over each call; this is not per-token telemetry. Duration includes time to first token; output includes reasoning.'),
    host: t('Host'), directory: t('Directory'), scope: t('Scope'), all: t('All recent sessions on this host'), workspace: t('Current workspace'),
    refresh: t('Rescan logs'), settings: t('Settings'), language: t('Interface language'), auto: t('Follow VS Code'),
    updated: t('Updated'), now: t('now'), partial: t('Scan limit reached. Only some sessions are shown.'),
    disabled: t('Monitoring is disabled. Enable it in Settings.'), error: t('Check log access'), source: t('Source'),
    outputUnit: t('output tokens'), requestUnit: t('responses'), sourceNote: t('Read-only Codex logs'),
    noCosts: t('No network traffic tracking'), chartLabel: t('Output speed over time'), totalSessions: t('tracked'),
    apiCost: t('API-equivalent cost'), estimatedTotal: t('Estimated total'), knownSubtotal: t('Known subtotal'),
    ordinaryInput: t('Uncached input'), cachedInput: t('Cached input'), unpriced: t('Unpriced'),
    pricedResponses: t('Fully priced responses'), priceSnapshot: t('Price snapshot'), priceUnit: t('USD / 1M tokens'),
    standardPrice: t('Standard'), customPrice: t('Custom'), costEmpty: t('No completed usage in this period.'),
    unknownInput: t('Input tokens without a cache split'), missingInput: t('Responses without input counts'),
    missingWrites: t('Responses without cache-write counts'),
    cacheWrites: t('Excluded cache-write tokens'), longContextPrice: t('Long-context pricing applied'),
    costNote: t('Offline Standard API equivalent, not your Codex bill. Uses the displayed price snapshot for all selected records. Excludes cache writes, tools, service-tier and regional charges.'),
    costPartial: t('Some usage is unpriced or lacks input details. Only known charges are included.'),
    configurePrices: t('Configure model prices'),
    lastNote: t('Last completed call'),
    stale: t('Session activity expires after five minutes without new events.'),
    indexing: t('Indexing history'), indexedFiles: t('files processed'), incomplete: t('Totals may be incomplete.'),
    historyPartial: t('Some history could not be read or a resource limit was reached.'),
    cacheError: t('History cache is unavailable. Results are kept in memory for this session.'),
    cacheReset: t('The cache was rebuilt from available logs.'), timeZone: t('Time zone'),
    historyNote: t('History is retained for 30 days. Only uncompressed session JSONL files are indexed.'),
    sessionPeriod: t('Session counts use the selected usage period; activity uses recent log events.')
  };
}
