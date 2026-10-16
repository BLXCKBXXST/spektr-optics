const assert = require('node:assert/strict');
const {launchBrowser, engineName, targetUrl, waitForLayout} = require('./helpers/browser.cjs');
const storageKey = 'spektr.optics.v1';

async function saved(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function seed(page, modelContent, privateContent = {}) {
  await page.evaluate(({key, modelContent, privateContent}) => {
    localStorage.setItem(key, JSON.stringify({modelContent, privateContent}));
  }, {key: storageKey, modelContent, privateContent});
  await page.reload();
  await waitForLayout(page);
}

async function noOverflow(page, message) {
  const dimensions = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth}));
  assert.ok(dimensions.scroll <= dimensions.width + 1, `${message}: ${JSON.stringify(dimensions)}`);
}

async function testFilters(page) {
  const filter = page.locator('[data-filter]');
  const canvas = page.locator('canvas');
  assert.deepEqual(await filter.locator('option').evaluateAll(options => options.map(option => option.value)),
    ['none', 'red', 'green', 'blue'], 'Three color filters and the empty socket are available');
  const spectra = [], glasses = [], swatches = [];
  for (const value of ['none', 'red', 'green', 'blue']) {
    await seed(page, {view: 'screen', screenMm: 540, apertureMm: 18, light: true, filter: 'none'}, {labels: false, values: false});
    await filter.selectOption(value);
    await page.reload();
    await waitForLayout(page);
    assert.equal(await filter.inputValue(), value, `${value} filter survives reopening without substitution`);
    assert.equal((await saved(page)).modelContent.filter, value);
    spectra.push(await canvas.evaluate(element => element.toDataURL()));
    swatches.push(await page.locator('[data-filter-swatch]').evaluate(element => getComputedStyle(element).backgroundColor));
    await page.locator('[data-light]').uncheck();
    assert.notEqual(await canvas.evaluate(element => element.toDataURL()), spectra.at(-1), `${value}: turning the source off removes the spectrum`);
    await page.locator('[data-view="optics"]').click();
    glasses.push(await canvas.evaluate(element => element.toDataURL()));
  }
  assert.equal(new Set(spectra).size, 4, 'Every filter produces its own screen spectrum');
  assert.equal(new Set(swatches).size, 4, 'The control panel previews each filter color');
  assert.equal(new Set(glasses).size, 4, 'The model glass changes color even with the lamp and labels off');
  await page.locator('[data-view="screen"]').click();
  const dark = await canvas.evaluate(element => element.toDataURL());
  for (const value of ['none', 'red', 'green', 'blue']) {
    await filter.selectOption(value);
    assert.equal(await canvas.evaluate(element => element.toDataURL()), dark, 'Changing filters cannot create a spectrum while the source is off');
  }
}

async function testWindows(page, touch) {
  const original = await saved(page);
  const settings = async () => page.evaluate(() => ({
    filter: document.querySelector('[data-filter]').value,
    light: document.querySelector('[data-light]').checked,
    aperture: document.querySelector('[data-aperture]').value
  }));
  const before = await settings();
  for (const name of ['scene', 'control']) {
    const window = page.locator(`.xp-${name}-window`);
    const minimize = window.locator('[data-window-action="minimize"]');
    const maximize = window.locator('[data-window-action="maximize"]');
    const close = window.locator('[data-window-action="close"]');
    for (const button of [minimize, maximize, close]) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.width >= (touch ? 44 : 28) && bounds.height >= (touch ? 44 : 28), 'Window buttons have usable hit targets');
      assert.ok(await button.getAttribute('aria-label'), 'Every window button is named');
    }
    await minimize.focus();
    await page.keyboard.press('Enter');
    await waitForLayout(page);
    assert.equal(await minimize.getAttribute('aria-expanded'), 'false', 'Keyboard minimization works');
    assert.ok(await window.evaluate(element => element.offsetHeight < 170), 'A minimized window contains only its title');
    await maximize.click();
    await waitForLayout(page);
    assert.equal(await minimize.getAttribute('aria-expanded'), 'true', 'Maximizing restores a minimized window');
    assert.equal(await maximize.getAttribute('aria-pressed'), 'true');
    assert.ok(await window.evaluate(element => element.offsetHeight >= innerHeight - 24), 'An expanded window fills the available height');
    assert.equal(await page.locator('.xp-title').count(), 2, 'Both window titles remain available');
    await noOverflow(page, 'Expanded window');
    await minimize.click();
    await minimize.click();
    await waitForLayout(page);
    assert.equal(await maximize.getAttribute('aria-pressed'), 'true', 'Restoring a minimized expanded window remembers its size');
    await maximize.click();
    await close.click();
    assert.equal(await page.locator('.xp-window-toast').textContent(), 'Лаборатория остаётся открытой.');
    assert.equal(await close.evaluate(element => document.activeElement === element), true, 'The joke does not move keyboard focus');
    await noOverflow(page, 'Restored window');
  }
  // Collapsing both windows must still leave a way to restore each one.
  for (const name of ['scene', 'control']) await page.locator(`.xp-${name}-window [data-window-action="minimize"]`).click();
  for (const name of ['control', 'scene']) await page.locator(`.xp-${name}-window [data-window-action="minimize"]`).click();
  await waitForLayout(page);
  assert.deepEqual(await saved(page), original, 'Window actions leave all saved simulator settings intact');
  assert.deepEqual(await settings(), before, 'Window actions leave equipment controls intact');
}

async function testPinch(page, context) {
  await page.locator('[data-view="top"]').click();
  const canvas = page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  let point = null;
  for (let x = .18; x <= .38 && !point; x += .02) {
    for (let y = .3; y <= .75; y += .05) {
      await page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
      if (await canvas.evaluate(element => element.style.cursor === 'grab')) {
        point = {x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y};
        break;
      }
    }
  }
  assert.ok(point, 'Pinch starts over the draggable screen, not merely empty space');
  const before = (await saved(page)).modelContent;
  const first = {x: point.x, y: point.y, id: 1};
  const second = {x: point.x + 70, y: point.y, id: 2};
  if (engineName === 'chromium') {
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [first]});
    await session.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [first, second]});
    await session.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{...first, x: first.x - 15}, {...second, x: second.x + 15}]});
    await session.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    await session.detach();
  } else {
    // Other engines lack CDP touch injection; exercise the same two-pointer sequence.
    await canvas.evaluate((element, {first, second}) => {
      const send = (type, point) => element.dispatchEvent(new PointerEvent(type, {
        pointerId: point.id, pointerType: 'touch', button: 0, bubbles: true,
        clientX: point.x, clientY: point.y
      }));
      send('pointerdown', first); send('pointerdown', second);
      send('pointermove', {...first, x: first.x - 15});
      send('pointermove', {...second, x: second.x + 15});
      send('pointerup', first); send('pointerup', second);
    }, {first, second});
  }
  await waitForLayout(page);
  assert.ok(Number(await canvas.getAttribute('data-zoom-level')) > 1.2, 'A two-finger spread zooms the view');
  assert.deepEqual((await saved(page)).modelContent, before, 'Pinching does not drag the screen or change equipment');
  await page.locator('[data-zoom-reset]').click();
  await canvas.evaluate(element => {
    const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    const send = (type, id, px) => element.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', button: 0, bubbles: true, clientX: px, clientY: y
    }));
    send('pointerdown', 11, x - 40); send('pointerdown', 12, x + 40);
    send('pointermove', 11, x - 100); send('pointermove', 12, x + 100);
    send('pointerup', 11, x - 100); send('pointerup', 12, x + 100);
  });
  await waitForLayout(page);
  assert.equal(Number(await canvas.getAttribute('data-zoom-level')), 2.5);
  assert.ok(Math.abs(Number((await canvas.getAttribute('data-pan')).split(',')[0])) < .001, 'Symmetric pinching keeps the midpoint anchored without horizontal drift');
}

(async () => {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1, offline: true});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(targetUrl);
    const canvas = page.locator('canvas');
    assert.equal(await page.locator('[data-view="grating"]').count(), 1, 'The grating has its own view');
    assert.equal(await page.locator('[data-view="optics"]').textContent(), 'Линза и щель');
    for (const view of ['overview', 'top', 'optics', 'grating', 'screen']) {
      await page.locator(`[data-view="${view}"]`).click();
      assert.equal(await page.locator('[data-aperture]').isVisible(), true, `Aperture remains directly available in ${view}`);
    }
    await page.locator('[data-view="grating"]').click();
    const aperture = page.locator('[data-aperture]');
    assert.equal(await aperture.isVisible(), true);
    assert.equal(await aperture.inputValue(), '18');
    assert.equal(await aperture.getAttribute('min'), '10');
    assert.equal(await aperture.getAttribute('max'), '20');
    assert.equal(await aperture.getAttribute('step'), '0.5');
    const largeHole = await canvas.evaluate(element => element.toDataURL());
    await aperture.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    assert.equal(await aperture.inputValue(), '10.5', 'Keyboard adjustment uses half-millimeter steps');
    assert.equal(await canvas.getAttribute('data-aperture-mm'), '10.5');
    assert.notEqual(await canvas.evaluate(element => element.toDataURL()), largeHole, 'Changing the diameter changes the grating itself');
    await page.reload();
    assert.equal(await aperture.inputValue(), '10.5', 'Aperture and its view survive reopening');
    assert.equal(await page.locator('[data-view="grating"]').getAttribute('aria-pressed'), 'true');
    for (const [input, expected] of [[1, 10], [2, 10], [9.5, 10], [10, 10], [25, 20], [12.26, 12.5], [null, 18]]) {
      await seed(page, {view: 'grating', apertureMm: input, screenMm: 303, light: true, filter: 'none'});
      assert.equal(Number(await aperture.inputValue()), expected, `Saved aperture ${input} restores safely`);
    }
    await testFilters(page);
    await seed(page, {view: 'screen', filter: 'green', screenMm: 303, apertureMm: 12.5, light: true}, {zoom: 999, panX: 9, panY: -9, values: true});
    assert.equal(await page.locator('[data-filter]').inputValue(), 'green', 'A saved green filter remains green');
    assert.equal(await canvas.getAttribute('data-zoom-level'), '3');
    assert.equal(await canvas.getAttribute('data-pan'), '1.5000,-1.5000');
    await page.locator('[data-zoom-reset]').click();
    const equipment = (await saved(page)).modelContent;
    await canvas.scrollIntoViewIfNeeded();
    let bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .57, bounds.y + bounds.height * .4);
    const millimeters = Number(await canvas.getAttribute('data-ruler-mm'));
    assert.ok(millimeters > 0 && millimeters < 100);
    await page.locator('[data-zoom="1"]').click();
    assert.equal(await page.locator('[data-zoom-reset]').textContent(), '125%');
    bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * (.5 + .07 * 1.25), bounds.y + bounds.height * (.5 - .1 * 1.25));
    assert.ok(Math.abs(Number(await canvas.getAttribute('data-ruler-mm')) - millimeters) <= 1, 'Zoom preserves the ruler calibration in physical millimeters');
    await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .4);
    await page.mouse.wheel(0, -120);
    await waitForLayout(page);
    assert.ok(Number(await canvas.getAttribute('data-zoom-level')) > 1.25, 'Mouse wheel zooms');
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .45);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    assert.notEqual(await canvas.getAttribute('data-pan'), '0.0000,0.0000', 'Shift-drag pans the view');
    await page.locator('[data-zoom-reset]').click();
    assert.equal(await canvas.getAttribute('data-zoom-level'), '1');
    assert.equal(await canvas.getAttribute('data-pan'), '0.0000,0.0000');
    assert.deepEqual((await saved(page)).modelContent, equipment, 'Resetting the view does not reset any equipment');
    // The control window remains usable while the scene is minimized.
    const sceneMinimize = page.locator('.xp-scene-window [data-window-action="minimize"]');
    await sceneMinimize.click();
    await page.locator('[data-view="grating"]').click();
    assert.equal(await page.locator('[data-view="grating"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await aperture.isVisible(), true, 'Aperture can be edited while the scene is minimized');
    await page.locator('[data-zoom="1"]').click();
    assert.equal(await page.locator('[data-zoom-reset]').textContent(), '125%', 'Hidden scene still synchronizes controls');
    await aperture.focus();
    await page.keyboard.press('End');
    assert.equal(await page.locator('[data-aperture-value]').textContent(), '20 мм');
    await sceneMinimize.click();
    await waitForLayout(page);
    assert.equal(await canvas.getAttribute('data-aperture-mm'), '20');
    assert.equal(await canvas.getAttribute('data-zoom-level'), '1.25');
    await page.locator('[data-zoom-reset]').click();
    await testWindows(page, false);
    await page.setViewportSize({width: 320, height: 568});
    for (const view of ['overview', 'top', 'optics', 'grating', 'screen']) {
      await page.locator(`[data-view="${view}"]`).click();
      await noOverflow(page, `${view} at 320px`);
    }
    assert.deepEqual(errors, [], 'Desktop controls and window combinations have no JavaScript errors');
    await context.close();

    const touch = await browser.newContext({viewport: {width: 320, height: 568}, hasTouch: true, isMobile: true, deviceScaleFactor: 1, offline: true, reducedMotion: 'reduce'});
    const phone = await touch.newPage();
    const touchErrors = [];
    phone.on('pageerror', error => touchErrors.push(error.message));
    await phone.goto(targetUrl);
    await testPinch(phone, touch);
    await testWindows(phone, true);
    await noOverflow(phone, 'Touch phone');
    assert.deepEqual(touchErrors, [], 'Touch gestures and windows have no JavaScript errors');
    await touch.close();
    console.log('Features: 10–20 mm aperture, all-view controls, three colored filters, persistence, calibrated zoom, panning, pinch, safe windows and 320px layout passed.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
