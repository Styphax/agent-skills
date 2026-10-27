import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as v from '../scripts/vw_lease_rates.mjs';

const URL='https://www.volkswagen.de/de/modelle/verfuegbare-fahrzeuge-suche.html/__app/search/cars.app?t_model-app=BQJA&t_model-app=BQJC';
const args=(extra=[])=>v.parseArgs(['--url',URL,...extra]);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const car=(key='VW1')=>({key,vin:'TESTVIN',title:'VW Test',model:{mbv:{code:'CODE'}},modelyear:{value:'2025'},initialreg:'2025-01-01',parsedPrice:{value:30000.50},dealer:{hid:'DEU12345'},finance:{monthlyRate:199},mileage:{raw_value:12000}});
function response(term=36,mileage=10000,down=0) {return {Response:{Product:{'@ID':'PL',Parameter:[{'@ID':'Duration','#text':String(term)},{'@ID':'Mileage','#text':String(mileage)},{'@ID':'DownPayment','#text':String(down)}]},Payment:{'@ID':'Rate',Value:{'@Value':'349.99'}}}};}
async function mock(t,fn) {const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=old;process.exitCode=0;});}
async function quiet(t) {const old=process.stdout.write;process.stdout.write=()=>true;t.after(()=>process.stdout.write=old);}
async function outputDir(t) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vw-lease-test-'));t.after(async()=>{const rel=path.relative(os.tmpdir(),dir);assert.ok(!path.isAbsolute(rel)&&!rel.startsWith('..')&&path.basename(dir).startsWith('vw-lease-test-'));await fs.rm(dir,{recursive:true});});return dir;}
function mainMock({error=false,mismatch=false,duplicate=false,missingConfirmation=false}={}) {return async(u,o={})=>{
 const url=new globalThis.URL(u);
 if(url.pathname.endsWith('global-config.json'))return json({spaAsyncConfig:{oneApiConfiguration:{apiKey:'public-test-key'},serviceConfigEndpoint:{endpoint:'mock'}}});
 if(url.hostname==='www.volkswagen.de')return new Response('"instanceConfig":'+JSON.stringify(JSON.stringify({baseUrl:'https://mock.gsl.feature-app.io'})));
 if(url.pathname==='/bff/car/search')return json({cars:duplicate?[car(),car()]:[car()],meta:{pageMax:1,resultNumber:duplicate?2:1}});
 if(error)return json({Response:{Error:{Description:'No valid calculation'}}});
 if(missingConfirmation)return json({Response:{Payment:{'@ID':'Rate',Value:{'@Value':'199'}}}});
 const request=JSON.parse(o.body).Request;
 const params=Object.fromEntries(request.Product.Parameter.map(x=>[x['@ID'],Number(x['#text'])]));
 return json(response(mismatch?48:params.Duration,params.Mileage,params.DownPayment));
};}

test('CLI rejects invalid values, malformed ranges, foreign hosts and path prefixes',()=>{
 for(const flags of [['--term','36months'],['--mileage','10000.8'],['--down-payment','-100'],['--down-payment','abc'],['--down-payment','1,234.56'],['--terms','24-35'],['--terms','36,,48'],['--prefix','../escape'],['--unknown','1'],['--term']])assert.throws(()=>args(flags));
 assert.throws(()=>v.parseArgs(['--url','https://notvolkswagen.de/de/modelle/verfuegbare-fahrzeuge-suche.html']));assert.throws(()=>v.parseArgs(['--url','http://www.volkswagen.de/de/modelle/verfuegbare-fahrzeuge-suche.html']));assert.equal(args(['--down-payment','1000,50']).downPayment,1000.5);
});
test('terms and repeated model filters retain their requested meaning',()=>{
 assert.deepEqual(args(['--terms','24-36']).terms,[24,30,36]);assert.deepEqual(args(['--terms','36,24,24']).terms,[24,36]);
 const params=v.buildSearchParams(new globalThis.URL(URL+'&pageIndex-app=7'),1,args(),{oneApiKey:'test',endpoint:'mock'});
 assert.deepEqual(params.getAll('t_model'),['BQJA','BQJC']);assert.equal(params.get('page'),'1');assert.equal(params.has('pageIndex'),false);
});
test('source amounts support German and machine formats without losing cents',()=>{
 for(const [input,expected] of [['42.895',42895],['30.000,50 €',30000.5],['30000.50',30000.5],['1,234.56',1234.56],['abc',null]])assert.equal(v.parseAmount(input),expected);
 for(const request of v.webCalcPayloads(car(),args(),36))assert.equal(Number(request.Request.Vehicle.PriceTotal),30000.5);
});
test('vehicle links work for base pages, result pages and existing detail routes',()=>{
 for(const pathname of ['/de/modelle/verfuegbare-fahrzeuge-suche.html','/de/modelle/verfuegbare-fahrzeuge-suche.html/__app/search/cars.app','/de/modelle/verfuegbare-fahrzeuge-suche.html/__app/search/car/OLD.app']){
 const link=new globalThis.URL(v.detailUrl({key:'ABC='},new globalThis.URL('https://www.volkswagen.de'+pathname+'?pageIndex-app=7&t_model-app=BQJA')));
 assert.ok(link.pathname.endsWith('/__app/search/car/ABC%3D.app'));assert.equal(link.searchParams.get('t_model-app'),'BQJA');assert.equal(link.searchParams.has('pageIndex-app'),false);
 }
});
test('normalization never exposes search financing as a computed lease',()=>{
 const row=v.normalizeCar(car(),0,args(),new globalThis.URL(URL));assert.equal(row.monthlyGross,null);assert.equal(row.rateSource,null);assert.equal(row.totalGross,null);assert.equal(row.grossPrice,30000.5);
});
test('search paginates and validates the complete distinct count',async t=>{
 let calls=0;await mock(t,async()=>json({cars:[car('VW'+(++calls))],meta:{resultNumber:2,pageMax:2}}));const data=await v.fetchAllCars(new globalThis.URL(URL),{baseUrl:'https://example.com',oneApiKey:'test',endpoint:'mock'},args());assert.equal(data.complete,true);assert.equal(data.cars.length,2);assert.equal(calls,2);
});
test('duplicate vehicles are removed and incomplete distinct totals are flagged',async t=>{
 await mock(t,async()=>json({cars:[car(),car()],meta:{resultNumber:2,pageMax:1}}));const data=await v.fetchAllCars(new globalThis.URL(URL),{baseUrl:'https://example.com',oneApiKey:'test',endpoint:'mock'},args());assert.equal(data.cars.length,1);assert.equal(data.duplicatesRemoved,1);assert.equal(data.complete,false);assert.ok(data.warnings.length);
});
test('intentional page caps and empty follow-up pages are explicit partial results',async t=>{
 let calls=0;await mock(t,async()=>json({cars:++calls===1?[car()]:[],meta:{resultNumber:2,pageMax:2}}));
 let data=await v.fetchAllCars(new globalThis.URL(URL),{baseUrl:'https://example.com',oneApiKey:'test',endpoint:'mock'},args(['--max-pages','1']));assert.equal(data.complete,false);assert.match(data.warnings.join(' '),/max-pages=1/);
 calls=0;data=await v.fetchAllCars(new globalThis.URL(URL),{baseUrl:'https://example.com',oneApiKey:'test',endpoint:'mock'},args());assert.equal(data.complete,false);assert.equal(calls,2);
});
test('malformed search responses fail rather than appearing complete',async t=>{
 await mock(t,async()=>json({cars:[],meta:{}}));await assert.rejects(v.fetchAllCars(new globalThis.URL(URL),{baseUrl:'https://example.com',oneApiKey:'test',endpoint:'mock'},args()),/resultNumber/);
});
test('missing current search configuration does not fall back to a stale endpoint',async t=>{
 await mock(t,async u=>String(u).includes('global-config.json')?json({spaAsyncConfig:{oneApiConfiguration:{apiKey:'test'},serviceConfigEndpoint:{endpoint:'mock'}}}):new Response('<html></html>'));
 await assert.rejects(v.resolveRuntimeConfig(new globalThis.URL(URL)),/current search service URL/);
});
test('WebCalc product parameters are checked against the request',()=>{
 assert.equal(v.verifyWebCalcParameters(response(),args(),36).verified,true);
 for(const r of [response(48),response(36,5000),response(36,10000,1000)])assert.throws(()=>v.verifyWebCalcParameters(r,args(),36),/different/);
 const r=response();r.Response.Product['@ID']='FINANCING';assert.throws(()=>v.verifyWebCalcParameters(r,args(),36),/product/);
});
test('actual VW disclaimer and payment fields confirm all three parameters',()=>{
 const r={Response:{Disclaimers:{CalculationDisclaimer:{'#cdata-section':'Laufzeit 36 Monate, jährl. Fahrleistung 10.000 km, Sonderzahlung 1.000,50 EUR mit PrivatLeasing'},RateDetails:{'#cdata-section':'bei 36 Monaten Laufzeit, 10.000 km jährl. Fahrleistung und einer Sonderzahlung von 1.000,50 EUR.'}},Payment:{'@ID':'DownPayment',Value:{'@Value':'1000.50'}}}};
 assert.equal(v.verifyWebCalcParameters(r,args(['--down-payment','1000.50']),36).downPaymentGross,1000.5);
 r.Response.Disclaimers.RateDetails['#cdata-section']='bei 48 Monaten Laufzeit';assert.throws(()=>v.verifyWebCalcParameters(r,args(['--down-payment','1000.50']),36),/different/);
});
test('unconfirmed rates and invalid rates cannot count as successful quotes',async t=>{
 await mock(t,mainMock({missingConfirmation:true}));const r=await v.fetchWebCalcRate(car(),args());assert.equal(r.monthlyGross,null);assert.match(r.error,/does not confirm/);
});
test('fallback domain may recover a failed first domain with verified parameters',async t=>{
 let calls=0;await mock(t,async()=>json(++calls===1?{Response:{Error:{Description:'Unavailable'}}}:response()));const r=await v.fetchWebCalcRate(car(),args());assert.equal(r.monthlyGross,349.99);assert.equal(r.domain,'VW.ONESHOP.ECOM.DE');assert.equal(calls,2);
});
test('full main success writes only verified rate cells and cent-precise totals',async t=>{
 const dir=await outputDir(t);await quiet(t);await mock(t,mainMock());const result=await v.main(['--url',URL,'--out',dir,'--terms','24,36']);
 assert.equal(result.complete,true);assert.equal(result.meta.webCalcRateCells,2);assert.equal(result.rows[0].monthlyGross,349.99);assert.equal(result.rows[0].totalGross,12599.64);const md=await fs.readFile(path.join(dir,'vw-lease-rates.md'),'utf8');assert.match(md,/30\.000,50/);
});
test('failed WebCalc leaves null rates in JSON and n/a in Markdown',async t=>{
 const dir=await outputDir(t);await quiet(t);await mock(t,mainMock({error:true}));const result=await v.main(['--url',URL,'--out',dir]);
 assert.equal(result.rows[0].monthlyGross,null);assert.equal(result.rows[0].rateSource,null);assert.equal(result.rows[0].totalGross,null);assert.equal(result.meta.webCalcRateCells,0);assert.equal(result.complete,false);assert.equal(process.exitCode,2);
 assert.match(await fs.readFile(path.join(dir,'vw-lease-rates.md'),'utf8'),/n\/a/);
});
test('mismatched returned terms are unavailable rather than mislabeled',async t=>{
 const dir=await outputDir(t);await quiet(t);await mock(t,mainMock({mismatch:true}));const result=await v.main(['--url',URL,'--out',dir]);assert.equal(result.rows[0].monthlyGross,null);assert.equal(result.meta.webCalcRateCells,0);assert.match(result.rows[0].termRates[0].error,/different termMonths/);
});
test('no-webcalc preserves vehicle data without financing fallback or WebCalc calls',async t=>{
 const dir=await outputDir(t);await quiet(t);const fn=mainMock();await mock(t,(u,o)=>{assert.notEqual(new globalThis.URL(u).hostname,'api.webcalc.vwfs.io');return fn(u,o);});const r=await v.main(['--url',URL,'--out',dir,'--no-webcalc']);assert.equal(r.rows[0].monthlyGross,null);assert.equal(r.complete,true);assert.equal(r.meta.webCalcRequests,0);
});
test('totals use integer cents',()=>{assert.equal(v.totalGross(123.45,36,1000.5),5444.7);assert.equal(v.totalGross(null,36,0),null);});
test('HTTP retries are bounded and public service keys never enter errors',async t=>{
 let calls=0;await mock(t,async(u,o)=>{assert.ok(o.signal);return ++calls===1?json({},503):json({ok:true});});assert.equal((await v.fetchJson('https://example.com/')).ok,true);assert.equal(calls,2);
 calls=0;globalThis.fetch=async()=>{calls++;return new Response('public-test-key',{status:400});};await assert.rejects(v.fetchJson('https://example.com/?oneapiKey=public-test-key'),e=>!e.message.includes('public-test-key')&&!e.message.includes('oneapiKey='));assert.equal(calls,1);
 globalThis.fetch=async()=>new Response('x'.repeat(490)+'public-test-key',{status:400});await assert.rejects(v.fetchJson('https://example.com/?oneapiKey=public-test-key'),e=>!e.message.includes('public-t'));
});
test('timeouts abort stalled requests and do not loop indefinitely',async t=>{
 const dir=await outputDir(t);let calls=0;await mock(t,(u,o)=>{calls++;return new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true}));});const keepAlive=setInterval(()=>{},1000);try{await assert.rejects(v.main(['--url',URL,'--out',dir,'--timeout-ms','5']));assert.equal(calls,3);}finally{clearInterval(keepAlive);}
});
test('CLI help is runnable; invalid values exit without networking',()=>{
 const script=fileURLToPath(new globalThis.URL('../scripts/vw_lease_rates.mjs',import.meta.url));assert.equal(spawnSync(process.execPath,[script,'--help']).status,0);assert.equal(spawnSync(process.execPath,[script,'--url',URL,'--down-payment','abc']).status,1);
});
