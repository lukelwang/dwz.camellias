/* Public reads and owner-only, atomic GitHub Git database writes. */
(function (root) {
  'use strict';

  const DEFAULTS = { owner: 'lukelwang', ownerId: 5496485, repo: 'dwz.camellias.photo', branch: 'main' };
  const SHA = /^[a-f0-9]{40}$/i;
  const ID = /^[A-Za-z0-9_-]{1,160}$/;
  const PHOTO_PATH = /^photos\/[A-Za-z0-9_-]{1,160}\/(?:image|thumbnail)\.jpg$/;
  let headRequestNumber = 0;

  function failure(code, message) {
    return Object.assign(new Error(message), { code });
  }
  function check(condition, message) {
    if (!condition) throw failure('VALIDATION', message || '花园资料格式不正确。');
  }
  function jsonCopy(value) {
    const seen = new Set();
    function visit(item, depth) {
      check(depth < 40, '花园资料层级过深。');
      if (item === null || typeof item === 'boolean') return;
      if (typeof item === 'string') {
        check(!/^\s*(?:blob|data):/i.test(item), '请先上传照片，再保存花园资料。');
        return;
      }
      if (typeof item === 'number') { check(Number.isFinite(item)); return; }
      check(typeof item === 'object' && !seen.has(item));
      check(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
      seen.add(item);
      for (const key of Object.keys(item)) visit(item[key], depth + 1);
      seen.delete(item);
    }
    visit(value, 0);
    return JSON.parse(JSON.stringify(value));
  }
  function base64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
    }
    return btoa(binary);
  }
  function create(config = {}) {
    const options = { ...DEFAULTS, ...config };
    check(/^[A-Za-z0-9-]+$/.test(options.owner) && /^[A-Za-z0-9_.-]+$/.test(options.repo));
    check(Number.isSafeInteger(options.ownerId) && options.ownerId > 0);
    check(typeof options.branch === 'string' && /^[A-Za-z0-9_/-]+$/.test(options.branch) && !options.branch.includes('..') && !options.branch.includes('//'));
    const writeInterval = options.writeIntervalMs === undefined ? 1000 : options.writeIntervalMs;
    check(Number.isFinite(writeInterval) && writeInterval >= 0);
    const fetcher = options.fetch || root.fetch.bind(root);
    const api = 'https://api.github.com/repos/' + options.owner + '/' + options.repo;
    const rawRoot = 'https://raw.githubusercontent.com/' + options.owner + '/' + options.repo + '/';
    const raw = rawRoot + options.branch + '/';
    const refPath = '/git/ref/heads/' + options.branch;
    let session = null;
    let generation = 0;
    let busy = false;
    let lastWrite = 0;
    let visibleCommit = null;

    function photoURL(path) {
      check(typeof path === 'string' && PHOTO_PATH.test(path), '照片路径不正确。');
      return raw + path;
    }
    function displayURL(path) {
      check(typeof path === 'string' && PHOTO_PATH.test(path), '照片路径不正确。');
      return rawRoot + (visibleCommit || options.branch) + '/' + path;
    }
    function validate(value) {
      const document = jsonCopy(value);
      check(document && document.schemaVersion === 1, '此花园资料版本不受支持；请更新应用后再试。');
      check(document.settings && !Array.isArray(document.settings));
      for (const field of ['brand', 'titleLine1', 'titleLine2', 'description', 'gardenCount']) check(typeof document.settings[field] === 'string');
      check(Array.isArray(document.albums));
      const albumIds = new Set();
      const photoIds = new Set();
      for (const album of document.albums) {
        check(album && typeof album.id === 'string' && ID.test(album.id) && !albumIds.has(album.id));
        albumIds.add(album.id);
        check(typeof album.name === 'string' && album.name.trim() && Array.isArray(album.photos));
        for (const photo of album.photos) {
          check(photo && typeof photo.id === 'string' && ID.test(photo.id) && !photoIds.has(photo.id));
          photoIds.add(photo.id);
          check(photo.kind === 'personal');
          check(photo.imagePath === 'photos/' + photo.id + '/image.jpg' && photo.thumbnailPath === 'photos/' + photo.id + '/thumbnail.jpg');
          check(photo.src === photoURL(photo.imagePath) && photo.thumbnailSrc === photoURL(photo.thumbnailPath), '照片地址必须指向花园的公开照片仓库。');
          for (const field of ['filename', 'caption', 'takenAt', 'dateSource', 'dateOffset', 'mime']) check(typeof photo[field] === 'string');
          check(photo.mime === 'image/jpeg');
          for (const field of ['width', 'height', 'size']) check(Number.isSafeInteger(photo[field]) && photo[field] > 0);
          check(photo.frame === null || (photo.frame && typeof photo.frame === 'object' && !Array.isArray(photo.frame)));
        }
        check(album.coverPhotoId == null || album.photos.some(photo => photo.id === album.coverPhotoId));
      }
      return document;
    }
    function paths(document) {
      return new Set(document.albums.flatMap(album => album.photos.flatMap(photo => [photo.imagePath, photo.thumbnailPath])));
    }
    function active(current) {
      if (session !== current) throw failure('AUTH', '登录已失效，请重新登录。');
    }
    // This is the only authenticated transport. Never follow a redirect with a PAT.
    async function request(path, { token, method = 'GET', body, current, attempt, accept = 'application/vnd.github+json' } = {}) {
      if (current) active(current);
      if (attempt !== undefined && generation !== attempt) throw failure('AUTH', '登录已取消，请重新登录。');
      const url = path === '/user' ? 'https://api.github.com/user' : api + path;
      const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET') {
        const delay = lastWrite + writeInterval - Date.now();
        if (delay > 0) await new Promise(resolve => root.setTimeout(resolve, delay));
        if (current) active(current);
        if (attempt !== undefined && generation !== attempt) throw failure('AUTH', '登录已取消，请重新登录。');
        lastWrite = Date.now();
      }
      let response;
      try {
        response = await fetcher(url, { method, headers, credentials: 'omit', redirect: 'error', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      } catch (_) {
        throw failure('NETWORK', '无法连接 GitHub，请检查网络后重试。');
      }
      if (!response.ok) {
        const retryAfter = response.headers?.get?.('retry-after');
        const remaining = response.headers?.get?.('x-ratelimit-remaining');
        if (response.status === 429 || (response.status === 403 && (retryAfter || remaining === '0'))) throw failure('RATE_LIMIT', 'GitHub 请求过于频繁。请保留待上传照片，稍后再保存。');
        if (response.status === 401) throw failure('AUTH', 'GitHub 密钥无效或已过期。');
        if (response.status === 403 || response.status === 404) throw failure('PERMISSION', '无法访问照片仓库；请检查密钥的 Contents 读写权限。');
        if (response.status === 409 || response.status === 422) throw failure('CONFLICT', '仓库已发生变化，请刷新资料后重试。');
        throw failure('NETWORK', 'GitHub 暂时无法完成请求，请稍后重试。');
      }
      try { return await response.json(); }
      catch (_) { throw failure('NETWORK', 'GitHub 返回了无法读取的结果，请稍后重试。'); }
    }
    function validSha(value) {
      if (typeof value !== 'string' || !SHA.test(value)) throw failure('NETWORK', 'GitHub 返回了无法确认的版本。');
      return value;
    }
    async function head(token, current, attempt) {
      // The moving ref needs a fresh intermediary-cache key, even when fetch uses
      // no-store. Keep this nonce off immutable commit and raw-content requests.
      const nonce = Date.now() + '-' + (++headRequestNumber);
      return validSha((await request(refPath + '?v=' + nonce, { token, current, attempt })).object?.sha);
    }
    async function snapshot(token, current, attempt) {
      const commit = await head(token, current, attempt);
      const commitData = await request('/git/commits/' + commit, { token, current, attempt });
      const tree = validSha(commitData.tree?.sha);
      // Raw media avoids the Contents JSON response's one-megabyte encoding limit.
      const document = validate(await request('/contents/gallery.json?ref=' + commit, { token, current, attempt, accept: 'application/vnd.github.raw+json' }));
      return { commit, tree, document, content: base64(new TextEncoder().encode(JSON.stringify(document))) };
    }
    async function loadPublic() {
      if (session) {
        if (busy) throw failure('CONFLICT', '保存正在进行，请等待完成后刷新。');
        const current = session;
        const baseline = current.commit;
        // Conflict recovery reads a coherent commit using only the GitHub API.
        const latest = await snapshot(current.token, current);
        active(current);
        if (busy || current.commit !== baseline) throw failure('CONFLICT', '保存正在进行或刚刚完成，请重新刷新。');
        Object.assign(current, { commit: latest.commit, tree: latest.tree, document: latest.document });
        visibleCommit = latest.commit;
        return jsonCopy(latest.document);
      }
      const attempt = generation;
      const previousVisible = visibleCommit;
      // A branch URL can stay stale at the raw CDN even with a cache-busting query.
      // Resolve its head anonymously, then read immutable JSON and image URLs.
      const commit = await head();
      let response;
      try {
        response = await fetcher(rawRoot + commit + '/gallery.json', { credentials: 'omit', redirect: 'error', cache: 'no-store' });
      } catch (_) { throw failure('NETWORK', '无法加载公开花园，请检查网络后重试。'); }
      if (!response.ok) throw failure('NETWORK', '暂时无法加载公开花园，请稍后重试。');
      let document;
      try { document = await response.json(); }
      catch (_) { throw failure('VALIDATION', '公开花园资料无法读取。'); }
      const validated = validate(document);
      if (generation !== attempt || visibleCommit !== previousVisible) throw failure('CONFLICT', '花园状态已更新，请重新刷新。');
      visibleCommit = commit;
      return validated;
    }
    async function login(token) {
      logout();
      const attempt = generation;
      if (typeof token !== 'string' || !token.trim() || /[\s\x00-\x1f\x7f]/.test(token)) throw failure('AUTH', '请输入有效的 GitHub 密钥。');
      const user = await request('/user', { token, attempt });
      if (user.id !== options.ownerId || typeof user.login !== 'string' || user.login.toLowerCase() !== options.owner.toLowerCase()) throw failure('AUTH', '只有花园所有者可以管理照片。');
      const repository = await request('', { token, attempt });
      if (repository.owner?.id !== options.ownerId || repository.owner?.login?.toLowerCase() !== options.owner.toLowerCase() || repository.name !== options.repo || repository.private !== false) throw failure('PERMISSION', '照片仓库的所有者或公开状态不符合要求。');
      const { commit, tree, document, content } = await snapshot(token, undefined, attempt);
      // A dangling blob proves Contents:write for this repository, without a commit.
      validSha((await request('/git/blobs', { token, attempt, method: 'POST', body: { content, encoding: 'base64' } })).sha);
      if (generation !== attempt) throw failure('AUTH', '登录已取消，请重新登录。');
      session = { token, commit, tree, document };
      visibleCommit = commit;
      return { document: jsonCopy(document), user: { id: user.id, login: user.login }, commit };
    }
    function logout() {
      generation++;
      if (session) session.token = '';
      session = null;
    }
    async function save(value, { files = [], removePaths = [], message = 'Update camellia gallery', onProgress } = {}) {
      if (!session) throw failure('AUTH', '请先登录花园所有者账号。');
      if (busy) throw failure('CONFLICT', '另一项保存正在进行，请等待完成。');
      const current = session;
      const document = validate(value);
      const previous = paths(current.document);
      const next = paths(document);
      check(Array.isArray(files) && Array.isArray(removePaths));
      check(typeof message === 'string' && message.trim() && message.length <= 500);
      const uploadPaths = new Set();
      for (const file of files) {
        check(file && PHOTO_PATH.test(file.path) && next.has(file.path) && !uploadPaths.has(file.path), '待上传照片路径不正确或重复。');
        check(file.blob && typeof file.blob.arrayBuffer === 'function' && file.blob.type === 'image/jpeg' && file.blob.size > 0, '请上传处理后的 JPEG 照片。');
        uploadPaths.add(file.path);
      }
      for (const path of next) check(previous.has(path) || uploadPaths.has(path), '新增照片缺少图像或缩略图。');
      for (const path of removePaths) check(PHOTO_PATH.test(path) && previous.has(path) && !next.has(path), '删除的照片路径不正确或仍在使用。');
      const deleted = [...previous].filter(path => !next.has(path));
      const progress = text => { if (typeof onProgress === 'function') { try { onProgress(text); } catch (_) {} } };
      const authenticated = (path, options = {}) => request(path, { ...options, token: current.token, current });
      busy = true;
      try {
        if (await head(current.token, current) !== current.commit) throw failure('CONFLICT', '花园已在其他地方更新，请保留待上传照片并刷新资料。');
        const entries = [];
        for (let index = 0; index < files.length; index++) {
          progress('正在上传照片 ' + (index + 1) + '/' + files.length + '…');
          let bytes;
          try { bytes = new Uint8Array(await files[index].blob.arrayBuffer()); }
          catch (_) { throw failure('VALIDATION', '无法读取待上传照片，请重新选择。'); }
          const blob = await authenticated('/git/blobs', { method: 'POST', body: { content: base64(bytes), encoding: 'base64' } });
          entries.push({ path: files[index].path, mode: '100644', type: 'blob', sha: validSha(blob.sha) });
        }
        progress('正在保存花园资料…');
        const json = JSON.stringify(document, null, 2) + '\n';
        const metadata = await authenticated('/git/blobs', { method: 'POST', body: { content: base64(new TextEncoder().encode(json)), encoding: 'base64' } });
        entries.push({ path: 'gallery.json', mode: '100644', type: 'blob', sha: validSha(metadata.sha) });
        for (const path of deleted) entries.push({ path, mode: '100644', type: 'blob', sha: null });
        const tree = validSha((await authenticated('/git/trees', { method: 'POST', body: { base_tree: current.tree, tree: entries } })).sha);
        const commit = validSha((await authenticated('/git/commits', { method: 'POST', body: { message, tree, parents: [current.commit] } })).sha);
        if (await head(current.token, current) !== current.commit) throw failure('CONFLICT', '保存期间花园已更新，请保留修改并刷新资料后重试。');
        try {
          const updated = await authenticated('/git/refs/heads/' + options.branch, { method: 'PATCH', body: { sha: commit, force: false } });
          if (updated.object?.sha !== commit) throw failure('NETWORK', 'GitHub 尚未确认保存结果。');
        } catch (error) {
          // A dropped response may follow a successful update. Confirm the exact ref.
          if (['CONFLICT', 'AUTH', 'PERMISSION', 'RATE_LIMIT'].includes(error.code)) throw error;
          let confirmed;
          try { confirmed = await head(current.token, current); }
          catch (_) { throw failure('UNCERTAIN', '尚无法确认保存结果。请保留照片，恢复网络后重新登录核对。'); }
          if (confirmed !== commit) throw failure('UNCERTAIN', '尚无法确认保存结果。请保留照片并重新登录核对，避免重复上传。');
        }
        active(current);
        current.commit = commit;
        current.tree = tree;
        current.document = document;
        visibleCommit = commit;
        progress('已保存到 GitHub。');
        return { document: jsonCopy(document), commit };
      } finally { busy = false; }
    }
    return { loadPublic, login, logout, isAuthenticated: () => session !== null, save, photoURL, displayURL };
  }

  const exported = { create };
  root.CamelliaStore = exported;
  if (typeof module === 'object' && module.exports) module.exports = exported;
})(typeof window === 'object' ? window : globalThis);
