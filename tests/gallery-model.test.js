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
