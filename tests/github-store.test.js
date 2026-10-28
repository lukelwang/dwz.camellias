'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/github-store.js');

const TOKEN = 'github_pat_memory_only_test';
const INITIAL = 'a'.repeat(40);
const BASE_TREE = 'b'.repeat(40);
const FOREIGN = 'c'.repeat(40);
const RAW = 'https://raw.githubusercontent.com/lukelwang/dwz.camellias.photo/main/';
const RAW_ROOT = 'https://raw.githubusercontent.com/lukelwang/dwz.camellias.photo/';
const clone = value => JSON.parse(JSON.stringify(value));
const empty = () => ({ schemaVersion: 1, settings: { brand: '花间', titleLine1: '收藏花开，', titleLine2: '也收藏时光。', description: '茶花 🌸', gardenCount: '400+' }, albums: [] });
const photo = id => ({
  id, kind: 'personal', imagePath: `photos/${id}/image.jpg`, thumbnailPath: `photos/${id}/thumbnail.jpg`,
  src: RAW + `photos/${id}/image.jpg`, thumbnailSrc: RAW + `photos/${id}/thumbnail.jpg`,
  filename: '茶花.jpg', caption: '春天的花 🌸', takenAt: '2026-03-20T10:23', dateSource: 'exif', dateOffset: '+08:00',
  width: 1600, height: 1200, size: 100, mime: 'image/jpeg'
});
const withPhotos = (...ids) => ({ ...empty(), albums: [{ id: 'album-1', name: '花鹤翎', photos: ids.map(photo), coverPhotoId: ids[0] || null, reference_url: 'https://example.com/reference' }] });
const filesFor = id => ['image', 'thumbnail'].map(name => ({ path: `photos/${id}/${name}.jpg`, blob: new Blob([`jpeg ${name}`], { type: 'image/jpeg' }) }));

class GitHub {
  constructor(document = empty()) {
    this.document = clone(document);
    this.staleBranchDocument = clone(document);
    this.documents = new Map([[INITIAL, clone(document)]]);
    this.cacheRefReads = false;
    this.refResponses = new Map();
    this.ref = INITIAL;
    this.tree = BASE_TREE;
    this.requests = [];
    this.blobs = [];
    this.trees = [];
    this.commits = [];
    this.serial = 16;
    this.ownerId = 5496485;
    this.user = { id: 5496485, login: 'lukelwang' };
    this.writable = true;
    this.before = null;
  }
  sha() { return (++this.serial).toString(16).padStart(40, '0'); }
  response(data, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => clone(data) }; }
  fetch = async (url, options = {}) => {
    const request = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined };
    this.requests.push(request);
    if (this.before) {
      const response = await this.before(request);
      if (response) return response;
    }
    if (url.startsWith(RAW + 'gallery.json')) return this.response(this.staleBranchDocument);
    if (url.startsWith(RAW_ROOT)) {
      const match = url.slice(RAW_ROOT.length).match(/^([a-f0-9]{40})\/gallery\.json$/);
      if (match) return this.response(this.documents.get(match[1]) || this.document);
    }
    const path = new URL(url).pathname;
    const suffix = path.replace('/repos/lukelwang/dwz.camellias.photo', '');
    if (path === '/user') return this.response(this.user);
    if (!suffix) return this.response({ name: 'dwz.camellias.photo', owner: { id: this.ownerId, login: 'lukelwang' }, private: false });
    if (suffix === '/git/ref/heads/main') {
      if (this.cacheRefReads) {
        if (!this.refResponses.has(url)) this.refResponses.set(url, this.ref);
        return this.response({ object: { sha: this.refResponses.get(url) } });
      }
      return this.response({ object: { sha: this.ref } });
    }
    if (suffix === '/git/commits/' + this.ref) return this.response({ tree: { sha: this.tree } });
    if (suffix === '/contents/gallery.json') {
      assert.equal(request.headers.Accept, 'application/vnd.github.raw+json');
      return this.response(this.document);
    }
    if (suffix === '/git/blobs' && request.method === 'POST') {
      if (!this.writable) return this.response({ message: TOKEN }, 403);
      const sha = this.sha();
      this.blobs.push({ ...request.body, sha });
      return this.response({ sha });
    }
    if (suffix === '/git/trees') {
      const sha = this.sha();
      this.trees.push({ ...request.body, sha });
      return this.response({ sha });
    }
    if (suffix === '/git/commits' && request.method === 'POST') {
      const sha = this.sha();
      this.commits.push({ ...request.body, sha });
      return this.response({ sha });
    }
    if (suffix === '/git/refs/heads/main' && request.method === 'PATCH') {
      const commit = this.commits.find(item => item.sha === request.body.sha);
      if (commit.parents[0] !== this.ref) return this.response({}, 422);
      this.ref = commit.sha;
      const tree = this.trees.find(item => item.sha === commit.tree);
      this.tree = tree.sha;
      const jsonEntry = tree.tree.find(item => item.path === 'gallery.json');
      const jsonBlob = this.blobs.find(item => item.sha === jsonEntry.sha);
      this.document = JSON.parse(Buffer.from(jsonBlob.content, 'base64').toString('utf8'));
      this.documents.set(commit.sha, clone(this.document));
      return this.response({ object: { sha: this.ref } });
    }
    throw new Error('Unexpected mock request ' + request.method + ' ' + suffix);
  };
  store() { return create({ fetch: this.fetch, writeIntervalMs: 0 }); }
}

test('anonymous reads and public image URLs never carry a token', async () => {
  const github = new GitHub();
  const store = github.store();
  assert.deepEqual(await store.loadPublic(), empty());
  assert.equal(store.photoURL('photos/new/image.jpg'), RAW + 'photos/new/image.jpg');
  assert.match(github.requests[0].url, /^https:\/\/api\.github\.com\/repos\/lukelwang\/dwz\.camellias\.photo\/git\/ref\/heads\/main\?v=\d+-\d+$/);
  assert.equal(github.requests[0].headers.Authorization, undefined);
  assert.equal(github.requests[1].headers, undefined);
  for (const request of github.requests) {
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.equal(request.url.includes(TOKEN), false);
  }
  assert.equal(github.requests[1].url, RAW_ROOT + INITIAL + '/gallery.json');
  assert.equal(store.displayURL('photos/new/image.jpg'), RAW_ROOT + INITIAL + '/photos/new/image.jpg');
  assert.throws(() => store.photoURL('../gallery.json'), { code: 'VALIDATION' });
  assert.throws(() => store.displayURL('../gallery.json'), { code: 'VALIDATION' });
});

test('anonymous refresh sees a new commit despite stale branch CDN JSON and pins new image URLs', async () => {
  const github = new GitHub();
  github.cacheRefReads = true;
  const visitor = github.store();
  assert.deepEqual((await visitor.loadPublic()).albums, []);
  assert.equal(visitor.displayURL('photos/new/image.jpg'), RAW_ROOT + INITIAL + '/photos/new/image.jpg');
  const admin = github.store();
  await admin.login(TOKEN);
  const saved = await admin.save(withPhotos('new'), { files: filesFor('new') });
  assert.equal(admin.displayURL('photos/new/image.jpg'), RAW_ROOT + saved.commit + '/photos/new/image.jpg');
  assert.deepEqual((await (await github.fetch(RAW + 'gallery.json?v=' + Date.now())).json()).albums, []);
  const before = github.requests.length;
  const fresh = await visitor.loadPublic();
  assert.notEqual(github.requests[0].url, github.requests[before].url);
  assert.equal(fresh.albums[0].photos[0].id, 'new');
  assert.equal(fresh.albums[0].photos[0].src, RAW + 'photos/new/image.jpg');
  assert.equal(visitor.photoURL('photos/new/image.jpg'), RAW + 'photos/new/image.jpg');
  assert.equal(visitor.displayURL('photos/new/image.jpg'), RAW_ROOT + saved.commit + '/photos/new/image.jpg');
  assert.equal(github.requests[before + 1].url, RAW_ROOT + saved.commit + '/gallery.json');
  for (const request of github.requests.slice(before)) assert.equal(request.headers?.Authorization, undefined);
});

test('anonymous head rate limit stops before raw load and leaves the displayed commit unchanged', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.loadPublic();
  github.before = request => {
    if (new URL(request.url).pathname.endsWith('/git/ref/heads/main')) return { ok: false, status: 429, json: async () => ({ message: TOKEN }) };
  };
  const before = github.requests.length;
  await assert.rejects(store.loadPublic(), error => error.code === 'RATE_LIMIT' && !error.message.includes(TOKEN));
  assert.equal(github.requests.length - before, 1);
  assert.equal(store.displayURL('photos/new/image.jpg'), RAW_ROOT + INITIAL + '/photos/new/image.jpg');
});

test('login checks numeric owner identity before repository access', async () => {
  const github = new GitHub();
  github.user.id = 1;
  const store = github.store();
  await assert.rejects(store.login(TOKEN), { code: 'AUTH' });
  assert.equal(store.isAuthenticated(), false);
  assert.equal(github.requests.length, 1);
});

test('login rejects a repository owned by another numeric account', async () => {
  const github = new GitHub();
  github.ownerId = 1;
  await assert.rejects(github.store().login(TOKEN), { code: 'PERMISSION' });
  assert.equal(github.blobs.length, 0);
});

test('read-only token fails actual Contents write probe without a commit', async () => {
  const github = new GitHub();
  github.writable = false;
  const store = github.store();
  await assert.rejects(store.login(TOKEN), error => error.code === 'PERMISSION' && !error.message.includes(TOKEN));
  assert.equal(store.isAuthenticated(), false);
  assert.equal(github.commits.length, 0);
  assert.equal(github.ref, INITIAL);
});

test('successful login creates only an existing-document blob and routes PAT only to GitHub API', async () => {
  const github = new GitHub();
  const store = github.store();
  const result = await store.login(TOKEN);
  assert.equal(store.isAuthenticated(), true);
  assert.equal(result.commit, INITIAL);
  assert.equal(store.displayURL('photos/new/image.jpg'), RAW_ROOT + INITIAL + '/photos/new/image.jpg');
  assert.equal(github.blobs.length, 1);
  assert.deepEqual(JSON.parse(Buffer.from(github.blobs[0].content, 'base64').toString('utf8')), empty());
  assert.equal(github.commits.length, 0);
  for (const request of github.requests) {
    assert.equal(new URL(request.url).origin, 'https://api.github.com');
    assert.equal(request.url.includes(TOKEN), false);
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers.Authorization, 'Bearer ' + TOKEN);
  }
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  store.logout();
  assert.equal(store.isAuthenticated(), false);
  await assert.rejects(store.save(empty()), { code: 'AUTH' });
});

test('new photos and Unicode metadata publish through one tree, commit and non-force ref update', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  const document = withPhotos('new');
  document.extension = { author: '园丁', revision: 2 };
  const progress = [];
  const result = await store.save(document, { files: filesFor('new'), onProgress: text => progress.push(text) });
  assert.equal(github.trees.length, 1);
  assert.equal(github.commits.length, 1);
  assert.equal(github.trees[0].base_tree, BASE_TREE);
  assert.deepEqual(github.trees[0].tree.map(item => item.path), ['photos/new/image.jpg', 'photos/new/thumbnail.jpg', 'gallery.json']);
  assert.deepEqual(github.commits[0].parents, [INITIAL]);
  const patch = github.requests.find(request => request.method === 'PATCH');
  assert.equal(patch.body.force, false);
  assert.equal(result.commit, github.ref);
  const saved = JSON.parse(Buffer.from(github.blobs.at(-1).content, 'base64').toString('utf8'));
  assert.deepEqual(saved, document);
  assert.deepEqual(result.document, document);
  assert.match(progress.at(-1), /GitHub/);
});

test('stale head rejects before uploading anything and leaves draft untouched', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  github.ref = FOREIGN;
  const document = withPhotos('new');
  const original = clone(document);
  await assert.rejects(store.save(document, { files: filesFor('new') }), { code: 'CONFLICT' });
  assert.equal(github.blobs.length, 1);
  assert.equal(github.commits.length, 0);
  assert.deepEqual(document, original);
});

test('head change during blob upload is rejected before ref update', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  github.before = request => { if (request.url.endsWith('/git/trees')) github.ref = FOREIGN; };
  await assert.rejects(store.save(withPhotos('new'), { files: filesFor('new') }), { code: 'CONFLICT' });
  assert.equal(github.requests.filter(request => request.method === 'PATCH').length, 0);
  assert.equal(github.ref, FOREIGN);
});

test('last-moment non-fast-forward race fails without overwrite', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  github.before = request => { if (request.method === 'PATCH') github.ref = FOREIGN; };
  await assert.rejects(store.save(empty()), { code: 'CONFLICT' });
  assert.equal(github.ref, FOREIGN);
});

test('partial blob upload failure creates no tree, commit or visible publication', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  let uploads = 0;
  github.before = request => {
    if (request.url.endsWith('/git/blobs') && ++uploads === 2) throw new Error(TOKEN);
  };
  const files = filesFor('new');
  await assert.rejects(store.save(withPhotos('new'), { files }), error => error.code === 'NETWORK' && !error.message.includes(TOKEN));
  assert.equal(github.trees.length, 0);
  assert.equal(github.commits.length, 0);
  assert.equal(github.ref, INITIAL);
  assert.equal(files.length, 2);
  assert.equal(files[0].blob.size > 0, true);
});

test('lost successful PATCH response is confirmed against the target ref', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  github.before = request => {
    if (request.method === 'PATCH') { github.ref = request.body.sha; throw new Error('response dropped'); }
  };
  const result = await store.save(empty());
  assert.equal(result.commit, github.ref);
});

test('unconfirmed PATCH never claims saved and retains the old baseline', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  github.before = request => { if (request.method === 'PATCH') throw new Error('network'); };
  await assert.rejects(store.save(empty()), { code: 'UNCERTAIN' });
  assert.equal(github.ref, INITIAL);
  github.before = null;
  await store.save(empty());
  assert.deepEqual(github.commits.at(-1).parents, [INITIAL]);
});

test('deleting photos deletes both files and JSON in the same tree and commit', async () => {
  const github = new GitHub(withPhotos('old'));
  const store = github.store();
  await store.login(TOKEN);
  await store.save(empty(), { removePaths: ['photos/old/image.jpg', 'photos/old/thumbnail.jpg'] });
  assert.deepEqual(github.trees[0].tree.filter(item => item.sha === null).map(item => item.path), ['photos/old/image.jpg', 'photos/old/thumbnail.jpg']);
  assert.equal(github.trees[0].tree.some(item => item.path === 'gallery.json' && item.sha !== null), true);
  assert.equal(github.commits.length, 1);
});

test('metadata, cover and order edits persist without touching image blobs', async () => {
  const github = new GitHub(withPhotos('one', 'two'));
  const store = github.store();
  await store.login(TOKEN);
  const next = withPhotos('two', 'one');
  next.albums[0].photos[0].caption = '新的说明';
  next.albums[0].notes = '保留花园笔记 🌸';
  await store.save(next);
  assert.deepEqual(github.trees[0].tree.map(item => item.path), ['gallery.json']);
  assert.deepEqual(JSON.parse(Buffer.from(github.blobs.at(-1).content, 'base64')), next);
});

test('legacy frames remain readable and an ordinary frame-free document saves with the same schema', async () => {
  const legacy = withPhotos('one', 'two');
  legacy.albums[0].frame = { style: 'mat', color: '#ffeecc' };
  legacy.albums[0].photos[0].frame = { style: 'double', padding: 8 };
  legacy.albums[0].photos[1].frame = null;
  legacy.albums[0].notes = '原有笔记';
  const github = new GitHub(legacy);
  const store = github.store();
  assert.deepEqual(await store.loadPublic(), legacy);
  const login = await store.login(TOKEN);
  assert.deepEqual(login.document, legacy);
  const next = clone(login.document);
  delete next.albums[0].frame;
  for (const photo of next.albums[0].photos) delete photo.frame;
  next.albums[0].notes = '更新笔记 🌸';
  const result = await store.save(next);
  assert.deepEqual(result.document, next);
  assert.equal(result.document.schemaVersion, 1);
  assert.deepEqual(github.trees[0].tree.map(item => item.path), ['gallery.json']);
  assert.deepEqual(github.document, next);
});

test('unsafe paths, transient images, missing pairs, arbitrary removals and newer schema fail closed', async () => {
  const github = new GitHub(withPhotos('old'));
  const store = github.store();
  await store.login(TOKEN);
  const newer = empty(); newer.schemaVersion = 2;
  const transient = withPhotos('old'); transient.albums[0].photos[0].src = 'blob:pending';
  const unsafe = withPhotos('old'); unsafe.albums[0].photos[0].imagePath = '../gallery.json';
  const offDomain = withPhotos('old'); offDomain.albums[0].photos[0].src = 'https://attacker.test/image.jpg';
  for (const document of [newer, transient, unsafe, offDomain]) await assert.rejects(store.save(document), { code: 'VALIDATION' });
  await assert.rejects(store.save(withPhotos('new'), { files: filesFor('new').slice(0, 1) }), { code: 'VALIDATION' });
  await assert.rejects(store.save(empty(), { removePaths: ['gallery.json'] }), { code: 'VALIDATION' });
  await assert.rejects(store.save(empty(), { files: [{ path: 'photos/x/../../gallery.json', blob: filesFor('new')[0].blob }] }), { code: 'VALIDATION' });
  assert.equal(github.commits.length, 0);
});

test('reference links are treated as plain data and never fetched', async () => {
  const github = new GitHub(withPhotos('old'));
  github.document.albums[0].reference_url = 'https://attacker.test/?token=please';
  const store = github.store();
  const login = await store.login(TOKEN);
  await store.save(login.document);
  assert.equal(github.requests.every(request => new URL(request.url).hostname === 'api.github.com'), true);
});

test('authenticated reload refreshes conflict baseline using PAT only on the API', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  github.ref = FOREIGN;
  github.tree = 'd'.repeat(40);
  github.document.settings.brand = '新花园';
  const start = github.requests.length;
  const latest = await store.loadPublic();
  for (const request of github.requests.slice(start)) {
    assert.equal(request.headers.Authorization, 'Bearer ' + TOKEN);
    assert.equal(new URL(request.url).origin, 'https://api.github.com');
  }
  assert.equal(latest.settings.brand, '新花园');
  assert.equal(store.displayURL('photos/new/image.jpg'), RAW_ROOT + FOREIGN + '/photos/new/image.jpg');
  assert.equal(store.isAuthenticated(), true);
  await store.save(latest);
  assert.deepEqual(github.commits[0].parents, [FOREIGN]);
  assert.equal(github.trees[0].base_tree, 'd'.repeat(40));
});

test('raw Contents media loads indexes exceeding the base64 response size limit', async () => {
  const github = new GitHub();
  github.document.settings.description = '花'.repeat(400000);
  assert.equal(Buffer.byteLength(JSON.stringify(github.document)) > 1024 * 1024, true);
  const store = github.store();
  const result = await store.login(TOKEN);
  assert.equal(result.document.settings.description.length, 400000);
  const request = github.requests.find(item => item.url.includes('/contents/gallery.json'));
  assert.equal(request.headers.Accept, 'application/vnd.github.raw+json');
  assert.deepEqual(JSON.parse(Buffer.from(github.blobs[0].content, 'base64')), github.document);
});

test('logout during upload prevents commit publication', async () => {
  const github = new GitHub();
  const store = github.store();
  await store.login(TOKEN);
  github.before = request => { if (request.url.endsWith('/git/blobs')) store.logout(); };
  await assert.rejects(store.save(withPhotos('new'), { files: filesFor('new') }), { code: 'AUTH' });
  assert.equal(github.commits.length, 0);
  assert.equal(github.ref, INITIAL);
});

test('rate limits report a safe distinct error without retrying a write', async () => {
  for (const [status, headers] of [[429, {}], [403, { 'retry-after': '60' }], [403, { 'x-ratelimit-remaining': '0' }]]) {
    const github = new GitHub();
    const store = github.store();
    await store.login(TOKEN);
    github.before = request => {
      if (request.url.endsWith('/git/blobs')) {
        return { ok: false, status, headers: { get: name => headers[name] || null }, json: async () => ({ message: TOKEN }) };
      }
    };
    const before = github.requests.length;
    await assert.rejects(store.save(empty()), error => error.code === 'RATE_LIMIT' && !error.message.includes(TOKEN));
    assert.equal(github.requests.slice(before).filter(request => request.method === 'POST').length, 1);
    assert.equal(github.ref, INITIAL);
  }
});

test('mutative API requests are serially spaced, including the login permission probe', async () => {
  const github = new GitHub();
  const writes = [];
  github.before = request => { if (request.method === 'POST' || request.method === 'PATCH') writes.push(Date.now()); };
  const store = create({ fetch: github.fetch, writeIntervalMs: 15 });
  await store.login(TOKEN);
  await store.save(empty());
  assert.equal(writes.length, 5);
  for (let index = 1; index < writes.length; index++) assert.equal(writes[index] - writes[index - 1] >= 14, true);
});

test('logout while login is pending cancels before the write-permission probe', async () => {
  const github = new GitHub();
  const store = github.store();
  github.before = request => { if (request.url.endsWith('/user')) store.logout(); };
  await assert.rejects(store.login(TOKEN), { code: 'AUTH' });
  assert.equal(github.requests.length, 1);
  assert.equal(github.blobs.length, 0);
});
