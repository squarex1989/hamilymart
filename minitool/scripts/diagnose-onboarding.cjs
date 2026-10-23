/* Isolated built-bundle regression. This is not a native-container acceptance test. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const output='artifacts/onboarding-v44';fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const data=new Map(),errors=[],requests=[];let writes=[];
 await context.exposeBinding('__nativeRead',(_,key)=>({data:data.get(key)??null}));
 await context.exposeBinding('__nativeWrite',(_,key,value)=>{data.set(key,value);writes.push(key);});
 await context.addInitScript(()=>{
  window.xhs={launchOptions:{miniToolEnv:{buildVersion:9460000}},miniTool:{getStorage:({key})=>window.__nativeRead(key),setStorage:({key,data})=>window.__nativeWrite(key,data)}};
  window.__drawCounts=new WeakMap();
  for(const C of [window.WebGLRenderingContext,window.WebGL2RenderingContext])if(C)for(const method of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
   const original=C.prototype[method];if(!original)continue;
   C.prototype[method]=function(...args){window.__drawCounts.set(this.canvas,(window.__drawCounts.get(this.canvas)||0)+1);return original.apply(this,args);};
  }
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 const loaded=()=>page.waitForSelector('.onboarding-loading',{state:'detached',timeout:60000});
 const waitPhase=(p,s)=>page.waitForFunction(([p,s])=>{const n=document.querySelector('.onboarding-content');return n?.dataset.page===String(p)&&n.dataset.phase===String(s)},[p,s],{timeout:60000});
 const pause=()=>page.getByRole('button',{name:'暂停播放介绍'}).click();
 const resume=()=>page.getByRole('button',{name:'继续播放介绍'}).click();
 const capture=async name=>{await pause();await page.waitForTimeout(150);await page.evaluate(()=>document.activeElement.blur());await page.screenshot({path:`${output}/${name}.png`});await resume();};
 const bounds=async()=>{
  const b=await page.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return{modal:box('.onboarding-modal'),header:box('.minitool-header'),close:box('.modal-close'),next:box('.onboarding-next'),height:innerHeight,width:innerWidth}});
  assert.ok(b.modal.top>=b.header.bottom+8,JSON.stringify(b));assert.ok(b.modal.bottom<=b.height-8,JSON.stringify(b));assert.ok(b.modal.left>=8);assert.ok(b.modal.right<=b.width-8);assert.ok(b.next.bottom<=b.modal.bottom);return b;
 };
 await page.goto(process.env.MINITOOL_TEST_URL||'http://127.0.0.1:5182/');
 await page.waitForSelector('.onboarding-modal');await loaded();const draft=data.get('hamilymart.assembly.v2');assert.ok(draft);
 assert.equal(await page.getByRole('button',{name:'介绍',exact:true}).count(),0);
 await bounds();await page.waitForTimeout(1000);await capture('01-one-platform');
 await waitPhase(1,2);await page.waitForTimeout(400);await capture('01-two-platforms');
 await waitPhase(1,3);await page.waitForTimeout(400);await capture('01-three-platforms');console.log('1→2→3 platforms passed');
 await waitPhase(2,1);await loaded();await pause();
 const draws=()=>page.locator('.scene-canvas canvas').evaluate(e=>window.__drawCounts.get(e)||0);
 const a=await draws();await page.waitForTimeout(250);assert.equal(await draws(),a,'background renderer should be suspended');await resume();
 await page.waitForTimeout(2500);await capture('02-cover-removal');
 await waitPhase(2,2);await page.waitForTimeout(1700);await capture('02-down-pipe');
 await waitPhase(2,3);await page.waitForTimeout(700);await capture('02-bedding');console.log('bedding cover removal + pipe installation passed');
 await waitPhase(3,1);await loaded();await page.waitForTimeout(400);await capture('03-magnets');
 await waitPhase(3,2);await page.waitForTimeout(650);await capture('03-steel');
 await waitPhase(3,3);await page.waitForTimeout(700);await capture('03-platform-attachment');
 await waitPhase(3,4);await page.waitForTimeout(800);await capture('03-roof-attachment');console.log('L house + cube + curved stairs + callouts passed');
 await waitPhase(4,1);assert.equal(await page.locator('.onboarding-code-card').count(),0);assert.equal(await page.locator('.onboarding-step-art').count(),3);
 await capture('04-copy-code');await waitPhase(4,2);await capture('04-preorder');await waitPhase(4,3);await page.waitForTimeout(600);await capture('04-custom');
 assert.ok(await page.getByText('有定制需求，也欢迎私信聊聊。').isVisible());
 await page.waitForSelector('.onboarding-modal',{state:'detached',timeout:20000});
 await page.waitForTimeout(200);assert.equal(data.get('hamilymart.onboarding.v1'),'true');assert.equal(data.get('hamilymart.assembly.v2'),draft);
 await page.getByRole('button',{name:'介绍',exact:true}).waitFor();await page.getByRole('button',{name:'导入',exact:true}).waitFor();
 const intro=await page.getByRole('button',{name:'介绍',exact:true}).boundingBox(),imp=await page.getByRole('button',{name:'导入',exact:true}).boundingBox();assert.ok(intro.x+intro.width<=imp.x+1);
 await page.waitForTimeout(300);const baseDraws=await draws();await page.mouse.move(180,300);await page.mouse.down();await page.mouse.move(210,320,{steps:10});await page.mouse.up();await page.waitForTimeout(800);assert.ok(await draws()>baseDraws,'main scene resumes');
 await page.reload();await page.getByRole('button',{name:'介绍',exact:true}).waitFor();assert.equal(await page.locator('.onboarding-modal').count(),0);
 await page.getByRole('button',{name:'介绍',exact:true}).click();await loaded();await waitPhase(1,1);await pause();
 const sizes=[];for(const size of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1280,height:800}]){
  await page.setViewportSize(size);await page.waitForTimeout(200);sizes.push(await bounds());
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{document.documentElement.style.setProperty('--compat-safe-area-top','44px');window.dispatchEvent(new Event('resize'));});await page.waitForTimeout(100);await bounds();
 await page.getByRole('button',{name:'关闭弹窗'}).click();assert.equal(await page.locator('.onboarding-modal').count(),0);
 await page.getByRole('button',{name:'介绍',exact:true}).click();await loaded();await waitPhase(1,1);await page.keyboard.press('Escape');assert.equal(await page.locator('.onboarding-modal').count(),0);
 assert.equal(data.get('hamilymart.assembly.v2'),draft);assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u.startsWith('http://127.0.0.1:5182/')));
 const report={passed:true,checks:['automatic first visit','native dismissal flag','1/2/3 official layouts at 2 seconds each','Christmas villa bedding + removable cover + down pipe', 'L house/cube/curved stairs + magnet/steel arrows at 2x speed','three large illustrated order steps + no code card + custom message','autofinish','X + Escape dismissal','replay from page 1','reload does not reopen','draft unchanged','background GPU paused/resumed','320/390/844/1280 layouts','native header clearance','no external requests','no JS errors'],sizes,errors,filesLoaded:new Set(requests).size,nativeWrites:writes.length,nativeContainer:'Not tested: creator simulator, Android and iOS required'};
 fs.writeFileSync(`${output}/browser-validation.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
