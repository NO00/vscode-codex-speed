/** 用真实浏览器验证生产仪表盘，全部场景来自本机虚拟数据服务。 */
async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const results = [];
  await page.setViewportSize({ width: 1120, height: 1080 });
  await page.goto('http://127.0.0.1:4187/');
  await page.locator('#quota-windows progress').first().waitFor();
  // 手动语言、日期范围和三种宽度共享同一份数据，额度不能被历史周期过滤。
  for (const locale of ['zh-cn', 'en', 'zh-tw']) {
    await page.locator('#language').selectOption(locale);
    await page.waitForFunction(locale => document.documentElement.lang === locale, locale);
    assert(await page.locator('#quota-windows progress').count() === 2, `${locale} missing quota windows`);
    assert(await page.locator('#model-speeds .model-speed').count() === 2, `${locale} missing model groups`);
    assert((await page.locator('#latency-value').textContent()).includes('1.3'), `${locale} first-content wait`);
    const before = await page.locator('#quota-windows').textContent();
    await page.locator('#usage-range').selectOption('7d');
    await page.waitForFunction(() => document.querySelector('#usage-range').value === '7d');
    assert(await page.locator('#quota-windows').textContent() === before, `${locale} usage filter changed account quota`);
    await page.locator('#usage-range').selectOption('today');
    for (const width of [1120, 700, 320]) {
      await page.setViewportSize({ width, height: 1080 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert(!overflow, `${locale} overflow at ${width}`);
    }
    await page.setViewportSize({ width: 1120, height: 1080 });
    await page.screenshot({ path: `output/playwright/insights-${locale}.png` });
    results.push({ locale, quotaWindows: 2, models: 2, widths: [1120, 700, 320] });
  }
  // 缺失、旧快照、重置已过和仍在等待均需显示真实状态，不能伪造零值。
  for (const [scene, check] of [
    ['quota-missing', async () => assert(await page.locator('#quota-empty').isVisible(), 'missing quota not explained')],
    ['quota-stale', async () => {
      assert((await page.locator('#quota-age').textContent()).includes('旧快照'), 'stale snapshot missing');
      assert(await page.locator('.old-snapshot').count() === 2, 'expired windows missing');
      assert((await page.locator('#quota-windows').textContent()).includes('23%'), 'expired window invented zero');
    }],
    ['latency-waiting', async () => assert((await page.locator('#latency-value').textContent()).startsWith('≥'), 'elapsed wait not distinct')],
    ['empty', async () => {
      assert(await page.locator('#model-speeds .model-speed').count() === 0, 'empty models have false speed');
      assert(await page.locator('#latency-value').textContent() === '—', 'missing timing shown as zero');
    }]
  ]) {
    await page.goto(`http://127.0.0.1:4187/?scene=${scene}`);
    await page.locator('#insights-title').getByText('运行概况', { exact: true }).waitFor();
    await check(); results.push({ scene, ok: true });
  }
  await page.goto('http://127.0.0.1:4187/');
  await page.locator('#quota-windows progress').first().waitFor();
  // 厂商和日志元数据仅可作为纯文本，不得变成 Webview 中的可执行标签。
  await page.evaluate(async () => {
    const payload = await (await fetch('/api/data?language=zh-cn')).json();
    const injection = '<img src=x onerror="window.__insightsXss=1">';
    payload.data.models[0].model = injection;
    payload.data.quota.snapshot.plan = injection;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'update', payload } }));
  });
  assert(await page.locator('#model-speeds img, #quota-plan img').count() === 0, 'metadata inserted as HTML');
  assert(await page.evaluate(() => window.__insightsXss) === undefined, 'metadata script executed');
  assert(errors.length === 0, errors.join('\n'));
  await page.reload(); await page.locator('#quota-windows progress').first().waitFor();
  await page.setViewportSize({ width: 390, height: 1050 });
  await page.locator('.insights-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/playwright/insights-narrow.png' });
  await page.setViewportSize({ width: 1120, height: 1080 }); await page.evaluate(() => scrollTo(0, 0));
  return { ok: true, errors, results, metadataSafety: true };
}
