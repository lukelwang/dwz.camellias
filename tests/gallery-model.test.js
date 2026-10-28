const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/model.js'),'utf8'),scope);
const plain=value=>JSON.parse(JSON.stringify(value));
const seed=()=>({schemaVersion:1,settings:{brand:'花间'},albums:[{id:'pearl',name:"Nuccio's Pearl",display_name:'我的珍珠',notes:'我自己记录的备注',photos:[{id:'one',caption:'第一朵',frame:null},{id:'two',caption:'另一朵',frame:null}],coverPhotoId:'one',frame:{style:'mat',color:'#ffeecc',width:5,radius:4,padding:12}}]});
test('visitor mutation is denied while authenticated proposal does not change saved state',()=>{
 const model=scope.window.CamelliaModel.create(seed());
 const original=plain(model.document());
 assert.equal(model.propose({type:'DELETE_ALBUM',id:'pearl'}).error,true);
 assert.deepEqual(plain(model.document()),original);
 model.setAuthenticated(true);
 const proposal=model.propose({type:'PATCH_ALBUM',id:'pearl',patch:{notes:'新备注'}});
 assert.equal(proposal.error,false);
 assert.equal(proposal.document.albums[0].notes,'新备注');
 assert.deepEqual(plain(model.document()),original);
 model.accept(proposal.document);
 assert.equal(model.getState().albums[0].notes,'新备注');
});
test('record links default to visible and the owner can persist visibility without changing albums',()=>{
 const model=scope.window.CamelliaModel.create(seed());
 assert.equal(model.getState().settings.showCultivarRecordLinks,true);
 assert.equal(model.propose({type:'PATCH_SETTINGS',patch:{showCultivarRecordLinks:false}}).error,true);
 model.setAuthenticated(true);
 const original=plain(model.document().albums);
 const hidden=model.propose({type:'PATCH_SETTINGS',patch:{showCultivarRecordLinks:false}});
 assert.equal(hidden.document.settings.showCultivarRecordLinks,false);
 assert.equal(model.getState().settings.showCultivarRecordLinks,true);
 model.accept(hidden.document);
 assert.equal(model.getState().settings.showCultivarRecordLinks,false);
 assert.deepEqual(plain(model.document().albums),original);
});
test('adding a batch preserves owner metadata and deletion updates the cover only on accept',()=>{
 const model=scope.window.CamelliaModel.create(seed());model.setAuthenticated(true);
 const added=model.propose({type:'ADD_PHOTOS',cultivar:{id:'pearl',name:"Nuccio's Pearl",display_name:'源网站名称',notes:'源网站备注'},photos:[{id:'three',caption:'新花',frame:null}]});
 assert.equal(added.document.albums.length,1);
 assert.equal(added.document.albums[0].notes,'我自己记录的备注');
 assert.equal(added.document.albums[0].display_name,'我的珍珠');
 assert.equal(model.getState().albums[0].photos.length,2);
 model.accept(added.document);
 const deleted=model.propose({type:'DELETE_PHOTO',albumId:'pearl',photoId:'one'});
 assert.equal(deleted.document.albums[0].coverPhotoId,'two');
 assert.equal(model.getState().albums[0].coverPhotoId,'one');
});
test('two batches append to the same cultivar while preserving owner data, photo order and cover',()=>{
 const document=seed();
 Object.assign(document.albums[0],{name:'Étoile   de Chine',display_name:'我的星光 🌸',chinese_name:'中国之星',aliases:['星光','Étoile'],description:'保留描述',summary_zh:'保留摘要',customMetadata:{season:'春 2026'}});
 Object.assign(document.albums[0].photos[0],{takenAt:'2026-03-20T10:23',dateSource:'exif',dateOffset:'+08:00',customMetadata:{camera:'我的相机'}});
 document.albums[0].coverPhotoId='two';
 const model=scope.window.CamelliaModel.create(document);model.setAuthenticated(true);
 const original=plain(model.document().albums[0]);
 const first=model.propose({type:'ADD_PHOTOS',cultivar:{name:' e\u0301TOILE\tde chine ',display_name:'Catalogue name',chinese_name:'新中文',aliases:['新别名'],notes:'New notes'},photos:[{id:'three',caption:'春花'}]});
 assert.equal(first.error,false);
 assert.equal(first.document.albums.length,1);
 assert.deepEqual(plain(first.document.albums[0].photos.map(photo=>photo.id)),['one','two','three']);
 model.accept(first.document);
 const second=model.propose({type:'ADD_PHOTOS',cultivar:{name:'ÉTOILE de CHINE'},photos:[{id:'four',caption:'秋花'}]});
 assert.equal(second.document.albums.length,1);
 const album=plain(second.document.albums[0]);
 assert.deepEqual(album.photos.map(photo=>photo.id),['one','two','three','four']);
 assert.deepEqual({...album,photos:album.photos.slice(0,2)},original);
 assert.equal(model.getState().albums[0].photos.length,3);
 model.accept(second.document);
 assert.deepEqual(plain(model.document().albums[0]),album);
});
test('stable ID takes priority over another album with the supplied canonical name',()=>{
 const document=seed();document.albums.push({id:'gem',name:"Nuccio's Gem",photos:[]});
 const model=scope.window.CamelliaModel.create(document);model.setAuthenticated(true);
 const proposal=model.propose({type:'ADD_PHOTOS',cultivar:{id:'gem',name:"Nuccio's Pearl"},photos:[{id:'three'}]});
 assert.deepEqual(plain(proposal.document.albums.find(album=>album.id==='gem').photos.map(photo=>photo.id)),['three']);
 assert.deepEqual(plain(proposal.document.albums.find(album=>album.id==='pearl').photos.map(photo=>photo.id)),['one','two']);
});
test('canonical identity keeps punctuation, diacritics and shared aliases distinct',()=>{
 const model=scope.window.CamelliaModel.create({albums:[{id:'etoile',name:'Étoile',aliases:['Star'],photos:[]}]});model.setAuthenticated(true);
 for (const [id,name] of [['plain','Etoile'],['punctuation','Étoile!'],['shared-alias','Star']]) {
  const proposal=model.propose({type:'ADD_PHOTOS',cultivar:{id,name,aliases:['Star']},photos:[{id:id+'-photo'}]});
  assert.equal(proposal.error,false);model.accept(proposal.document);
 }
 assert.equal(model.document().albums.length,4);
});
test('renaming cannot create a normalized duplicate and preserves manual Unicode display names',()=>{
 const document=seed();document.albums.push({id:'etoile',name:'Étoile de Chine',photos:[]});
 const model=scope.window.CamelliaModel.create(document);model.setAuthenticated(true);
 assert.equal(model.propose({type:'PATCH_ALBUM',id:'pearl',patch:{name:' e\u0301TOILE\tde CHINE '}}).error,true);
 const proposal=model.propose({type:'PATCH_ALBUM',id:'pearl',patch:{display_name:'我的珍珠 🌸 e\u0301'}});
 assert.equal(proposal.document.albums.find(album=>album.id==='pearl').display_name,'我的珍珠 🌸 e\u0301');
});
test('ordinary proposals omit legacy album and photo frames without mutating source metadata',()=>{
 const document=seed();document.albums[0].photos[0].frame={style:'double',color:'#123456'};
 document.albums[0].legacyMetadata={retained:true};document.albums[0].photos[0].legacyMetadata={retained:'花'};
 const original=plain(document);
 const model=scope.window.CamelliaModel.create(document);model.setAuthenticated(true);
 const proposal=model.propose({type:'ADD_PHOTOS',cultivar:{id:'pearl'},photos:[{id:'three',caption:'新花',frame:{style:'mat'}}]});
 const album=proposal.document.albums[0];
 assert.equal(Object.hasOwn(album,'frame'),false);
 for(const photo of album.photos) assert.equal(Object.hasOwn(photo,'frame'),false);
 assert.deepEqual(plain(album.legacyMetadata),{retained:true});
 assert.deepEqual(plain(album.photos[0].legacyMetadata),{retained:'花'});
 assert.deepEqual(document,original);
 const ignored=model.propose({type:'PATCH_PHOTO',albumId:'pearl',photoId:'one',patch:{caption:'修改说明',frame:{style:'mat'}}});
 assert.equal(Object.hasOwn(ignored.document.albums[0].photos[0],'frame'),false);
 assert.equal(ignored.document.albums[0].photos[0].caption,'修改说明');
});
test('accepting edited or refreshed data preserves this visit album order',()=>{
 const document=seed();document.albums.push({id:'gem',name:"Nuccio's Gem",photos:[]});
 const model=scope.window.CamelliaModel.create(document);
 const order=plain(model.getState().albums.map(album=>album.id));
 model.accept({...document,albums:document.albums.slice().reverse()});
 assert.deepEqual(plain(model.getState().albums.map(album=>album.id)),order);
});
test('edits preserve unknown accepted top-level gallery metadata',()=>{
 const document=seed();document.extraMetadata={gardenSeason:'2026/2027',collectionOwner:'DWZ'};
 const model=scope.window.CamelliaModel.create(document);model.setAuthenticated(true);
 assert.deepEqual(plain(model.propose({type:'PATCH_SETTINGS',patch:{brand:'茶花园'}}).document.extraMetadata),document.extraMetadata);
 const refreshed={...document,extraMetadata:{gardenSeason:'2027/2028'}};model.accept(refreshed);
 assert.deepEqual(plain(model.propose({type:'PATCH_ALBUM',id:'pearl',patch:{notes:'备注'}}).document.extraMetadata),refreshed.extraMetadata);
});
test('only new albums receive an immutable creation timestamp',()=>{
 const document=seed();
 document.albums[0].addedAt='2024-04-03T12:00:00.000Z';
 document.albums[0].registeredYear=1978;
 const model=scope.window.CamelliaModel.create(document);model.setAuthenticated(true);
 const before=Date.now();
 const created=model.propose({type:'ADD_PHOTOS',cultivar:{id:'gem',name:"Nuccio's Gem",addedAt:'1900-01-01T00:00:00.000Z',registeredYear:'1972'},photos:[{id:'gem-one'}]});
 const gem=created.document.albums.find(album=>album.id==='gem');
 assert.equal(new Date(gem.addedAt).toISOString(),gem.addedAt);
 assert.ok(Date.parse(gem.addedAt)>=before && Date.parse(gem.addedAt)<=Date.now());
 assert.equal(gem.registeredYear,1972);
 assert.equal(model.getState().albums.length,1);
 model.accept(created.document);
 const appended=model.propose({type:'ADD_PHOTOS',cultivar:{id:'pearl',addedAt:'2030-01-01T00:00:00.000Z',registeredYear:2020},photos:[{id:'three'}]});
 const pearl=appended.document.albums.find(album=>album.id==='pearl');
 assert.equal(pearl.addedAt,document.albums[0].addedAt);
 assert.equal(pearl.registeredYear,1978);
 model.accept(appended.document);
 const edited=model.propose({type:'PATCH_ALBUM',id:'gem',patch:{notes:'Updated',addedAt:'2030-01-01T00:00:00.000Z'}});
 assert.equal(edited.document.albums.find(album=>album.id==='gem').addedAt,gem.addedAt);
});
test('legacy albums stay undated when photos are appended or metadata is edited',()=>{
 const model=scope.window.CamelliaModel.create(seed());model.setAuthenticated(true);
 const appended=model.propose({type:'ADD_PHOTOS',cultivar:{id:'pearl',addedAt:'2026-01-01T00:00:00.000Z'},photos:[{id:'three',takenAt:'2026-01-01T00:00:00.000Z'}]});
 assert.equal(Object.hasOwn(appended.document.albums[0],'addedAt'),false);
 model.accept(appended.document);
 const edited=model.propose({type:'PATCH_ALBUM',id:'pearl',patch:{registeredYear:'1985'}});
 assert.equal(Object.hasOwn(edited.document.albums[0],'addedAt'),false);
 assert.equal(scope.window.CamelliaModel.addedTime(edited.document.albums[0]),null);
});
test('registration years accept four digits and blank clears while invalid changes are rejected',()=>{
 const model=scope.window.CamelliaModel.create(seed());model.setAuthenticated(true);
 for (const [input,expected] of [[1000,1000],[9999,9999],[' 1985 ',1985],['',null],['   ',null],[null,null]]) {
  const proposal=model.propose({type:'PATCH_ALBUM',id:'pearl',patch:{registeredYear:input}});
  assert.equal(proposal.error,false);
  assert.equal(proposal.document.albums[0].registeredYear,expected);
  model.accept(proposal.document);
 }
 const original=plain(model.document());
 for (const input of [999,10000,1985.5,'85','1985.0','1e3','unknown',true,[],{},undefined]) {
  const proposal=model.propose({type:'PATCH_ALBUM',id:'pearl',patch:{registeredYear:input,notes:'must not save'}});
  assert.equal(proposal.error,true);
  assert.match(proposal.notice,/four-digit year/);
  assert.deepEqual(plain(proposal.document),original);
 }
});
test('metadata helpers treat unknown values honestly without guessing from other fields',()=>{
 const {registrationYear,addedTime}=scope.window.CamelliaModel;
 for (const value of [undefined,null,'',999,10000,2026.5,'2026.0','year 2026',false,[]]) assert.equal(registrationYear(value),null);
 assert.equal(registrationYear('2008'),2008);
 assert.equal(registrationYear(2011),2011);
 assert.equal(addedTime({addedAt:'2026-10-28T12:00:00.000Z'}),Date.parse('2026-10-28T12:00:00.000Z'));
 for (const album of [{},{addedAt:''},{addedAt:'unknown'},{addedAt:0},{createdAt:'2026-10-28T12:00:00.000Z',photos:[{takenAt:'2026-10-28T12:00:00.000Z'}]}]) assert.equal(addedTime(album),null);
});
test('album sorting copies input and preserves visit order for random order',()=>{
 const {orderAlbums}=scope.window.CamelliaModel;
 const albums=[
  {id:'unknown-z',name:'Zeta',description:'Registered in 2025',photos:[{},{}]},
  {id:'old',name:'Alpha',addedAt:'2024-01-01T00:00:00.000Z',registeredYear:1980,photos:[]},
  {id:'new-z',name:'Zeta',addedAt:'2026-01-01T00:00:00.000Z',registeredYear:'2000',photos:[{}]},
  {id:'new-a',name:'Beta',addedAt:'2026-01-01T00:00:00.000Z',registeredYear:2000,photos:[]},
  {id:'invalid',name:'Gamma',addedAt:'unknown',registeredYear:'year 2026',photos:[]}
 ];
 const original=plain(albums);
 const ids=items=>Array.from(items,album=>album.id);
 assert.notEqual(orderAlbums(albums),albums);
 assert.deepEqual(ids(orderAlbums(albums)),ids(albums));
 assert.deepEqual(ids(orderAlbums(albums,{sort:'curated'})),ids(albums));
 assert.deepEqual(ids(orderAlbums(albums,{sort:'name'})),['old','new-a','invalid','unknown-z','new-z']);
 assert.deepEqual(ids(orderAlbums(albums,{sort:'photos'})),['unknown-z','new-z','old','new-a','invalid']);
 assert.deepEqual(ids(orderAlbums(albums,{sort:'newly-added'})),['new-z','new-a','old','unknown-z','invalid']);
 assert.deepEqual(ids(orderAlbums(albums,{sort:'registered-year'})),['new-a','new-z','old','invalid','unknown-z']);
 assert.deepEqual(albums,original);
});
test('favorites are absent from model state and the former toggle action is unsupported',()=>{
 const model=scope.window.CamelliaModel.create(seed());
 assert.equal(Object.hasOwn(model.getState(),'favorites'),false);
 const proposal=model.propose({type:'TOGGLE_FAVORITE',id:'pearl'});
 assert.equal(proposal.error,true);
 assert.match(proposal.notice,/not supported/);
 assert.equal(Object.hasOwn(proposal,'favorites'),false);
 model.accept(proposal.document);
 assert.equal(Object.hasOwn(model.getState(),'favorites'),false);
});
