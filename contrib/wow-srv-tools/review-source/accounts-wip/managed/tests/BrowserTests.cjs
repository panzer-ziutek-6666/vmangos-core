'use strict';
// Optional offline UI suite. Requires Node + Playwright/Chromium; not installed or run by the WOW-SRV staging script.
const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const web = path.resolve(__dirname, '../src/Vmangos.AdminPanel/wwwroot');
let passed = 0;
const secret = () => Array.from({length:16}, ()=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[crypto.randomInt(36)]).join('');
(async () => {
  const browser = await chromium.launch({headless:true,executablePath:process.env.VMANGOS_TEST_CHROMIUM || undefined});
  try {
    async function scenario(label, options, action) {
      const context = await browser.newContext({viewport:{width:1280,height:1000}});
      const page = await context.newPage();
      const posts = [], statusQueries = [];
      let lastId;
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname === '/api/accounts/create') {
          const body = request.postDataJSON(); posts.push(body); lastId = body.operationId;
          if (options.networkFailure) return route.abort('failed');
          if (options.error) return route.fulfill({status:options.error.status,contentType:'application/json',body:JSON.stringify(options.error.body)});
          return route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({operationId:lastId,accountName:'PLAYERONE',state:'succeeded',errorCode:'None',dispatchAttempts:1,accountId:101})});
        }
        if (url.pathname.startsWith('/api/accounts/operations/')) {
          statusQueries.push(request.url());
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({operationId:lastId,accountName:'PLAYERONE',state:'succeeded',dispatchAttempts:1,accountId:101})});
        }
        const api = {
          '/api/accounts/capabilities':{enabled:options.enabled===true,liveReady:false,mode:'offline_fake'},
          '/api/csrf':{requestToken:'offline-fixture-token'},
          '/api/identity':{controlAllowed:false},
          '/api/telemetry':{state:'missing'},
          '/api/status':{user:'fixture',status:{ready:true,host:'WOW-SRV',timestamp:new Date().toISOString(),systemUptimeSeconds:60,mangosdUptimeSeconds:30,services:{mysql:{state:'Running',processId:101,portListening:true,ready:true},realmd:{state:'Running',processId:102,portListening:true,ready:true},mangosd:{state:'Running',processId:103,portListening:true,ready:true}},soap:{listening:true,localOnly:true}}}
        };
        if (Object.hasOwn(api,url.pathname)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(api[url.pathname])});
        const assets = {'/':'index.html','/accounts.css':'accounts.css','/accounts.js':'accounts.js'};
        if (Object.hasOwn(assets,url.pathname)) return route.fulfill({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(path.join(web,assets[url.pathname]))});
        return route.fulfill({status:404,body:''});
      });
      try {
        await page.goto((options.http?'http':'https')+'://a130.test/');
        await page.waitForFunction(() => !document.getElementById('accountNote').textContent.startsWith('Sprawdzanie'));
        await action(page,posts,statusQueries);
        passed++; console.log('PASS '+label);
      } catch(error) {
        console.log('BROWSER_CASE_FAILED='+label+' TYPE='+error.name);
        const point=String(error.stack||'').split('\n').find(line=>line.includes('BrowserTests.cjs:'));
        if(point) console.log('TEST_LOCATION='+point.trim());
        throw error;
      } finally { await context.close(); }
    }
    async function fill(page,password) {
      await page.locator('#createAccount').click();
      await page.locator('#accountName').fill('PlayerOne');
      await page.locator('#accountPassword').fill(password);
      await page.locator('#accountRepeat').fill(password);
    }
    await scenario('http_never_opens_password_form',{http:true},async(page,posts)=>{
      assert(await page.locator('#createAccount').isDisabled()); assert(await page.locator('#accountForm').isHidden()); assert.equal(posts.length,0);
    });
    await scenario('disabled_capability_keeps_form_closed',{},async(page,posts)=>{
      assert(await page.locator('#createAccount').isDisabled()); assert(await page.locator('#accountPassword').isDisabled()); assert.equal(posts.length,0);
    });
    await scenario('fake_success_clears_secrets_and_never_reposts_on_refresh',{enabled:true},async(page,posts)=>{
      const password=secret(); await fill(page,password);
      await page.locator('#accountShow').check(); assert.equal(await page.locator('#accountPassword').getAttribute('type'),'text');
      await page.locator('#accountSubmit').click();
      await page.waitForFunction(()=>document.getElementById('accountResult').textContent.includes('zweryfikowane'));
      assert.equal(posts.length,1); assert.equal(posts[0].password,password); assert.equal(await page.locator('#accountPassword').inputValue(),'');
      assert.equal(await page.locator('#accountRepeat').inputValue(),''); assert(await page.locator('#accountSubmit').isDisabled());
      assert(!(await page.locator('#accountResult').innerText()).includes(password));
      assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
      await page.reload(); assert.equal(posts.length,1);
    });
    await scenario('csrf_400_does_not_auto_retry',{enabled:true,error:{status:400,body:{errorCode:'CSRF_INVALID'}}},async(page,posts)=>{
      await fill(page,secret()); await page.locator('#accountSubmit').click();
      await page.waitForFunction(()=>document.getElementById('accountResult').textContent.includes('CSRF_INVALID'));
      assert.equal(posts.length,1); assert(await page.locator('#accountSubmit').isDisabled());
      assert(!(await page.locator('#accountReset').isDisabled()));
    });
    await scenario('unknown_503_locks_new_id_and_poll_has_no_password',{enabled:true,error:{status:503,body:{errorCode:'UNAVAILABLE'}}},async(page,posts,queries)=>{
      const password=secret(); await fill(page,password); await page.locator('#accountSubmit').click();
      await page.waitForFunction(()=>document.getElementById('accountResult').textContent.includes('wiarygodnego'));
      assert.equal(posts.length,1); assert(await page.locator('#accountReset').isDisabled());
      await page.locator('#accountCheck').click();
      await page.waitForFunction(()=>document.getElementById('accountResult').textContent.includes('zweryfikowane'));
      assert.equal(posts.length,1); assert.equal(queries.length,1); assert(!queries[0].includes(password));
    });
    await scenario('lost_response_keeps_request_locked',{enabled:true,networkFailure:true},async(page,posts)=>{
      await fill(page,secret()); await page.locator('#accountSubmit').click();
      await page.waitForFunction(()=>document.getElementById('accountResult').textContent.includes('Konto mogło powstać'));
      assert.equal(posts.length,1); assert(await page.locator('#accountReset').isDisabled()); assert.equal(await page.locator('#accountPassword').inputValue(),'');
    });
    await scenario('password_repeat_validation_zero_post',{enabled:true},async(page,posts)=>{
      await fill(page,secret()); await page.locator('#accountRepeat').fill(secret()); await page.locator('#accountSubmit').click();
      await page.waitForFunction(()=>document.getElementById('accountResult').textContent.includes('Sprawdź nazwę')); assert.equal(posts.length,0);
    });
    console.log('BROWSER_TESTS_PASSED='+passed+' REAL_NETWORK_CONNECTIONS=0');
  } finally { await browser.close(); }
})().catch(()=>{ console.log('BROWSER_TESTS_FAILED=True');process.exitCode=1; });
