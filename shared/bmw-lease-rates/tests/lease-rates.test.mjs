import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as b from '../scripts/bmw_lease_rates.mjs';

const URL='https://www.bmw.de/de-de/sl/gebrauchtwagen/results';
const args=(extra=[])=>b.parseArgs(['--url',URL,...extra]);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
const pv=(key,value)=>({key,value:[{key:'value',value}]});
const interaction=id=>Buffer.from(JSON.stringify({id})).toString('base64');
function lease(id='one',customerType='PRIVATE') {return {calculationId:id,interactionId:interaction(id),info:{productBaseType:'LEASE',customerType},parameterValues:[
 {key:'term',value:[{key:'allowedValues',value:[24,36]}]}, {key:'annualMileage',value:[{key:'allowedValues',value:[10000]}]},
 {key:'downPaymentAmount/grossAmount',value:[{key:'allowedRange',value:{minimum:0,maximum:1000}}]},
]};}
function hit(id='BMW1') {return {vehicle:{vssId:id,price:{grossSalesPrice:40000.50},vehicleSpecification:{modelAndOption:{model:{modelDescription:{de_DE:'BMW i4 Test'}}}},ordering:{retailData:{buNo:'12345',locationOutletAddress:{postalCode:'80331',town:'München'}}}}};}
function calc(id='one',down=0,rate=400,term=36) {return {info:{customerType:'PRIVATE'},calculationId:id,interactionId:interaction(id),parameterValues:[pv('term',term),pv('annualMileage',10000),pv('downPaymentAmount/grossAmount',down),pv('downPaymentAmount/netAmount',Math.round(down/1.19*100)/100),pv('totalInstallment/grossAmount',rate),pv('sumOfAllTotalPayments/grossAmount',rate*term+down)]};}
async function mock(t,fn) {const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=old;process.exitCode=0;delete b.HEADERS['x-api-key'];});}
async function outputDir(t) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bmw-lease-test-'));t.after(async()=>{const rel=path.relative(os.tmpdir(),dir);assert.ok(!path.isAbsolute(rel)&&!rel.startsWith('..')&&path.basename(dir).startsWith('bmw-lease-test-'));await fs.rm(dir,{recursive:true});});return dir;}
async function quiet(t) {const old=console.log;const messages=[];console.log=x=>messages.push(String(x));t.after(()=>console.log=old);return messages;}
function financeMock({leases=[lease()],rate=400,term=36,missingRate=false}={}) {return async(u,o={})=>{
 const url=new globalThis.URL(u); const body=o.body?JSON.parse(o.body):null;
 if(url.hostname==='www.bmw.de')return new Response('"apiKey":"'+'a'.repeat(40)+'"');
 if(url.pathname.includes('vehiclesearch'))return json({metadata:{totalCount:2},hits:[hit('BMW1'),hit('BMW2')]});
 if(url.pathname.endsWith('/open'))return json({data:leases});
 const id=body.externalReference.selectedCalculation;
 if(id==='bad')return json({error:'Product unavailable'},400);
 const down=Number(body.changedParameters.changedParameters.find(x=>x.key==='downPaymentAmount/grossAmount')?.value??0);
 const result=calc(id,down,typeof rate==='function'?rate(id):rate,term);
 if(missingRate)result.parameterValues=result.parameterValues.filter(x=>x.key!=='totalInstallment/grossAmount');
 return json({data:result});
};}

test('CLI rejects invalid values, options, domains and missing arguments',()=>{
 for(const flags of [['--term','abc'],['--term','36months'],['--mileage','-20'],['--mileage','10000.8'],['--down-payment','-100'],['--down-payment','abc'],['--down-payment','1,234.56'],['--typo','1'],['--term']]) assert.throws(()=>args(flags));
 assert.throws(()=>b.parseArgs(['--url','https://notbmw.de/de-de/sl/gebrauchtwagen']));
 assert.throws(()=>b.parseArgs(['--url',URL+'?dealer=123']));
 assert.throws(()=>b.parseArgs([]));assert.equal(args(['--down-payment','1000,50']).downPayment,1000.5);
});
test('URL filters preserve both bounds, units, mileage and installment flag',()=>{
 const filters={MARKETING_MODEL_RANGE:['i4_G26E'],PERFORMANCE:[200,250,true],USED_CAR_MILEAGE:[0,40000],IS_INSTALLMENT:false};
 let body=b.buildSearchBody({url:URL+'?filters='+encodeURIComponent(JSON.stringify(filters))});
 assert.deepEqual(body.searchContext[0].technicalData.powerBasedOnDegreeOfElectrificationKw,[{minValue:200,maxValue:250}]);
 assert.deepEqual(body.searchContext[0].usedCarData.mileageRanges,[{minValue:0,maxValue:40000}]);assert.equal(body.isMonthlyInstallmentFilterSelected,false);
 filters.PERFORMANCE=[200,250,false];body=b.buildSearchBody({url:URL+'?filters='+encodeURIComponent(JSON.stringify(filters))});
 assert.ok(body.searchContext[0].technicalData.powerBasedOnDegreeOfElectrificationPs);
 filters.PERFORMANCE=[null,250];body=b.buildSearchBody({url:URL+'?filters='+encodeURIComponent(JSON.stringify(filters))});
 assert.deepEqual(body.searchContext[0].technicalData.powerBasedOnDegreeOfElectrificationPs,[{maxValue:250}]);
});
test('unsupported or malformed filters fail before any network request',()=>{
 for(const filters of [{PRICE:[0,50000]},{PERFORMANCE:[250,200,true]},{PERFORMANCE:[200,250,'kW']},{PRODUCT_CATEGORY_TYPE:['LOAN']},{COLOR:'BLACK'},{IS_INSTALLMENT:'false'}]) assert.throws(()=>b.buildSearchBody({url:URL+'?filters='+encodeURIComponent(JSON.stringify(filters))}));
});
test('filter decoding does not decode literal percent characters twice',()=>{
 assert.equal(b.decodeFilters(URL+'?filters='+encodeURIComponent(JSON.stringify({EQUIPMENT_GROUPS:{other:['100% test']}}))).EQUIPMENT_GROUPS.other[0],'100% test');
});
test('current BMW schema retains name, cents and dealer identity',()=>{
 const row=b.vehicleBase(hit());assert.equal(row.model,'BMW i4 Test');assert.equal(row.price,40000.5);assert.equal(row.dealer,'BMW Partner 12345, München');assert.equal(b.formatDe(null),'n/a');assert.equal(b.formatDe(NaN),'n/a');
});
test('search continues across short pages until advertised total',async t=>{
 let calls=0;await mock(t,async()=>json({metadata:{totalCount:2},hits:[hit('BMW'+(++calls))]}));
 const search=await b.loadHits(args());assert.equal(calls,2);assert.equal(search.complete,true);assert.equal(search.hits.length,2);
});
test('duplicate search vehicles are removed and missing distinct hits flagged',async t=>{
 await mock(t,async()=>json({metadata:{totalCount:2},hits:[hit(),hit()]}));const result=await b.loadHits(args());assert.equal(result.hits.length,1);assert.equal(result.duplicatesRemoved,1);assert.equal(result.complete,false);
});
test('missing hits, missing counts and missing vehicle keys are schema failures',async t=>{
 for(const data of [{metadata:{totalCount:1}}, {hits:[]},{metadata:{totalCount:1},hits:[{vehicle:{}}]}]) {await mock(t,async()=>json(data));await assert.rejects(b.loadHits(args()));}
});
test('page cap is explicitly marked as a partial search',async t=>{
 await mock(t,async()=>json({metadata:{totalCount:2},hits:[hit()]}));const result=await b.loadHits(args(['--max-pages','1']));assert.equal(result.complete,false);assert.match(result.warnings.join(' '),/max-pages=1/);
});
test('empty follow-up page cannot silently hide missing hits',async t=>{
 let calls=0;await mock(t,async()=>json({metadata:{totalCount:2},hits:++calls===1?[hit()]:[]}));const result=await b.loadHits(args());assert.equal(result.complete,false);assert.equal(calls,2);
});
test('a failed business product does not suppress a later private quote',async t=>{
 await mock(t,financeMock({leases:[lease('bad','BUSINESS'),lease('good')]}));const result=await b.priceVehicle(hit(),0,args());assert.equal(result.rows.length,1);assert.equal(result.privateQuoteCount,1);assert.equal(result.issues.length,1);assert.equal(result.issues[0].customerType,'BUSINESS');
});
test('unsupported terms and down payments have explicit result issues',async t=>{
 await mock(t,financeMock());for(const flags of [['--term','27'],['--down-payment','1001']]){const result=await b.priceVehicle(hit(),0,args(flags));assert.equal(result.status,'unavailable');assert.equal(result.rows.length,0);assert.ok(result.issues.length);}
});
test('mismatched calculation parameters are rejected',async t=>{
 await mock(t,financeMock({term:24}));const result=await b.priceVehicle(hit(),0,args());assert.equal(result.rows.length,0);assert.match(result.issues[0].error,/different/);
});
test('missing quote amounts cannot produce valid NaN rows',async t=>{
 await mock(t,financeMock({missingRate:true}));const result=await b.priceVehicle(hit(),0,args());assert.equal(result.rows.length,0);assert.match(result.issues[0].error,/amounts/);
});
test('a response cannot change a business calculation into a private quote',()=>{
 assert.throws(()=>b.quoteRow(b.vehicleBase(hit()),lease('one','BUSINESS'),calc(),args()),/customer type/);
});
test('gross down payment is sent alone and net result is preserved',async t=>{
 const handle=financeMock();await mock(t,async(u,o)=>{if(String(u).includes('detail-calculation')){const changes=JSON.parse(o.body).changedParameters.changedParameters;assert.ok(!changes.some(x=>x.key==='downPaymentAmount/netAmount'));}return handle(u,o);});
 const result=await b.priceVehicle(hit(),0,args(['--down-payment','1000']));assert.equal(result.rows[0].downPaymentGross,1000);assert.equal(result.rows[0].downPaymentNet,840.34);
});
test('private output chooses cheapest product per vehicle and sorts recalculated rates',()=>{
 const rows=[{vssId:'B',customerType:'PRIVATE',monthlyGross:400,totalGross:14400,rank:1},{vssId:'A',customerType:'PRIVATE',monthlyGross:300,totalGross:10800,rank:2},{vssId:'B',customerType:'PRIVATE',monthlyGross:200,totalGross:7200,rank:1}];
 const selected=b.selectPrivateRows(rows);assert.deepEqual(selected.map(r=>r.vssId),['B','A']);assert.deepEqual(selected.map(r=>r.rank),[1,2]);
});
test('complete main run writes traceable, distinct output with the real price',async t=>{
 const dir=await outputDir(t),messages=await quiet(t);await mock(t,financeMock());const result=await b.main(['--url',URL,'--out',dir]);
 assert.equal(result.complete,true);assert.equal(result.privateRows,2);assert.equal(result.vehicleResults.length,2);assert.equal(result.expectedHits,2);assert.ok(result.generatedAt);assert.equal(result.sourceUrl,URL);
 const md=await fs.readFile(path.join(dir,'bmw-lease-rates.md'),'utf8');assert.match(md,/40\.000,50/);assert.ok(!md.includes('NaN'));assert.ok(!messages.join('').includes('a'.repeat(40)));
});
test('missing metadata is flagged and never formatted as a zero purchase price',async t=>{
 const original=hit();delete original.vehicle.price;const row=b.vehicleBase(original);assert.equal(row.price,null);
 await mock(t,financeMock());const result=await b.priceVehicle(original,0,args());assert.ok(result.issues.some(x=>/purchase price/.test(x.error)));
});
test('transient HTTP failures retry; permanent failures do not and keys are redacted',async t=>{
 let calls=0;await mock(t,async(u,o)=>{assert.ok(o.signal);return ++calls===1?json({},503):json({ok:true});});assert.equal((await b.fetchJson('https://example.com/test')).ok,true);assert.equal(calls,2);
 calls=0;b.HEADERS['x-api-key']='sensitive-test-key';globalThis.fetch=async()=>{calls++;return new Response('sensitive-test-key',{status:400});};
 await assert.rejects(b.fetchJson('https://example.com/test'),error=>!error.message.includes('sensitive-test-key')&&error.message.includes('[redacted]'));assert.equal(calls,1);
 globalThis.fetch=async()=>new Response('x'.repeat(490)+'sensitive-test-key',{status:400});
 await assert.rejects(b.fetchJson('https://example.com/test'),error=>!error.message.includes('sensitive-'));
});
test('request timeouts are enforced on stalled fetches',async t=>{
 const dir=await outputDir(t);let calls=0;await mock(t,(u,o)=>{calls++;return new Promise((resolve,reject)=>{o.signal.addEventListener('abort',()=>reject(o.signal.reason),{once:true});});});
 // AbortSignal.timeout is unref'ed; keep the test process alive until rejection.
 const keepAlive=setInterval(()=>{},1000);try{await assert.rejects(b.main(['--url',URL,'--out',dir,'--timeout-ms','5']));assert.equal(calls,3);}finally{clearInterval(keepAlive);}
});
test('CLI help works and invalid inputs exit before networking',()=>{
 const script=fileURLToPath(new globalThis.URL('../scripts/bmw_lease_rates.mjs',import.meta.url));
 assert.equal(spawnSync(process.execPath,[script,'--help']).status,0);assert.equal(spawnSync(process.execPath,[script,'--term','abc']).status,1);
});
