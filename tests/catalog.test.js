const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const raw={name:'Secchū-no-ka',species:'NRH',chinese_name:['雪中花'],japanese_name:[],size:'Large',description:'A fragrant camellia hybrid.'};
function catalogue(){
 const scope={window:{},TextEncoder,AbortController,setTimeout,clearTimeout,fetch:async url=>({ok:true,json:async()=>url.endsWith('data/index.json')?[raw]:{[raw.name]:raw}})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../catalog.js'),'utf8'),scope);
 return scope.window.CamelliaCatalog;
}
test('imported album title matches the catalogue canonical name rather than a Chinese alias',()=>{
 const album=catalogue().toCultivar(raw);
 assert.equal(album.display_name,raw.name);
 assert.equal(album.name,raw.name);
 assert.deepEqual(Array.from(album.chinese_name),['雪中花']);
});
test('Chinese alias searches select the same canonical cultivar and retain source metadata',async()=>{
 const catalog=catalogue();await catalog.loadIndex();
 const result=catalog.search('雪中花').results[0];
 assert.equal(result.name,raw.name);
 const album=catalog.toCultivar(await catalog.getEntry(result.name));
 assert.equal(album.display_name,result.name);
 assert.equal(album.description,raw.description);
 assert.ok(album.reference_url.endsWith(encodeURIComponent(raw.name)));
});
test('a genuinely Chinese canonical name remains valid without inventing a translation',()=>{
 const album=catalogue().toCultivar({...raw,name:'中文原名',chinese_name:['别名']});
 assert.equal(album.display_name,'中文原名');
});
test('registration year imports only explicit structured catalogue metadata',()=>{
 const catalog=catalogue();
 for (const field of ['registeredYear','registered_year','registration_year']) {
  for (const value of [1000,9999,'2008',' 2011 ']) {
   assert.equal(catalog.toCultivar({...raw,[field]:value}).registeredYear,Number(value));
  }
 }
 for (const value of [null,'',999,10000,'2008 publication',2008.5,'2008.0',true]) {
  assert.equal(catalog.toCultivar({...raw,registeredYear:value}).registeredYear,null);
 }
});
test('publication and originated years in prose do not become a registration year',()=>{
 const album=catalogue().toCultivar({...raw,description:'Published in International Camellia Journal, 2011. Originated in Japan in 2008.',citation:'Registered varieties 2011',originated:2008});
 assert.equal(album.registeredYear,null);
 assert.equal(album.description,'Published in International Camellia Journal, 2011. Originated in Japan in 2008.');
});
test('explicit registration metadata survives live index and detail normalization',async()=>{
 const record={...raw,registration_year:'1986'};
 const scope={window:{},TextEncoder,AbortController,setTimeout,clearTimeout,fetch:async url=>({ok:true,json:async()=>url.endsWith('data/index.json')?[record]:{[record.name]:record}})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../catalog.js'),'utf8'),scope);
 const catalog=scope.window.CamelliaCatalog;
 await catalog.loadIndex();
 const result=catalog.search('雪中花').results[0];
 assert.equal(result.registeredYear,1986);
 assert.equal(catalog.toCultivar(await catalog.getEntry(result.name)).registeredYear,1986);
});
