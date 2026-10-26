import { Translate } from '../localization';

/** 向脚本传递已选择语言的界面词条；浏览器端不读取操作系统语言。 */
export function dashboardMessages(t: Translate): Record<string, string> {
  return {
    dashboard: t('Dashboard'), live: t('Live output'), generating: t('Generating'), tools: t('Tools'), idle: t('Idle'),
    measured: t('Measured'), estimated: t('Estimated'), last: t('Last'), waiting: t('Waiting for counts'),
    curve: t('Output speed'), oneMinute: t('1 min'), twoMinutes: t('2 min'), fiveMinutes: t('5 min'),
    collecting: t('Collecting speed history…'), curveNote: t('Recorded while monitoring. Dashed segments include estimates.'),
    sessions: t('Sessions'), model: t('Model'), unknownModel: t('Unknown model'), unnamed: t('Unnamed session'),
    noSessions: t('No sessions in this scope yet.'), usage: t('Last 30 minutes'), input: t('Input tokens'), output: t('Output tokens'),
    responses: t('Responses'), average: t('Average speed'), peak: t('5-minute peak'), usageNote: t('Available log records only. Input may include cached tokens. Average uses completed calls with known duration.'),
    estimateNote: t('~ marks an estimate. Duration includes time to first token; output includes reasoning.'),
    host: t('Host'), directory: t('Directory'), scope: t('Scope'), all: t('All recent sessions on this host'), workspace: t('Current workspace'),
    refresh: t('Rescan logs'), settings: t('Settings'), language: t('Interface language'), auto: t('Follow VS Code'),
    updated: t('Updated'), now: t('now'), partial: t('Scan limit reached. Only some sessions are shown.'),
    disabled: t('Monitoring is disabled. Enable it in Settings.'), error: t('Check log access'), source: t('Source'),
    outputUnit: t('output tokens'), requestUnit: t('responses'), sourceNote: t('Read-only Codex logs'),
    noCosts: t('No cost or network traffic tracking'), chartLabel: t('Output speed over time'), totalSessions: t('tracked'),
    lastNote: t('Last completed call; the live curve is zero while idle.'),
    stale: t('Session activity expires after five minutes without new events.')
  };
}
