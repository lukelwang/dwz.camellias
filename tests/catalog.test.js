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
