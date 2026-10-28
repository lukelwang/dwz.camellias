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
