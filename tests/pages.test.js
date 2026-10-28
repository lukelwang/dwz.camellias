const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const publicHTML=fs.readFileSync(path.join(root,'index.html'),'utf8');
const managerFiles=fs.readdirSync(root).filter(name=>/^studio-[a-f0-9]{12}\.html$/.test(name));
test('public page has no owner entry, credentials, upload forms or owner URL',()=>{
 assert.equal(managerFiles.length,1);
 assert.doesNotMatch(publicHTML,/id="(?:loginEntry|loginDialog|loginForm|githubToken|uploadDialog|photoFiles|settingsDialog)"/);
 assert.doesNotMatch(publicHTML,/data-admin|studio-[a-f0-9]{12}\.html/);
 assert.match(publicHTML,/<body data-page="gallery">/);
 assert.match(publicHTML,/<dialog id="albumDialog"/);
 assert.doesNotMatch(publicHTML,/<script[^>]+(?:catalog\.js|vendor\/exifr\.js)/);
});
test('separate owner page keeps authentication and multi-photo controls and requests no indexing',()=>{
 const managerHTML=fs.readFileSync(path.join(root,managerFiles[0]),'utf8');
 assert.match(managerHTML,/<body data-page="manager">/);
 assert.match(managerHTML,/<meta name="robots" content="noindex, nofollow, nosnippet">/);
 assert.match(managerHTML,/id="loginForm"/);
 assert.match(managerHTML,/id="githubToken" type="password" autocomplete="off"/);
 assert.match(managerHTML,/id="photoFiles"[^>]*multiple/);
 assert.match(managerHTML,/href="\.\/"[^>]*>View public gallery/);
});
test('both documents and fixed application messages use English',()=>{
 for(const name of ['index.html',...managerFiles]){
  const html=fs.readFileSync(path.join(root,name),'utf8');
  assert.match(html,/<html lang="en"/);
  assert.doesNotMatch(html,/\p{Script=Han}/u);
 }
 for(const name of ['src/controller.js','src/model.js','src/photo-io.js','src/github-store.js'])assert.doesNotMatch(fs.readFileSync(path.join(root,name),'utf8'),/\p{Script=Han}/u);
});
