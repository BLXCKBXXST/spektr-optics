const {launchBrowser, targetUrl, screenshotPath, waitForLayout} = require('./helpers/browser.cjs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await launchBrowser();
  try {
  const page = await browser.newPage({viewport:{width:1060,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
  await page.goto(targetUrl);
  const app=page;
  await app.locator('#optics-xp-sketch canvas').waitFor();
  assert.equal(await app.locator('.xp-version').count(),0,'No draft label in the header');
  assert.equal(await app.locator('.xp-status').count(),0,'No extra footer copy');
  await app.locator('#optics-xp-sketch').screenshot({path:screenshotPath('xp-overview.png')});
  for (const view of ['top','optics','grating','screen']) {
    await app.locator('[data-view="'+view+'"]').click();
    await app.locator('#optics-xp-sketch').screenshot({path:screenshotPath('xp-'+view+'.png')});
  }
  if(process.argv.includes('--quick')){
    const frame=page;
    const renderMs=await frame.evaluate(()=>{const start=performance.now();document.querySelector('[data-view="overview"]').click();return performance.now()-start;});
    const moveMs=await frame.evaluate(()=>{const start=performance.now();document.querySelector('[data-move="10"]').click();return performance.now()-start;});
    console.log(JSON.stringify({errors,renderMs,moveMs},null,2));return;
  }
  const canvas=app.locator('canvas');
  const on=await canvas.evaluate(c=>c.toDataURL());
  await app.locator('[data-light]').uncheck();
  assert.notEqual(await canvas.evaluate(c=>c.toDataURL()),on,'Light switch changes the sketch');
  await app.locator('[data-light]').check();
  const filterImages=[on];
  for(const filter of ['red','green','blue']){
    await app.locator('[data-filter]').selectOption(filter);
    filterImages.push(await canvas.evaluate(c=>c.toDataURL()));
  }
  assert.equal(new Set(filterImages).size,4,'Red, green, blue, and unfiltered spectra all differ');
  await app.locator('[data-filter]').selectOption('none');
  await app.locator('[data-view="top"]').click();
  await app.locator('[data-move="10"]').click();
  assert.match(await app.locator('[data-live]').textContent(),/260/);
  await app.locator('[data-move="-10"]').click();
  const frame=page;
  const bounds=await canvas.boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.22,bounds.y+bounds.height*.54);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.32,bounds.y+bounds.height*.54,{steps:6});
  await page.mouse.up();
  const dragged=await app.locator('[data-live]').textContent();
  assert.ok(/миллиметров/.test(dragged)&&!dragged.includes('250'),'Screen can be dragged');
  await frame.evaluate(()=>{for(let i=0;i<70;i++)document.querySelector('[data-move="10"]').click();});
  assert.equal(await app.locator('[data-move="10"]').isDisabled(),true);
  assert.match(await app.locator('[data-live]').textContent(),/650/);
  await frame.evaluate(()=>{for(let i=0;i<70;i++)document.querySelector('[data-move="-10"]').click();});
  assert.equal(await app.locator('[data-move="-10"]').isDisabled(),true);
  assert.match(await app.locator('[data-live]').textContent(),/100/);
  await frame.evaluate(()=>{for(let i=0;i<15;i++)document.querySelector('[data-move="10"]').click();});
  await app.locator('[data-view="overview"]').click();
  await frame.evaluate(()=>window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{view:'overview',screenMm:380,filter:'none',light:true}}}})));
  await app.locator('#optics-xp-sketch').screenshot({path:screenshotPath('xp-overview-380.png')});
  await app.locator('[data-move="10"]').click();
  assert.match(await app.locator('[data-live]').textContent(),/390/,'Restored screen state is retained');
  await frame.evaluate(()=>window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{modelContent:{view:'overview',screenMm:250,filter:'none',light:true},privateContent:{labels:true}}}}})));
  for(const width of [736,375,320]) {
    await page.setViewportSize({width,height:1000});
    await waitForLayout(page);
    const sizes=await frame.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));
    assert.ok(sizes.scroll<=sizes.width+1,`No horizontal overflow at ${width}: ${JSON.stringify(sizes)}`);
    await app.locator('#optics-xp-sketch').screenshot({path:screenshotPath('xp-width-'+width+'.png')});
    if(width===320){await app.locator('[data-view="optics"]').click();await app.locator('#optics-xp-sketch').screenshot({path:screenshotPath('xp-optics-320.png')});}
  }
  console.log(JSON.stringify({errors,checks:'Light, filters, drag, 100–650 mm limits, five views and 320/375/736 responsive widths checked'},null,2));
  if(errors.length)process.exitCode=1;
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
