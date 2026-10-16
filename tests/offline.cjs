const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {playwright: {firefox, webkit}, engineName, launchBrowser, waitForLayout, target: defaultTarget} = require('./helpers/browser.cjs');

const target = path.resolve(process.argv[2] || defaultTarget);
const url = pathToFileURL(target).href;
const report = {file: target, profiles: [], unavailableEngines: []};

async function openProfile(browser, options = {}, restricted = false) {
  const context = await browser.newContext({offline: true, viewport: {width: 1280, height: 900}, deviceScaleFactor: 1, ...options});
  if (restricted) await context.addInitScript(() => {
    Object.defineProperty(window, 'ResizeObserver', {value: undefined, configurable: true});
    Object.defineProperty(window, 'localStorage', {configurable: true, get() {throw new DOMException('Storage disabled for test', 'SecurityError');}});
  });
  const page = await context.newPage();
  const errors = [], resources = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (request.url() !== url) resources.push(request.url());});
  await page.goto(url);
  await waitForLayout(page);
  const canvas = page.locator('#optics-xp-sketch canvas');
  await canvas.waitFor();
  await assertRendered(canvas);
  assert.match(await page.title(), /^Спектр(?:\s|$)/u, 'The standalone application has its own document title');
  assert.equal(await page.locator('iframe,script[src],link[rel="stylesheet"]').count(), 0, 'No wrapper frame, external scripts, or external styles');
  if (engineName === 'chromium') assert.equal(await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl'))), false, 'Test really runs without WebGL');
  return {context, page, canvas, errors, resources};
}

async function assertRendered(canvas) {
  const result = await canvas.evaluate(c => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 64) if (data[i + 3]) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return {width: c.width, height: c.height, colors: colors.size};
  });
  assert.ok(result.width > 100 && result.height > 100 && result.colors > 20, `The scene renders: ${JSON.stringify(result)}`);
}

async function restore(page, view, screenMm = 303, labels = true, values = true) {
  await page.evaluate(({view, screenMm, labels, values}) => {
    window.dispatchEvent(new CustomEvent('openai:set_globals', {detail: {globals: {widgetState: {
      modelContent: {view, screenMm, filter: 'none', light: true}, privateContent: {labels, values}
    }}}}));
  }, {view, screenMm, labels, values});
}

async function livePosition(page) {
  return Number((await page.locator('[data-live]').textContent()).match(/\d+/)?.[0]);
}

function finishProfile(profile, name, extra = {}) {
  assert.deepEqual(profile.errors, [], `${name}: no JavaScript errors`);
  assert.deepEqual(profile.resources, [], `${name}: no requests for additional files or network resources`);
  report.profiles.push({name, errors: profile.errors, extraResourceRequests: profile.resources, ...extra});
}

(async () => {
  assert.ok(fs.existsSync(target), `Build the standalone file first: ${target}`);
  for (const [name, engine] of [['Firefox', firefox], ['WebKit', webkit]]) {
    if (!fs.existsSync(engine.executablePath())) report.unavailableEngines.push(name);
  }
  const browser = await launchBrowser({args: ['--disable-webgl', '--disable-webgl2', '--disable-gpu']});
  try {
    const desktop = await openProfile(browser);
    const {page, canvas} = desktop;
    const viewImages = [];
    for (const view of ['overview', 'top', 'optics', 'grating', 'screen']) {
      await page.locator(`[data-view="${view}"]`).click();
      await assertRendered(canvas);
      assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute('aria-pressed'), 'true');
      viewImages.push(await canvas.evaluate(c => c.toDataURL()));
    }
    assert.equal(new Set(viewImages).size, 5, 'All five views are different');
    const lit = viewImages.at(-1);
    await page.locator('[data-light]').uncheck();
    assert.notEqual(await canvas.evaluate(c => c.toDataURL()), lit, 'Light changes the screen image');
    await page.locator('[data-light]').check();
    const filterImages = [lit];
    for (const filter of ['red', 'green', 'blue']) {
      await page.locator('[data-filter]').selectOption(filter);
      filterImages.push(await canvas.evaluate(c => c.toDataURL()));
    }
    assert.equal(new Set(filterImages).size, 4, 'Every filter changes the spectrum independently, fully offline');

    for (const [start, move, expected] of [[303, 10, 310], [303, -10, 300], [310, 10, 320], [310, -10, 300], [649, 10, 650], [101, -10, 100]]) {
      await restore(page, 'top', start);
      await page.locator(`[data-move="${move}"]`).click();
      assert.equal(await livePosition(page), expected, `${start} moves directionally to ${expected}`);
    }
    await page.evaluate(() => {
      window.__positionText = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
        if (this.canvas === document.querySelector('#optics-xp-sketch canvas')) window.__positionText.push({text: String(text), x, y});
        return original.call(this, text, x, y, ...args);
      };
    });
    const positionLabel = async mm => {
      await page.evaluate(() => window.__positionText = []);
      await restore(page, 'top', mm, false, true);
      return page.evaluate(mm => window.__positionText.findLast(p => p.text === String(mm) || p.text === mm + ' мм'), mm);
    };
    const first = await positionLabel(303), next = await positionLabel(313);
    assert.ok(first && next, 'Numbered screen position is displayed');
    const scale = (next.x - first.x) / 10;
    await restore(page, 'top', 303, false, true);
    const bounds = await canvas.boundingBox();
    const logicalWidth = await canvas.evaluate(c => c.width);
    const ratio = bounds.width / logicalWidth;
    const dragX = bounds.x + (first.x + 15) * ratio;
    let dragY = null;
    for (let f = .2; f <= .85; f += .05) {
      const y = bounds.y + bounds.height * f;
      await page.mouse.move(dragX, y);
      if (await canvas.evaluate(c => c.style.cursor) === 'grab') {dragY = y; break;}
    }
    assert.notEqual(dragY, null, 'Screen can be grabbed in top view');
    await page.mouse.down();
    await page.mouse.move(dragX + scale * ratio, dragY);
    await page.mouse.up();
    assert.equal(await livePosition(page), 304, 'Free dragging preserves 1-mm precision');

    await restore(page, 'screen', 383, true, true);
    await page.locator('[data-move="10"]').click();
    await page.locator('[data-filter]').selectOption('blue');
    await page.locator('[data-light]').uncheck();
    await page.locator('[data-labels]').uncheck();
    await page.locator('[data-values]').uncheck();
    await page.reload();
    assert.equal(await page.locator('[data-view="screen"]').getAttribute('aria-pressed'), 'true', 'View persists without a host application');
    assert.equal(await page.locator('[data-filter]').inputValue(), 'blue');
    for (const selector of ['[data-light]', '[data-labels]', '[data-values]']) assert.equal(await page.locator(selector).isChecked(), false, `${selector} persists`);
    await page.locator('[data-move="10"]').click();
    assert.equal(await livePosition(page), 400, 'Screen coordinate persists across reopening');

    for (const width of [320, 375, 736, 1280]) {
      await page.setViewportSize({width, height: 900});
      await waitForLayout(page);
      for (const view of ['overview', 'top', 'optics', 'grating', 'screen']) {
        await page.locator(`[data-view="${view}"]`).click();
        await assertRendered(canvas);
        const size = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth}));
        assert.ok(size.scroll <= size.width + 1, `${view} has no horizontal overflow at ${width}: ${JSON.stringify(size)}`);
      }
    }
    finishProfile(desktop, 'Offline desktop, software canvas', {views: 5, viewportWidths: [320, 375, 736, 1280], persistence: true, arrowSnapMm: 10, dragStepMm: 1});
    await desktop.context.close();

    const fallback = await openProfile(browser, {}, true);
    await fallback.page.locator('[data-view="optics"]').click();
    await fallback.page.locator('[data-filter]').selectOption('red');
    await fallback.page.locator('[data-move="10"]').click();
    assert.equal(await livePosition(fallback.page), 260, 'Controls still work when storage is blocked');
    const wideWidth = await fallback.canvas.evaluate(c => c.width);
    await fallback.page.setViewportSize({width: 375, height: 900});
    await fallback.page.waitForFunction(width => document.querySelector('#optics-xp-sketch canvas').width < width, wideWidth);
    await assertRendered(fallback.canvas);
    finishProfile(fallback, 'Offline, storage blocked, ResizeObserver unavailable', {resizeFallback: true});
    await fallback.context.close();

    const touch = await openProfile(browser, {viewport: {width: 375, height: 812}, hasTouch: true, isMobile: true});
    await touch.page.locator('[data-view="screen"]').click();
    await touch.page.locator('[data-labels]').uncheck();
    let touchBounds = await touch.canvas.boundingBox();
    const tapScreen = async f => touch.page.touchscreen.tap(touchBounds.x + touchBounds.width * f, touchBounds.y + touchBounds.height * .4);
    await tapScreen(.57);
    assert.equal(await touch.canvas.getAttribute('data-ruler-active'), 'true', 'A touch leaves the screen ruler visible without hover');
    const measurement = Number(await touch.canvas.getAttribute('data-ruler-mm'));
    assert.ok(measurement > 0 && measurement <= 110, 'Touch gives a position inside the printed scale');
    await tapScreen(.65);
    assert.ok(Number(await touch.canvas.getAttribute('data-ruler-mm')) > measurement, 'Touch ruler follows a new contact');
    await touch.page.locator('[data-values]').uncheck();
    await touch.page.locator('[data-labels]').check();
    await tapScreen(.57);
    assert.equal(await touch.canvas.getAttribute('data-ruler-active'), 'false', 'Labels do not enable values on touch devices');
    await touch.page.locator('[data-values]').check();
    await tapScreen(.57);
    assert.equal(await touch.canvas.getAttribute('data-ruler-active'), 'true');
    finishProfile(touch, 'Offline touch phone', {touchRuler: true, independentValues: true});
    await touch.context.close();
    console.log(JSON.stringify(report, null, 2));
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
