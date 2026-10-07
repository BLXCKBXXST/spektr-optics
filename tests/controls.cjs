const {launchBrowser, targetUrl, screenshotPath, waitForLayout}=require('./helpers/browser.cjs');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await launchBrowser();
  try{
    const page=await browser.newPage({viewport:{width:1060,height:900},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push({message:e.message,stack:e.stack}));
    await page.goto(targetUrl);
    const app=page;await app.locator('canvas').waitFor();
    const frame=page,canvas=app.locator('canvas');
    const restore=async(screenMm,labels=false,values=true)=>frame.evaluate(({screenMm,labels,values})=>window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:{widgetState:{modelContent:{view:'top',screenMm,filter:'none',light:true},privateContent:{labels,values}}}}})),{screenMm,labels,values});
    const screenMm=async()=>Number((await app.locator('[data-live]').textContent()).match(/\d+/)?.[0]);
    assert.equal(await app.locator('.xp-toolbar input[type="checkbox"]').count(),3,'Names, values, and light switches share the toolbar');
    for(const selector of ['[data-labels]','[data-values]','[data-light]']){
      assert.equal(await app.locator(selector).evaluate(e=>Boolean(e.closest('.xp-toolbar'))),true);
    }
    assert.equal(await app.locator('.xp-controls').evaluate(e=>e.firstElementChild.matches('[data-filter]')||Boolean(e.firstElementChild.querySelector('[data-filter]'))),true,'Filter is first in the bottom control strip');
    const control=await app.locator('.xp-screen-control').evaluate(e=>{
      const left=e.querySelector('[data-move="-10"]'),right=e.querySelector('[data-move="10"]');
      const label=[...e.querySelectorAll('*')].find(n=>!n.closest('button')&&n.textContent.trim()==='Экран');
      const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
      return{left:box(left),label:label?box(label):null,right:box(right)};
    });
    assert.ok(control.label,'A separate centered screen label is present');
    assert.ok(control.left.x+control.left.width<=control.label.x&&control.label.x+control.label.width<=control.right.x,'Screen arrows flank the label');
    assert.ok(Math.abs((control.left.x+control.left.width+control.right.x)/2-(control.label.x+control.label.width/2))<2,'Screen label is centered between arrows');
    assert.ok([control.left,control.right].every(b=>b.width>=40&&b.height>=34),'Screen arrow hit targets are enlarged');
    for(const [start,move,expected] of [[303,10,310],[303,-10,300],[310,10,320],[310,-10,300],[309,10,310],[301,-10,300],[649,10,650],[101,-10,100]]){
      await restore(start);await app.locator(`[data-move="${move}"]`).click();
      assert.equal(await screenMm(),expected,`${start} with arrow ${move} aligns directionally to ${expected}`);
    }
    await restore(303,false,false);
    assert.equal(await app.locator('[data-labels]').isChecked(),false);
    assert.equal(await app.locator('[data-values]').isChecked(),false,'Independent toggle states restore');
    await app.locator('[data-labels]').check();
    assert.equal(await app.locator('[data-values]').isChecked(),false,'Names do not change values state');
    await app.locator('[data-values]').check();
    await app.locator('[data-labels]').uncheck();
    assert.equal(await app.locator('[data-values]').isChecked(),true,'Values remain enabled without names');
    await frame.evaluate(()=>{
      window.__positionText=[];
      const original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
        if(this.canvas===document.querySelector('#optics-xp-sketch canvas'))window.__positionText.push({text:String(text),x,y});
        return original.call(this,text,x,y,...args);
      };
    });
    const position=async(mm)=>{
      await frame.evaluate(()=>window.__positionText=[]);await restore(mm);
      return frame.evaluate(mm=>window.__positionText.findLast(p=>p.text===String(mm)||p.text===mm+' мм'),mm);
    };
    const first=await position(303),next=await position(313);
    assert.ok(first&&next,'Screen position indicator tracks manual screen coordinates');
    const scale=(next.x-first.x)/10;
    assert.ok(scale>.1&&scale<5,'Top-view position moves at a measurable linear scale');
    await restore(303);
    const bounds=await canvas.boundingBox();
    const logicalWidth=await canvas.evaluate(c=>c.width),pixelScale=bounds.width/logicalWidth;
    const mouseX=bounds.x+(first.x+15)*pixelScale;
    let mouseY=null;
    for(let fraction=.2;fraction<=.85;fraction+=.05){
      const y=bounds.y+bounds.height*fraction;await page.mouse.move(mouseX,y);
      if(await canvas.evaluate(c=>c.style.cursor)==='grab'){mouseY=y;break;}
    }
    assert.notEqual(mouseY,null,'The overview/top screen remains draggable');
    await page.mouse.down();await page.mouse.move(mouseX+scale*pixelScale,mouseY);await page.mouse.up();
    assert.equal(await screenMm(),304,'Free dragging can advance by exactly 1 mm, not just multiples of 10');
    await app.locator('[data-move="10"]').click();
    assert.equal(await screenMm(),310,'An arrow aligns a freely dragged position to the next 10-mm mark');
    for(const width of [736,375,320]){
      await page.setViewportSize({width,height:1000});
      await waitForLayout(page);
      const layout=await frame.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth,filter:document.querySelector('[data-filter]').getBoundingClientRect().x,controls:document.querySelector('.xp-controls').getBoundingClientRect().x}));
      assert.ok(layout.scroll<=layout.width+1,`No horizontal overflow at ${width}`);
      assert.ok(layout.filter-layout.controls<100,`Filter remains at the left of the control strip at ${width}`);
      await app.locator('#optics-xp-sketch').screenshot({path:screenshotPath(`xp-values-controls-${width}.png`)});
    }
    console.log(JSON.stringify({errors,checks:'Three toolbar toggles, left-aligned filter, enlarged flanking arrows, directional 10-mm snapping, independent/restored values, 1-mm dragging, responsive controls'},null,2));
    if(errors.length)process.exitCode=1;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
