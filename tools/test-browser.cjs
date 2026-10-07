// Development-only browser tooling. Nothing here is loaded by the simulator.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

function loadPlaywright() {
  const moduleName = process.env.SPEKTR_PLAYWRIGHT_MODULE || 'playwright';
  try {
    return require(moduleName);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    throw new Error('Browser tests need Playwright: run npm install and npx playwright install chromium, or set SPEKTR_PLAYWRIGHT_MODULE. The simulator itself has no dependencies.', {cause: error});
  }
}

const playwright = loadPlaywright();
const engineName = process.env.SPEKTR_BROWSER || 'chromium';
const engine = playwright[engineName];
if (!engine || typeof engine.launch !== 'function') throw new Error(`Unsupported browser: ${engineName}`);
const target = path.resolve(process.env.SPEKTR_TEST_FILE || path.join(__dirname, '../portable/spektr.html'));
const output = path.resolve(process.env.SPEKTR_TEST_OUTPUT || path.join(__dirname, '../tests/test-output'));

async function launchBrowser({args = [], ...options} = {}) {
  const executablePath = process.env.SPEKTR_BROWSER_EXECUTABLE || process.env.SPEKTR_CHROMIUM_EXECUTABLE ||
    (engineName === 'chromium' && !fs.existsSync(engine.executablePath()) && fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  return engine.launch({headless: true, ...(executablePath ? {executablePath} : {}),
    ...(engineName === 'chromium' ? {args: ['--no-sandbox', ...args]} : {}), ...options});
}

function screenshotPath(filename) {
  fs.mkdirSync(output, {recursive: true});
  return path.join(output, filename);
}

async function waitForLayout(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

module.exports = {playwright, engineName, launchBrowser, target, targetUrl: pathToFileURL(target).href, output, screenshotPath, waitForLayout};
