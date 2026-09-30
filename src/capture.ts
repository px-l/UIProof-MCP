import { chromium } from 'playwright';
import type { Config, Rect } from './config.js';
import { createHash } from 'node:crypto';
export interface ElementEvidence { tag: string; text: string; selector: string | null; box: Rect }
export async function capture(config: Config, state: Config['states'][number]) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: config.viewport, deviceScaleFactor: 1, locale: config.locale, timezoneId: config.timezoneId, colorScheme: config.colorScheme, reducedMotion: 'reduce', serviceWorkers: 'block' });
    page.setDefaultTimeout(config.timeoutMs);
    const response = await page.goto(config.url, { waitUntil: 'load', timeout: config.timeoutMs });
    if (!response || !response.ok()) throw new Error(`Page returned HTTP ${response?.status() ?? 'no response'}`);
    for (const step of state.steps) {
      const locator = page.locator(step.selector);
      if (step.action === 'click') await locator.click();
      else if (step.action === 'fill') await locator.fill(step.value);
      else if (step.action === 'hover') await locator.hover();
      else await locator.waitFor({ state: 'visible' });
    }
    if (config.readySelector) await page.locator(config.readySelector).waitFor({ state: 'visible' });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' });
    await page.waitForFunction(() => document.fonts.status === 'loaded' && [...document.images].every(i => i.complete && (i.naturalWidth > 0 || !i.currentSrc)), { }, { timeout: config.timeoutMs });
    // Exact repeated frames detect timers, lazy loading and changing canvases. Never accept a timeout as success.
    const deadline = Date.now() + config.timeoutMs;
    let previous = ''; let stable = 0; let screenshot: Buffer | undefined; let attempts = 0;
    while (Date.now() < deadline) {
      screenshot = await page.screenshot({ animations: 'disabled', caret: 'hide', type: 'png', timeout: Math.max(1, deadline - Date.now()) });
      // Ignore only explicitly configured dynamic regions during convergence, just as during comparison.
      const { PNG } = await import('pngjs');
      const frame = PNG.sync.read(screenshot);
      for (const m of config.masks) for (let y=m.y;y<m.y+m.height;y++) for(let x=m.x;x<m.x+m.width;x++) frame.data.fill(0,(y*frame.width+x)*4,(y*frame.width+x)*4+4);
      const hash = createHash('sha256').update(frame.data).digest('hex');
      stable = hash === previous ? stable + 1 : 0; previous = hash; attempts++;
      if (stable >= 2) break;
      await page.waitForTimeout(150);
    }
    if (stable < 2 || !screenshot) throw new Error('Screenshot did not stabilize (three identical frames required)');
    const elements = await page.evaluate(() => [...document.querySelectorAll('body *')].slice(0, 10000).flatMap(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return [];
      const x = Math.max(0, Math.floor(r.left)), y = Math.max(0, Math.floor(r.top));
      return [{ tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim().slice(0, 200), selector: el.id ? '#' + CSS.escape(el.id) : el.hasAttribute('data-testid') ? `[data-testid=${JSON.stringify(el.getAttribute('data-testid'))}]` : null, box: { x, y, width: Math.ceil(Math.min(innerWidth, r.right)) - x, height: Math.ceil(Math.min(innerHeight, r.bottom)) - y } }];
    }));
    return { screenshot, elements, metadata: { browser: browser.version(), platform: process.platform, architecture: process.arch, deviceScaleFactor: 1, viewport: config.viewport, finalUrl: page.url(), attempts, capturedAt: new Date().toISOString() } };
  } finally { await browser.close(); }
}
