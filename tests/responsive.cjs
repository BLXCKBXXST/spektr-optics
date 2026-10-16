const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const {engineName, launchBrowser, waitForLayout, target: defaultTarget, output} = require('./helpers/browser.cjs');
const target = path.resolve(process.argv[2] || defaultTarget);
const url = pathToFileURL(target).href;
const profiles = [[320, 568], [375, 812], [736, 768], [1280, 800], [1920, 1080], [812, 375]];
const controls = '[data-view], [data-labels], [data-values], [data-light], [data-filter], [data-move], [data-zoom], [data-zoom-reset], [data-aperture]';
const report = {file: target, browser: engineName, profiles: [], resize: null};

async function assertRendered(canvas) {
  const image = await canvas.evaluate(c => {
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 64) {
      if (pixels[i + 3]) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
    }
    return {width: c.width, height: c.height, colors: colors.size};
  });
  assert.ok(image.width >= 200 && image.height >= 140 && image.colors > 20, `The scene is rendered: ${JSON.stringify(image)}`);
}

async function inspectLayout(page) {
  return page.evaluate(selector => {
    const rect = element => {
      const b = element.getBoundingClientRect();
      return {left: b.left, top: b.top + scrollY, right: b.right, bottom: b.bottom + scrollY, width: b.width, height: b.height};
    };
    const scene = document.querySelector('section.xp-scene-window');
    const panel = document.querySelector('section.xp-control-window');
    const canvas = document.querySelector('#optics-xp-sketch canvas');
    return {
      document: {width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight},
      scene: scene && rect(scene), panel: panel && rect(panel), canvas: rect(canvas), view: canvas.dataset.cameraView,
      controls: [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length > 0).map(element => ({
        name: element.dataset.view || element.dataset.move || Object.keys(element.dataset).join(','),
        rect: rect(element.matches('input[type="checkbox"]') ? element.closest('label') : element),
        inPanel: panel?.contains(element) || false,
        inScene: scene?.contains(element) || false,
        visible: getComputedStyle(element).visibility !== 'hidden' && element.getClientRects().length > 0
      }))
    };
  }, controls);
}

function overlaps(a, b) {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
}

function verifyLayout(layout, name) {
  assert.ok(layout.scene && layout.panel, `${name}: two separate XP window sections`);
  assert.equal(layout.controls.length, 15, `${name}: every control, including aperture, is visible in every view`);
  assert.ok(layout.panel.top >= layout.scene.bottom - 1, `${name}: control window is underneath the scene window`);
  assert.ok(layout.canvas.width > layout.document.width * .82, `${name}: scene uses available window width`);
  assert.ok(layout.canvas.left >= layout.scene.left && layout.canvas.right <= layout.scene.right + 1, `${name}: scene does not spill out of its window`);
  assert.ok(layout.canvas.top >= layout.scene.top && layout.canvas.bottom <= layout.scene.bottom + 1, `${name}: canvas height fits its window`);
  assert.ok(layout.document.scrollWidth <= layout.document.width + 1, `${name}: no horizontal page overflow`);
  for (const control of layout.controls) {
    assert.ok(control.inPanel && !control.inScene && control.visible, `${name}: ${control.name} is visible only in the lower window`);
    assert.ok(control.rect.left >= layout.panel.left - 1 && control.rect.right <= layout.panel.right + 1, `${name}: ${control.name} fits the control window width`);
    assert.ok(control.rect.top >= layout.panel.top - 1 && control.rect.bottom <= layout.panel.bottom + 1, `${name}: ${control.name} fits the control window height`);
  }
  for (let i = 0; i < layout.controls.length; i++) {
    for (let j = i + 1; j < layout.controls.length; j++) {
      assert.ok(!overlaps(layout.controls[i].rect, layout.controls[j].rect), `${name}: ${layout.controls[i].name} does not overlap ${layout.controls[j].name}`);
    }
  }
  // Small portrait/landscape screens may need vertical scrolling to preserve usable controls.
  if (layout.document.width >= 1000 && layout.document.height >= 700) {
    assert.ok(layout.document.scrollHeight <= layout.document.height + 1, `${name}: a normal desktop fits vertically`);
  }
}

async function stateSnapshot(page) {
  return page.evaluate(() => ({
    view: document.querySelector('[data-view][aria-pressed="true"]').dataset.view,
    labels: document.querySelector('[data-labels]').checked,
    values: document.querySelector('[data-values]').checked,
    light: document.querySelector('[data-light]').checked,
    filter: document.querySelector('[data-filter]').value,
    aperture: document.querySelector('[data-aperture]').value,
    zoom: document.querySelector('canvas').dataset.zoomLevel,
    pan: document.querySelector('canvas').dataset.pan,
    screen: document.querySelector('[data-live]').textContent
  }));
}

(async () => {
  assert.ok(fs.existsSync(target), `Build the standalone file first: ${target}`);
  fs.mkdirSync(output, {recursive: true});
  const browser = await launchBrowser({args: ['--disable-webgl', '--disable-webgl2']});
  try {
    const context = await browser.newContext({offline: true, deviceScaleFactor: 1, viewport: {width: 1280, height: 800}});
    const page = await context.newPage();
    const errors = [], resources = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {if (request.url() !== url) resources.push(request.url());});
    await page.goto(url);
    const canvas = page.locator('#optics-xp-sketch canvas');
    await canvas.waitFor();
    for (const [width, height] of profiles) {
      const name = `${width}x${height}`;
      await page.setViewportSize({width, height});
      await waitForLayout(page);
      for (const view of ['overview', 'top', 'optics', 'grating', 'screen']) {
        await page.locator(`[data-view="${view}"]`).click();
        await waitForLayout(page);
        await assertRendered(canvas);
        const layout = await inspectLayout(page);
        verifyLayout(layout, `${name}/${view}`);
        if (view === 'overview') {
          report.profiles.push({viewport: name, canvas: layout.canvas, scene: layout.scene, panel: layout.panel, verticalScroll: layout.document.scrollHeight > height + 1});
        }
        if (view === 'overview' || view === 'screen') {
          await page.screenshot({path: path.join(output, `xp-windows-${name}-${view}.png`), fullPage: true});
        }
      }
      // Each control is accessible even when the lower window needs scrolling.
      for (const selector of ['[data-labels]', '[data-values]', '[data-light]']) {
        const checkbox = page.locator(selector), before = await checkbox.isChecked();
        await checkbox.setChecked(!before);
        await checkbox.setChecked(before);
      }
      for (const filter of ['red', 'green', 'blue', 'none']) await page.locator('[data-filter]').selectOption(filter);
      await page.locator('[data-aperture]').focus();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('[data-aperture]').inputValue(), '10.5', `${name}: aperture is usable without opening its dedicated view`);
      await page.locator('[data-move="10"]').click();
      await page.locator('[data-move="-10"]').click();
    }

    await page.setViewportSize({width: 1280, height: 800});
    await page.locator('[data-view="screen"]').click();
    await page.locator('[data-filter]').selectOption('red');
    await page.locator('[data-labels]').uncheck();
    await page.locator('[data-values]').check();
    await page.locator('[data-light]').uncheck();
    await page.locator('[data-move="10"]').click();
    await page.locator('[data-zoom="1"]').click();
    await waitForLayout(page);
    const state = await stateSnapshot(page);
    const initial = await canvas.boundingBox();
    await page.setViewportSize({width: 1280, height: 1080});
    await waitForLayout(page);
    const taller = await canvas.boundingBox();
    assert.ok(taller.height > initial.height + 150, 'Canvas expands when only viewport height grows');
    assert.ok(Math.abs(taller.width - initial.width) < 2, 'Height-only resizing preserves canvas width');
    await page.setViewportSize({width: 1920, height: 1080});
    await waitForLayout(page);
    const wider = await canvas.boundingBox();
    assert.ok(wider.width > taller.width + 500, 'Canvas expands across large desktop windows without a fixed maximum width');
    await page.setViewportSize({width: 375, height: 812});
    await waitForLayout(page);
    assert.deepEqual(await stateSnapshot(page), state, 'Resizing preserves every simulator setting');
    await assertRendered(canvas);
    assert.deepEqual(errors, [], 'No JavaScript errors');
    assert.deepEqual(resources, [], 'No extra files or network dependencies, fully offline');
    report.resize = {initial: {width: initial.width, height: initial.height}, taller: {width: taller.width, height: taller.height}, wider: {width: wider.width, height: wider.height}, statePreserved: true};
    report.errors = errors;
    report.extraResources = resources;
    report.screenshots = output;
    console.log(JSON.stringify(report, null, 2));
    await context.close();
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
