/* Production gallery: rendered records change only after GitHub confirms a save. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s\p{P}]/gu, '');
  const categories = { Japonica: '山茶', Sasanqua: '茶梅', Reticulata: '滇山茶', NRH: '杂交种', Wabisuke: '侘助', Rusticana: '雪椿' };
  const forms = { formal: '完全重瓣型', single: '单瓣型', semi: '半重瓣型', peony: '牡丹型', anemone: '托桂型' };
  const colors = { pink: '粉色', white: '白色', red: '红色', bicolor: '复色', yellow: '淡黄色' };
  const sizes = { Medium: '中型', Large: '大型', 'Very large': '巨型', Miniature: '微型', Small: '小型', 'Small to medium': '小至中型', 'Medium to large': '中至大型' };
  const defaultFrame = { style: 'none', color: '#d6c29b', width: 5, radius: 12, padding: 8 };
  const model = window.CamelliaModel.create();
  const io = window.CamelliaPhotoIO;
  const store = window.CamelliaStore.create();
  const ownedURLs = new Set();
  let gallery = { category: 'all', favorites: false };
  let albumView = { id: null, photoId: null, filter: 'all' };
  let pending = [];
  let selected = null;
  let uploadGeneration = 0;
  let selectionGeneration = 0;
  let reading = false;
  let catalogueReady = false;
  let catalogueCount = 0;
  let catalogueMatches = [];
  let catalogueActive = -1;
  let toastTimer;
  let saving = false;
  let loading = false;
  let sessionGeneration = 0;
  let recoveryRequired = false;
  const dirtyDialogs = new Set();
  const state = () => model.getState();
  const admin = () => state().role === 'admin' && store.isAuthenticated();
  const getAlbum = id => state().albums.find(item => item.id === id);
  const cover = album => album.photos.find(photo => photo.id === album.coverPhotoId) || album.photos[0];
  const photosFor = album => album.photos.filter(photo => albumView.filter === 'all' || photo.kind === albumView.filter);
  const dateLabel = photo => io.dateLabel(photo);
  const sourceURL = value => /^https?:\/\//i.test(value || '') ? value : 'https://camellia-nomenclature.github.io/';
  const imageURL = value => {
    const photo = /^https:\/\/raw\.githubusercontent\.com\/lukelwang\/dwz\.camellias\.photo\/main\/(photos\/[A-Za-z0-9_-]+\/(?:image|thumbnail)\.jpg)$/.exec(value || '');
    if (photo && typeof store.displayURL === 'function') return store.displayURL(photo[1]);
    return /^(data:image\/|blob:|https?:\/\/)/i.test(value || '') ? value : document.querySelector('link[rel="icon"]').href;
  };

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
  }
  function act(action, quiet = false) {
    const next = model.dispatch(action);
    render();
    if (!quiet) toast(next.notice);
    return next;
  }
  function status(message, retry = false, error = false) {
    $('#storeMessage').textContent = message;
    $('#reloadGallery').hidden = !retry;
    $('#storeStatus').classList.toggle('has-error', error);
    $$('.save-message').forEach(element => { element.textContent = message; });
    $$('.reload-draft').forEach(element => { element.hidden = !retry; });
    $$('.reauth-draft').forEach(element => { element.hidden = !retry || admin(); });
  }
  function lockUI() {
    $$('button,input,select,textarea').forEach(element => {
      if (saving || loading) {
        if (!element.hasAttribute('data-lock-disabled')) element.dataset.lockDisabled = element.disabled ? 'true' : 'false';
        element.disabled = true;
      } else if (element.hasAttribute('data-lock-disabled')) {
        element.disabled = element.dataset.lockDisabled === 'true';
        delete element.dataset.lockDisabled;
      }
    });
    document.body.setAttribute('aria-busy', String(saving || loading));
  }
  async function saveAction(action, options = {}, errorTarget) {
    if (!requireAdmin() || saving || loading) return null;
    if (recoveryRequired) { status('请先重新读取最新花园，再保存。当前输入仍保留。', true, true); return null; }
    const proposal = model.propose(action);
    if (proposal.error) { if (errorTarget) $(errorTarget).textContent = proposal.notice; toast(proposal.notice); return null; }
    const generation = sessionGeneration;
    saving = true; lockUI();
    status('正在保存到 GitHub，请保持页面打开…');
    if (errorTarget) $(errorTarget).textContent = '';
    try {
      const result = await store.save(proposal.document, { ...options, onProgress: message => status(message) });
      if (generation !== sessionGeneration) return null;
      model.accept(result.document);
      status('已保存到花园。');
      toast(proposal.notice);
      return state();
    } catch (error) {
      const message = error.message || '保存失败，请重试。';
      recoveryRequired = ['CONFLICT', 'UNCERTAIN'].includes(error.code);
      if (['AUTH', 'PERMISSION'].includes(error.code)) {
        store.logout(); model.setAuthenticated(false);
      }
      if (errorTarget) $(errorTarget).textContent = message + ' 当前输入仍保留。';
      status(message + ' 当前输入仍保留。' + (recoveryRequired ? ' 请重新读取最新花园后核对并保存。' : ''), true, true);
      toast(message);
      return null;
    } finally { saving = false; lockUI(); render(); updateUpload(); }
  }
  async function loadGallery() {
    if (saving || loading) return;
    const generation = sessionGeneration;
    loading = true; lockUI(); status('正在读取最新花园…');
    try {
      const document = await store.loadPublic();
      if (generation !== sessionGeneration) return;
      model.accept(document); recoveryRequired = false;
      const reconciled = reconcilePending(document);
      status('花园已更新。' + reconciled + (dirtyDialogs.size || pending.length ? ' 当前编辑与待上传照片已保留，请核对最新内容后保存。' : ''));
    } catch (error) { status(error.message || '暂时无法打开花园，请重试。', true, true); }
    finally { loading = false; lockUI(); render(); updateUpload(); }
  }
  function requireAdmin() {
    if (admin() && !saving && !loading) return true;
    if (!saving && !loading) toast('请先验证管理员身份，再修改花园内容。');
    return false;
  }
  function openDialog(id) {
    if (saving || loading) return;
    const dialog = $('#' + id);
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog(id) { if (!saving && !loading) $('#' + id)?.close(); }
  function confirmAction(message, label = '确认删除') {
    if (saving || loading || $('#confirmDialog').open) return Promise.resolve(false);
    $('#confirmMessage').textContent = message;
    $('#confirmAccept').textContent = label;
    $('#confirmDialog').showModal();
    return new Promise(resolve => {
      const finish = accepted => { $('#confirmDialog').close(); cleanup(); resolve(accepted); };
      const yes = () => finish(true);
      const no = () => finish(false);
      const cancel = event => { event.preventDefault(); finish(false); };
      function cleanup() { $('#confirmAccept').removeEventListener('click', yes); $('#confirmCancel').removeEventListener('click', no); $('#confirmDialog').removeEventListener('cancel', cancel); }
      $('#confirmAccept').addEventListener('click', yes); $('#confirmCancel').addEventListener('click', no); $('#confirmDialog').addEventListener('cancel', cancel);
    });
  }
  async function requestClose(id) {
    if (saving || loading) return;
    if ((id === 'uploadDialog' && (pending.length || reading)) || dirtyDialogs.has(id)) {
      if (!await confirmAction('关闭将丢弃这个窗口中尚未保存的修改与照片。已发布的花园不会改变。', '丢弃未保存内容')) return;
    }
    dirtyDialogs.delete(id); closeDialog(id);
  }
  function revoke(src) {
    if (ownedURLs.has(src)) { URL.revokeObjectURL(src); ownedURLs.delete(src); }
  }
  function reconcilePending(document) {
    if (!pending.length) return '';
    const published = new Map(document.albums.flatMap(album => album.photos.map(photo => [photo.id, photo])));
    let count = 0;
    pending = pending.filter(photo => {
      const saved = published.get(photo.id);
      if (!saved || ['filename','caption','takenAt','dateSource','dateOffset'].some(field => (saved[field] || '') !== (photo[field] || ''))) return true;
      if ($('#uploadFrameStyle') && JSON.stringify(saved.frame) !== JSON.stringify(readFrame('uploadFrame'))) return true;
      revoke(photo.src); count++; return false;
    });
    if (count && $('#uploadDialog').open) {
      renderPending();
      if (!pending.length) dirtyDialogs.delete('uploadDialog');
    }
    return count ? ` 已确认 ${count} 张待上传照片已保存，已移除对应预览；其余输入保留。` : '';
  }
  function clearPending() {
    uploadGeneration++;
    selectionGeneration++;
    pending.forEach(photo => revoke(photo.src));
    pending = [];
    selected = null;
    reading = false;
    $('#photoFiles').value = '';
    $('#photoFiles').disabled = false;
    hideMatches();
  }
  function resetFilters() {
    gallery = { category: 'all', favorites: false };
    $('#search').value = '';
    $('#colorFilter').value = 'all';
    $('#formFilter').value = 'all';
    $('#sort').value = 'curated';
    $('#moreFilters').hidden = true;
    $('.filter-toggle').setAttribute('aria-expanded', 'false');
    renderGallery();
  }
  function frameAttributes(frame) {
    const f = { ...defaultFrame, ...(frame || {}) };
    const styles = ['none', 'line', 'double', 'mat', 'shadow', 'polaroid'];
    const style = styles.includes(f.style) ? f.style : 'none';
    const color = /^#[\da-f]{6}$/i.test(f.color) ? f.color : defaultFrame.color;
    const px = value => Math.max(0, Math.min(80, Number(value) || 0));
    return `data-frame="${style}" style="--frame-color:${color};--frame-width:${px(f.width)}px;--frame-radius:${px(f.radius)}px;--frame-padding:${px(f.padding)}px"`;
  }
  function framedPhoto(photo, frame, extraClass = '') {
    return `<div class="photo-frame ${extraClass}" ${frameAttributes(frame)}><img src="${esc(imageURL(photo?.src))}" alt="${esc(photo?.caption || photo?.filename || '茶花照片')}" loading="lazy" decoding="async"></div>`;
  }
  function frameControls(container, prefix, frame, inherit = false) {
    const f = { ...defaultFrame, ...(frame || {}) };
    const options = [['none', '无边框'], ['line', '细线'], ['double', '双线'], ['mat', '卡纸'], ['shadow', '投影'], ['polaroid', '拍立得']];
    if (inherit) options.unshift(['inherit', '沿用相册边框']);
    const chosen = inherit && frame == null ? 'inherit' : f.style;
    $('#' + container).innerHTML = `<div class="frame-controls" data-frame-prefix="${prefix}"><label>样式<select id="${prefix}Style">${options.map(([value, label]) => `<option value="${value}" ${value === chosen ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>颜色<input id="${prefix}Color" type="color" value="${esc(f.color)}"></label><label>线宽<input id="${prefix}Width" type="range" min="0" max="24" value="${Number(f.width)}"></label><label>圆角<input id="${prefix}Radius" type="range" min="0" max="40" value="${Number(f.radius)}"></label><label>留白<input id="${prefix}Padding" type="range" min="0" max="40" value="${Number(f.padding)}"></label></div>`;
  }
  function readFrame(prefix) {
    const style = $('#' + prefix + 'Style').value;
    if (style === 'inherit') return null;
    return { style, color: $('#' + prefix + 'Color').value, width: Number($('#' + prefix + 'Width').value), radius: Number($('#' + prefix + 'Radius').value), padding: Number($('#' + prefix + 'Padding').value) };
  }
  function updateFramePreview(prefix) {
    if (prefix === 'uploadFrame') {
      const frame = readFrame(prefix);
      $$('#pendingPhotos .photo-frame').forEach(element => {
        const holder = document.createElement('div');
        holder.innerHTML = `<div ${frameAttributes(frame)}></div>`;
        element.dataset.frame = holder.firstChild.dataset.frame;
        element.setAttribute('style', holder.firstChild.getAttribute('style'));
      });
      return;
    }
    const album = getAlbum(prefix === 'albumFrame' ? $('#editingAlbumId').value : $('#editingPhotoAlbumId').value);
    if (!album) return;
    const photo = prefix === 'albumFrame' ? cover(album) : album.photos.find(item => item.id === $('#editingPhotoId').value);
    const frame = readFrame(prefix) || album.frame;
    $('#' + (prefix === 'albumFrame' ? 'albumFramePreview' : 'photoFramePreview')).innerHTML = framedPhoto(photo, frame);
  }

  function renderSettings() {
    const s = state().settings;
    $$('.brand > span').forEach(span => {
      [...span.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
      span.prepend(document.createTextNode(s.brand));
    });
    $('#heroTitle').innerHTML = `${esc(s.titleLine1)}<br><span>${esc(s.titleLine2)}</span>`;
    $('.hero-description').innerHTML = esc(s.description).replace(/\n/g, '<br>');
    $('.hero-stats > div:first-child strong').textContent = s.gardenCount;
    $('#heroAlbumCount').textContent = state().albums.length;
    document.title = `${s.brand} · 私人茶花图鉴`;
  }
  function renderHero() {
    const featured = state().albums.find(album => cover(album));
    const hero = $('.hero-art');
    hero.classList.toggle('hero-empty', !featured);
    hero.disabled = !featured;
    let image = hero.querySelector('img');
    if (!featured) {
      image?.remove(); delete hero.dataset.open;
      hero.setAttribute('aria-label', '花园等待第一朵花开');
      hero.querySelector('.hero-art-bottom strong').textContent = '等待第一朵花开';
      hero.querySelector('.hero-art-bottom em').textContent = '一个慢慢生长的花园';
      hero.querySelector('.hero-art-top > span').textContent = '始于一朵花';
      hero.querySelector('.hero-ref').textContent = '';
      return;
    }
    const photo = cover(featured);
    if (!image) { image = document.createElement('img'); image.fetchPriority = 'high'; hero.prepend(image); }
    hero.dataset.open = featured.id;
    hero.setAttribute('aria-label', `打开 ${featured.name} 相册`);
    image.src = imageURL(photo.src); image.alt = featured.name + ' · 花园摄影';
    hero.querySelector('.hero-art-bottom strong').textContent = featured.display_name || featured.name;
    hero.querySelector('.hero-art-bottom em').textContent = [categories[featured.species] || featured.species || '未分类', forms[featured.form] || '品种图鉴'].join(' · ');
    hero.querySelector('.hero-art-top > span').textContent = `01 / ${String(state().albums.length).padStart(2, '0')}`;
    hero.querySelector('.hero-ref').textContent = '花园摄影';
  }
  function renderGallery() {
    const s = state();
    const query = norm($('#search').value);
    const color = $('#colorFilter').value;
    const form = $('#formFilter').value;
    const results = s.albums.filter(album => {
      const words = [album.name, album.display_name, ...(album.chinese_name || []), ...(album.japanese_name || []), album.description, album.summary_zh, album.notes, album.species];
      return (!query || words.some(word => norm(word).includes(query))) && (gallery.category === 'all' || album.species === gallery.category) && (!gallery.favorites || s.favorites.includes(album.id)) && (color === 'all' || album.color === color) && (form === 'all' || album.form === form);
    });
    if ($('#sort').value === 'name') results.sort((a, b) => a.name.localeCompare(b.name));
    if ($('#sort').value === 'photos') results.sort((a, b) => b.photos.length - a.photos.length);
    $('#gallery').innerHTML = results.map(album => {
      const favorite = s.favorites.includes(album.id);
      const photo = cover(album);
      const ownCount = album.photos.filter(item => item.kind === 'personal').length;
      const tags = [categories[album.species] || album.species || '未分类', colors[album.color], forms[album.form] || sizes[album.size] || album.size].filter(Boolean);
      return `<article class="cultivar-card" data-id="${esc(album.id)}"><button class="card-open" data-open="${esc(album.id)}" aria-label="打开 ${esc(album.name)} 相册"><div class="card-image">${framedPhoto(photo ? { ...photo, src: photo.thumbnailSrc || photo.src } : null, photo?.frame || album.frame)}<span class="card-number">${String(s.albums.indexOf(album) + 1).padStart(2, '0')}</span>${ownCount ? '<span class="personal-tag">我的摄影</span>' : ''}<span class="card-count">${icon('camera')}${album.photos.length} 张照片</span></div><div class="card-body"><h3 class="card-name">${esc(album.display_name || album.name)}</h3><p class="card-latin">${esc(album.name)}</p><div class="card-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div></div></button><button class="favorite-button" data-favorite="${esc(album.id)}" aria-pressed="${favorite}" aria-label="${favorite ? '取消收藏' : '收藏'} ${esc(album.name)}">${icon('heart')}</button>${admin() ? `<div class="card-admin" data-admin><button data-edit-album="${esc(album.id)}">编辑品种</button><button data-delete-album="${esc(album.id)}">删除相册</button></div>` : ''}</article>`;
    }).join('');
    $('#emptyState').hidden = results.length > 0;
    $('#headingCount').textContent = s.albums.length;
    $('#navFavoriteCount').textContent = s.favorites.length;
    const own = results.reduce((sum, album) => sum + album.photos.filter(photo => photo.kind === 'personal').length, 0);
    $('#resultSummary').textContent = `${results.length} 个品种 · ${own} 张照片`;
    $('#emptyState h3').textContent = s.albums.length ? '这一朵，还没在这里盛开。' : '花园，始于第一朵花。';
    $('#emptyState p').textContent = s.albums.length ? '换一个名字，或放宽筛选条件试试。' : '这里将收藏花园里的真实花开，慢慢长成一本茶花图鉴。';
    $('#emptyReset').hidden = !s.albums.length;
    $('#filterBadge').hidden = color === 'all' && form === 'all';
    $('#filterBadge').textContent = String((color !== 'all' ? 1 : 0) + (form !== 'all' ? 1 : 0));
    $('#favoritesFilter').setAttribute('aria-pressed', gallery.favorites);
    $('.nav-favorites').classList.toggle('active', gallery.favorites);
    $('.nav-gallery').classList.toggle('active', !gallery.favorites);
    $$('[data-category]').forEach(button => {
      const active = button.dataset.category === gallery.category;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', active);
    });
  }
  function render() {
    renderSettings(); renderGallery(); renderHero();
    $$('[data-admin]').forEach(element => { element.hidden = !admin(); });
    ['adminBadge', 'siteSettings', 'logoutButton'].forEach(id => { $('#' + id).hidden = !admin(); });
    $('#loginEntry').hidden = admin();
    if ($('#albumDialog').open) renderAlbum();
  }

  function openAlbum(id, photoId) {
    const album = getAlbum(id);
    if (!album) return;
    albumView = { id, photoId: photoId || cover(album)?.id || null, filter: 'all' };
    renderAlbum();
    openDialog('albumDialog');
  }
  function renderAlbum() {
    const album = getAlbum(albumView.id);
    if (!album) { closeDialog('albumDialog'); return; }
    const photos = photosFor(album);
    const photo = photos.find(item => item.id === albumView.photoId) || photos[0];
    albumView.photoId = photo?.id || null;
    const index = photos.indexOf(photo);
    const favorite = state().favorites.includes(album.id);
    const aliases = [...new Set([...(album.chinese_name || []), ...(album.japanese_name || [])])];
    $('#albumContent').innerHTML = `<div class="album-toolbar"><span>品种相册</span><button class="icon-button album-close" data-close="albumDialog" aria-label="关闭品种相册">${icon('close')}</button></div><div class="album-layout"><div class="album-media"><div id="albumStage" class="album-stage">${photo ? `<button class="photo-zoom" data-zoom aria-label="全屏查看照片">${framedPhoto(photo, photo.frame || album.frame)}</button>${photos.length > 1 ? `<button class="photo-arrow prev" data-photo-step="-1" aria-label="上一张照片">${icon('chevron')}</button><button class="photo-arrow next" data-photo-step="1" aria-label="下一张照片">${icon('chevron')}</button>` : ''}<span class="photo-position">${index + 1} / ${photos.length}</span>` : '<div class="album-empty"><p>这里还没有照片。</p><p>添加照片，记录这个品种的第一朵花开。</p></div>'}</div><div id="albumThumbnails" class="photo-thumbnails">${photos.map(item => `<button data-photo-id="${esc(item.id)}" class="${item.id === photo?.id ? 'active' : ''}" aria-label="查看 ${esc(item.caption || item.filename || '照片')}" aria-pressed="${item.id === photo?.id}"><img src="${esc(imageURL(item.thumbnailSrc || item.src))}" alt=""></button>`).join('')}</div>${photo ? `<p class="photo-caption">${esc(photo.caption || '')}</p><p id="photoCredit" class="photo-credit">${esc(photo.kind === 'personal' ? '我的照片 · ' + photo.filename : '示例参考图' + (photo.credit ? ' · © ' + photo.credit : ''))}<br>${esc(dateLabel(photo))}${photo.source_url ? `<br><a href="${esc(sourceURL(photo.source_url))}" target="_blank" rel="noopener noreferrer">查看图片来源</a>` : ''}</p>` : ''}${admin() && photo ? `<div class="photo-admin" data-admin><button data-edit-photo="${esc(photo.id)}">编辑照片与边框</button><button data-cover-photo="${esc(photo.id)}" ${album.coverPhotoId === photo.id ? 'disabled' : ''}>${album.coverPhotoId === photo.id ? '当前封面' : '设为封面'}</button><button data-move-photo="${esc(photo.id)}" data-direction="-1" ${album.photos.indexOf(photo) === 0 ? 'disabled' : ''}>向前移动</button><button data-move-photo="${esc(photo.id)}" data-direction="1" ${album.photos.indexOf(photo) === album.photos.length - 1 ? 'disabled' : ''}>向后移动</button><button data-delete-photo="${esc(photo.id)}">删除这张照片</button></div>` : ''}</div><div class="album-info"><p class="album-category">${esc(categories[album.species] || album.species || '未分类')}</p><h2>${esc(album.display_name || album.name)}</h2><p class="album-latin">${esc(album.name)}</p>${aliases.length ? `<p class="album-aliases">其他名称 · ${esc(aliases.join(' / '))}</p>` : ''}<p class="album-description">${esc(album.summary_zh || album.description || '尚未填写品种描述。').replace(/\n/g, '<br>')}</p><dl class="album-facts"><div><dt>类别</dt><dd>${esc(categories[album.species] || album.species || '未分类')}</dd></div><div><dt>花色</dt><dd>${esc(colors[album.color] || '见品种描述')}</dd></div><div><dt>花型</dt><dd>${esc(forms[album.form] || '见品种描述')}</dd></div><div><dt>花径分类</dt><dd>${esc(sizes[album.size] || album.size || '未标注')}</dd></div></dl>${album.notes ? `<div class="album-notes"><h3>我的备注</h3><p>${esc(album.notes).replace(/\n/g, '<br>')}</p></div>` : ''}<a class="source-link" href="${esc(sourceURL(album.reference_url))}" target="_blank" rel="noopener noreferrer">查看完整品种资料 ${icon('external')}</a><div class="album-photo-tabs" role="group" aria-label="照片来源">${[['all', '全部照片']].map(([kind, label]) => `<button data-photo-filter="${kind}" aria-pressed="${albumView.filter === kind}">${label} ${album.photos.filter(item => kind === 'all' || item.kind === kind).length}</button>`).join('')}</div><div class="album-actions">${admin() ? `<button class="primary-button" data-add-to="${esc(album.id)}" data-admin>${icon('plus')}添加同品种照片</button><button data-edit-album="${esc(album.id)}" data-admin>编辑品种</button><button data-delete-album="${esc(album.id)}" data-admin>删除整个相册</button>` : ''}<button class="album-heart" data-favorite="${esc(album.id)}" aria-pressed="${favorite}">${icon('heart')}${favorite ? '已收藏' : '收藏品种'}</button></div></div></div>`;
    if ($('#lightbox')?.open) renderLightbox();
  }
  function stepPhoto(direction) {
    const album = getAlbum(albumView.id);
    if (!album) return;
    const photos = photosFor(album);
    if (!photos.length) return;
    const index = photos.findIndex(photo => photo.id === albumView.photoId);
    albumView.photoId = photos[(index + direction + photos.length) % photos.length].id;
    renderAlbum();
  }
  function renderLightbox() {
    const album = getAlbum(albumView.id);
    const photo = album?.photos.find(item => item.id === albumView.photoId);
    if (!photo) { closeDialog('lightbox'); return; }
    $('#lightbox').innerHTML = `<button class="icon-button lightbox-close" data-close="lightbox" aria-label="退出全屏">${icon('close')}</button>${framedPhoto(photo, photo.frame || album.frame)}<button class="photo-arrow prev" data-photo-step="-1" aria-label="上一张">${icon('chevron')}</button><button class="photo-arrow next" data-photo-step="1" aria-label="下一张">${icon('chevron')}</button><p class="lightbox-caption">${esc(album.name)} · ${esc(photo.caption || photo.filename)}<br>${esc(dateLabel(photo))}</p>`;
  }
  function openLightbox() {
    if (!$('#lightbox')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'lightbox'; dialog.className = 'lightbox'; dialog.setAttribute('aria-label', '全屏照片');
      document.body.append(dialog); wireDialog(dialog);
    }
    renderLightbox(); openDialog('lightbox');
  }

  function openUpload(id) {
    if (!requireAdmin()) return;
    if ($('#uploadDialog').open) return;
    clearPending();
    $('#uploadForm').reset();
    $('#uploadError').textContent = '';
    $('#importStatus').textContent = '';
    $('#pendingPhotos').innerHTML = '';
    frameControls('uploadFrameControls', 'uploadFrame', null, true);
    setSelected(id ? getAlbum(id) : null);
    openDialog('uploadDialog');
    loadCatalogue(uploadGeneration);
    if (!selected) $('#cultivarSearch').focus();
  }
  function hideMatches() {
    $('#cultivarResults').hidden = true;
    $('#cultivarSearch').setAttribute('aria-expanded', 'false');
    $('#cultivarSearch').removeAttribute('aria-activedescendant');
    catalogueActive = -1;
  }
  function updateUpload() {
    $('#uploadPhotoSection').hidden = !selected;
    $('#batchFrame').hidden = pending.length === 0;
    $('#uploadSubmit').disabled = !selected || pending.length === 0 || reading || !admin() || saving || loading;
    $('#uploadSummary').textContent = selected ? `${selected.display_name || selected.name} · ${pending.length} 张待加入${reading ? ' · 正在读取' : ''}` : (pending.length ? `保留 ${pending.length} 张待加入照片，请重新选择目标品种` : '先选择一个品种');
    $('#stepCultivar').classList.toggle('active', !selected);
    $('#stepPhotos').classList.toggle('active', !!selected && !pending.length);
    $('#stepReview').classList.toggle('active', pending.length > 0);
  }
  function setSelected(cultivar) {
    selected = cultivar || null;
    hideMatches();
    $('#clearCultivar').hidden = !selected && !$('#cultivarSearch').value;
    $('#selectedCultivarCard').hidden = !selected;
    if (selected) {
      $('#cultivarSearch').value = selected.name;
      $('#selectedCultivarCard').innerHTML = `<div class="selected-cultivar-heading"><strong>${esc(selected.display_name || selected.name)}</strong><span>${esc(categories[selected.species] || selected.species || '未分类')}</span></div><p class="selected-cultivar-name">${esc(selected.name)}</p><p class="selected-cultivar-description">${esc(selected.summary_zh || selected.description || '尚未填写描述。')}</p><p>本次所有照片将加入这个品种的同一本相册。</p><a class="selected-cultivar-link" href="${esc(sourceURL(selected.reference_url))}" target="_blank" rel="noopener noreferrer">查看品种资料 ${icon('external')}</a>`;
    }
    if (pending.length) updateFramePreview('uploadFrame');
    updateUpload();
  }
  async function loadCatalogue(generation) {
    $('#catalogueStatus').textContent = '正在连接品种资料库…已有相册可离线选择。';
    $('#cultivarSearch').setAttribute('aria-busy', 'true');
    try {
      const index = await window.CamelliaCatalog.loadIndex();
      if (generation !== uploadGeneration || !$('#uploadDialog').open) return;
      catalogueReady = true; catalogueCount = index.length;
      $('#catalogueStatus').textContent = `${catalogueCount.toLocaleString()} 个品种可搜索 · 从结果中选择目标品种`;
      if (!selected) renderMatches();
    } catch (_) {
      if (generation !== uploadGeneration || !$('#uploadDialog').open) return;
      $('#catalogueStatus').textContent = '目录暂时离线，仍可搜索并选择现有相册。';
      if (!selected) renderMatches();
    } finally {
      if (generation === uploadGeneration) $('#cultivarSearch').setAttribute('aria-busy', 'false');
    }
  }
  function renderMatches() {
    if (selected) { hideMatches(); return; }
    const query = norm($('#cultivarSearch').value);
    const local = state().albums.filter(album => !query || [album.name, album.display_name, ...(album.chinese_name || []), ...(album.japanese_name || [])].some(name => norm(name).includes(query)));
    const live = catalogueReady && query ? window.CamelliaCatalog.search($('#cultivarSearch').value, { limit: 30 }).results : [];
    catalogueMatches = [...local, ...live.filter(item => !local.some(album => album.name === item.name))].slice(0, 35);
    catalogueActive = -1;
    $('#cultivarResults').innerHTML = catalogueMatches.length ? catalogueMatches.map((item, index) => `<button type="button" role="option" id="catalog-option-${index}" class="cultivar-option" data-catalog-name="${esc(item.name)}" aria-selected="false" tabindex="-1"><span class="option-name">${esc(item.name)}</span><span class="option-species">${esc(categories[item.species] || item.species || '未分类')}</span><span class="option-aliases">${esc([item.display_name, ...(item.chinese_name || []), ...(item.japanese_name || [])].filter(Boolean).join(' / '))}${getAlbum(item.id) ? ' · 已有相册' : ''}</span></button>`).join('') : '<div class="cultivar-no-results">没有找到这个品种。试试英文名、中文名或别名。</div>';
    $('#cultivarResults').hidden = false;
    $('#cultivarSearch').setAttribute('aria-expanded', 'true');
    $('#cultivarSearch').removeAttribute('aria-activedescendant');
  }
  async function chooseCultivar(name) {
    if (!requireAdmin()) return;
    const local = state().albums.find(album => album.name === name);
    if (local) { selectionGeneration++; setSelected(local); return; }
    const generation = uploadGeneration;
    const selection = ++selectionGeneration;
    hideMatches();
    $('#cultivarSearch').value = name;
    $('#catalogueStatus').textContent = `正在读取 ${name} 的完整品种资料…`;
    try {
      const raw = await window.CamelliaCatalog.getEntry(name);
      if (generation !== uploadGeneration || selection !== selectionGeneration || !$('#uploadDialog').open) return;
      setSelected(window.CamelliaCatalog.toCultivar(raw));
      $('#catalogueStatus').textContent = '品种已选择 · 现在可多选照片，同批进入一本相册。';
    } catch (_) {
      if (generation !== uploadGeneration || selection !== selectionGeneration || !$('#uploadDialog').open) return;
      $('#catalogueStatus').textContent = '完整品种资料读取失败。请重新选择重试，或选择现有相册。';
    }
  }
  function highlightMatch(index) {
    if (!catalogueMatches.length) return;
    catalogueActive = (index + catalogueMatches.length) % catalogueMatches.length;
    $$('#cultivarResults .cultivar-option').forEach((option, i) => option.setAttribute('aria-selected', i === catalogueActive));
    const active = $('#catalog-option-' + catalogueActive);
    $('#cultivarSearch').setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
  function renderPending() {
    const frame = readFrame('uploadFrame') || selected?.frame || defaultFrame;
    $('#pendingPhotos').innerHTML = pending.map(photo => `<article class="pending-photo" data-pending-id="${esc(photo.id)}">${framedPhoto(photo, frame)}<div class="pending-photo-details"><strong>${esc(photo.filename || '茶花照片')}</strong><label>照片说明<input data-pending-caption="${esc(photo.id)}" value="${esc(photo.caption)}" placeholder="给这一张写一句话…"></label><label>拍摄日期与时间<input class="pending-date" type="datetime-local" data-pending-date="${esc(photo.id)}" value="${esc(photo.takenAt || '')}"></label><p class="pending-date-source">${esc(dateLabel(photo))}</p><button type="button" data-remove-pending="${esc(photo.id)}">移除这张</button></div></article>`).join('');
    updateUpload();
  }
  async function readFiles(files) {
    if (!requireAdmin() || !selected || reading) return;
    const generation = uploadGeneration;
    const list = [...files];
    if (!list.length) return;
    reading = true;
    $('#photoFiles').disabled = true;
    $('#uploadError').textContent = '';
    updateUpload();
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      if (generation !== uploadGeneration) break;
      $('#importStatus').textContent = `正在读取 ${i + 1} / ${list.length}：${list[i].name}`;
      const photo = await io.readFile(list[i]);
      if (photo.src?.startsWith('blob:')) ownedURLs.add(photo.src);
      if (generation !== uploadGeneration || !$('#uploadDialog').open) { revoke(photo.src); break; }
      if (photo.error) failed.push(list[i].name + '：' + photo.error);
      else pending.push(photo);
      renderPending();
    }
    if (generation !== uploadGeneration) return;
    reading = false;
    $('#photoFiles').disabled = false;
    $('#photoFiles').value = '';
    $('#importStatus').textContent = `已读取 ${pending.length} 张照片。可继续选择照片加入这一批。`;
    $('#uploadError').textContent = failed.length ? `无法预览：${failed.join('、')}。请转为 JPEG 或 PNG 后重试；其余照片已保留。` : '';
    renderPending();
  }
  async function saveUpload(event) {
    event.preventDefault();
    if (!requireAdmin() || reading) return;
    if (!selected || !pending.length) { $('#uploadError').textContent = '请先选择品种，再选择至少一张照片。'; return; }
    if (pending.some(photo => state().albums.some(album => album.photos.some(saved => saved.id === photo.id)))) {
      $('#uploadError').textContent = '最新花园中已包含这一批的部分照片。请核对相册，并移除已保存的待上传预览后再继续，避免重复上传。';
      return;
    }
    const target = { ...selected };
    const frame = readFrame('uploadFrame');
    const files = [];
    const photos = pending.map(photo => {
      const imagePath = `photos/${photo.id}/image.jpg`;
      const thumbnailPath = `photos/${photo.id}/thumbnail.jpg`;
      files.push({ path: imagePath, blob: photo.imageBlob }, { path: thumbnailPath, blob: photo.thumbnailBlob });
      const fields = ['id','filename','caption','takenAt','dateSource','dateOffset','width','height','size','mime'];
      const metadata = Object.fromEntries(fields.filter(key => photo[key] !== undefined).map(key => [key, photo[key]]));
      return { ...metadata, kind: 'personal', frame: frame ? { ...frame } : null, imagePath, thumbnailPath, src: store.photoURL(imagePath), thumbnailSrc: store.photoURL(thumbnailPath) };
    });
    const next = await saveAction({ type: 'ADD_PHOTOS', cultivar: target, photos }, { files, message: `Add ${photos.length} photographs` }, '#uploadError');
    if (!next) return;
    const album = next.albums.find(item => item.id === target.id || item.name === target.name);
    dirtyDialogs.delete('uploadDialog'); closeDialog('uploadDialog');
    if (album) openAlbum(album.id, photos[0]?.id);
  }

  function openAlbumEdit(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(id);
    if (!album) return;
    $('#editingAlbumId').value = id;
    $('#editDisplayName').value = album.display_name || album.name;
    $('#editCanonicalName').value = album.name;
    $('#editSpecies').value = album.species || '';
    $('#editSize').value = album.size || '';
    $('#editColor').value = album.color || '';
    $('#editForm').value = album.form || '';
    $('#editDescription').value = album.summary_zh || album.description || '';
    $('#editNotes').value = album.notes || '';
    $('#albumEditError').textContent = '';
    frameControls('albumFrameControls', 'albumFrame', album.frame);
    updateFramePreview('albumFrame');
    openDialog('albumEditDialog');
  }
  function openPhotoEdit(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(albumView.id);
    const photo = album?.photos.find(item => item.id === id);
    if (!photo) return;
    $('#editingPhotoAlbumId').value = album.id;
    $('#editingPhotoId').value = photo.id;
    $('#editCaption').value = photo.caption || '';
    $('#editTakenAt').value = photo.takenAt || '';
    $('#photoDateSource').textContent = dateLabel(photo);
    frameControls('photoFrameControls', 'photoFrame', photo.frame, true);
    updateFramePreview('photoFrame');
    openDialog('photoEditDialog');
  }
  function openSettings() {
    if (!requireAdmin()) return;
    const settings = state().settings;
    $('#settingBrand').value = settings.brand;
    $('#settingTitle1').value = settings.titleLine1;
    $('#settingTitle2').value = settings.titleLine2;
    $('#settingDescription').value = settings.description;
    $('#settingCount').value = settings.gardenCount;
    openDialog('settingsDialog');
  }
  async function deleteAlbum(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(id);
    if (!album) return;
    if (!await confirmAction(`删除「${album.display_name || album.name}」整个相册和其中 ${album.photos.length} 张照片？公开花园会移除这些内容，可通过 Git 历史恢复。`)) return;
    if (!requireAdmin()) return;
    const removePaths = album.photos.flatMap(photo => [photo.imagePath, photo.thumbnailPath]).filter(Boolean);
    await saveAction({ type: 'DELETE_ALBUM', id }, { removePaths, message: 'Delete cultivar album' });
  }
  async function deletePhoto(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(albumView.id);
    const photo = album?.photos.find(item => item.id === id);
    if (!photo) return;
    if (!await confirmAction(`删除这张照片「${photo.caption || photo.filename}」？品种相册仍保留，可通过 Git 历史恢复照片。`)) return;
    if (!requireAdmin()) return;
    await saveAction({ type: 'DELETE_PHOTO', albumId: album.id, photoId: id }, { removePaths: [photo.imagePath, photo.thumbnailPath].filter(Boolean), message: 'Delete photograph' });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button,a');
    if (!button) return;
    if (button.dataset.close) { requestClose(button.dataset.close); return; }
    if (saving || loading) return;
    if (button.dataset.open) { openAlbum(button.dataset.open); return; }
    if (button.dataset.favorite) { act({ type: 'TOGGLE_FAVORITE', id: button.dataset.favorite }); return; }
    if (button.dataset.editAlbum) { openAlbumEdit(button.dataset.editAlbum); return; }
    if (button.dataset.deleteAlbum) { deleteAlbum(button.dataset.deleteAlbum); return; }
    if (button.dataset.addTo) { openUpload(button.dataset.addTo); return; }
    if (button.matches('.add-photo,#mobileAddPhoto')) { openUpload(); return; }
    if (button.dataset.catalogName) { chooseCultivar(button.dataset.catalogName); return; }
    if (button.hasAttribute('data-photo-step')) { stepPhoto(Number(button.dataset.photoStep)); return; }
    if (button.dataset.photoId) { albumView.photoId = button.dataset.photoId; renderAlbum(); return; }
    if (button.dataset.photoFilter) { albumView.filter = button.dataset.photoFilter; albumView.photoId = null; renderAlbum(); return; }
    if (button.hasAttribute('data-zoom')) { openLightbox(); return; }
    if (button.dataset.editPhoto) { openPhotoEdit(button.dataset.editPhoto); return; }
    if (button.dataset.deletePhoto) { deletePhoto(button.dataset.deletePhoto); return; }
    if (button.dataset.coverPhoto || button.dataset.movePhoto) {
      if (!requireAdmin()) return;
      saveAction({ type: button.dataset.coverPhoto ? 'SET_COVER' : 'MOVE_PHOTO', albumId: albumView.id, photoId: button.dataset.coverPhoto || button.dataset.movePhoto, direction: Number(button.dataset.direction) }); return;
    }
    if (button.dataset.removePending) {
      if (!requireAdmin()) return;
      const photo = pending.find(item => item.id === button.dataset.removePending);
      pending = pending.filter(item => item !== photo); if (photo) revoke(photo.src); renderPending(); return;
    }
    if (button.dataset.category) { gallery.category = button.dataset.category; renderGallery(); return; }
    if (button.id === 'reloadGallery' || button.matches('.reload-draft')) { loadGallery(); return; }
    if (button.id === 'loginEntry' || button.matches('.reauth-draft')) { $('#githubToken').value = ''; $('#loginError').textContent = ''; openDialog('loginDialog'); return; }
    if (button.id === 'logoutButton') { logout(); return; }
    if (button.id === 'siteSettings') { openSettings(); return; }
    if (button.id === 'useManualCultivar') {
      if (!requireAdmin()) return;
      const name = $('#cultivarSearch').value.trim();
      if (!name) { $('#catalogueStatus').textContent = '请先输入品种名称。'; return; }
      selectionGeneration++; setSelected({ name, display_name: name }); return;
    }
    if (button.id === 'clearCultivar') {
      if (!requireAdmin()) return;
      selectionGeneration++; $('#cultivarSearch').value = ''; setSelected(null); renderMatches(); $('#cultivarSearch').focus(); return;
    }
    if (button.id === 'favoritesFilter' || button.matches('.nav-favorites')) {
      gallery.favorites = button.id === 'favoritesFilter' ? !gallery.favorites : true;
      renderGallery(); if (button.matches('.nav-favorites')) $('#collection').scrollIntoView({ behavior: 'smooth' }); return;
    }
    if (button.matches('.nav-gallery')) { gallery.favorites = false; renderGallery(); return; }
    if (button.id === 'resetFilters' || button.id === 'emptyReset') { resetFilters(); return; }
    if (button.matches('.filter-toggle')) {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', !expanded); $('#moreFilters').hidden = expanded;
    }
  });
  document.addEventListener('click', event => { if (!event.target.closest('.cultivar-picker')) hideMatches(); });
  $('#search').addEventListener('input', renderGallery);
  ['colorFilter', 'formFilter', 'sort'].forEach(id => $('#' + id).addEventListener('change', renderGallery));
  $('#cultivarSearch').addEventListener('input', () => {
    selectionGeneration++; setSelected(null); $('#clearCultivar').hidden = !$('#cultivarSearch').value; renderMatches();
  });
  $('#cultivarSearch').addEventListener('focus', () => { if (!selected) renderMatches(); });
  $('#cultivarSearch').addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); if ($('#cultivarResults').hidden) renderMatches();
      highlightMatch(catalogueActive < 0 ? (event.key === 'ArrowDown' ? 0 : catalogueMatches.length - 1) : catalogueActive + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && !selected) {
      event.preventDefault();
      const item = catalogueMatches[catalogueActive] || (catalogueMatches.length === 1 ? catalogueMatches[0] : null);
      if (!$('#cultivarResults').hidden && item) chooseCultivar(item.name);
    } else if (event.key === 'Escape' && !$('#cultivarResults').hidden) { event.preventDefault(); event.stopPropagation(); hideMatches(); }
    else if (event.key === 'Tab') hideMatches();
  });
  $('#cultivarResults').addEventListener('mousedown', event => event.preventDefault());
  $('#photoFiles').addEventListener('change', event => readFiles(event.target.files));
  $('#uploadForm').addEventListener('submit', saveUpload);
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (saving || loading) return;
    let token = $('#githubToken').value;
    $('#githubToken').value = '';
    loading = true; lockUI(); $('#loginError').textContent = '正在验证身份与仓库写入权限…';
    const generation = ++sessionGeneration;
    try {
      const result = await store.login(token);
      token = '';
      if (generation !== sessionGeneration) return;
      model.accept(result.document); model.setAuthenticated(true); recoveryRequired = false;
      const reconciled = reconcilePending(result.document);
      status('管理员身份已验证。修改将保存到 GitHub。' + reconciled);
      loading = false; lockUI(); closeDialog('loginDialog');
    } catch (error) {
      token = ''; store.logout(); model.setAuthenticated(false);
      $('#loginError').textContent = error.message || '验证失败，请重试。';
    } finally { loading = false; lockUI(); render(); updateUpload(); }
  });
  async function logout() {
    if (saving || loading) return;
    if ((pending.length || dirtyDialogs.size) && !await confirmAction('退出将丢弃尚未保存的输入和照片。已发布内容会保留。', '丢弃并退出')) return;
    sessionGeneration++; store.logout(); model.setAuthenticated(false);
    dirtyDialogs.clear(); clearPending();
    $$('dialog[open]').filter(dialog => dialog.id !== 'albumDialog').forEach(dialog => dialog.close());
    render(); status('已退出管理。花园仍可公开浏览。');
  }
  $('#albumEditForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!requireAdmin()) return;
    const description = $('#editDescription').value;
    const patch = { name: $('#editCanonicalName').value, display_name: $('#editDisplayName').value, species: $('#editSpecies').value, size: $('#editSize').value, color: $('#editColor').value, form: $('#editForm').value, description, summary_zh: description, notes: $('#editNotes').value, frame: readFrame('albumFrame') };
    const next = await saveAction({ type: 'PATCH_ALBUM', id: $('#editingAlbumId').value, patch }, {}, '#albumEditError');
    if (next) { dirtyDialogs.delete('albumEditDialog'); closeDialog('albumEditDialog'); }
  });
  $('#photoEditForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!requireAdmin()) return;
    const albumId = $('#editingPhotoAlbumId').value;
    const photoId = $('#editingPhotoId').value;
    const photo = getAlbum(albumId)?.photos.find(item => item.id === photoId);
    const takenAt = $('#editTakenAt').value;
    const dateSource = !takenAt ? 'unknown' : takenAt === photo?.takenAt ? photo.dateSource : 'manual';
    const dateOffset = dateSource === 'exif' ? photo.dateOffset : '';
    const next = await saveAction({ type: 'PATCH_PHOTO', albumId, photoId, patch: { caption: $('#editCaption').value, takenAt, dateSource, dateOffset, frame: readFrame('photoFrame') } });
    if (next) { dirtyDialogs.delete('photoEditDialog'); closeDialog('photoEditDialog'); }
  });
  $('#settingsForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!requireAdmin()) return;
    const next = await saveAction({ type: 'PATCH_SETTINGS', patch: { brand: $('#settingBrand').value, titleLine1: $('#settingTitle1').value, titleLine2: $('#settingTitle2').value, description: $('#settingDescription').value, gardenCount: $('#settingCount').value } });
    if (next) { dirtyDialogs.delete('settingsDialog'); closeDialog('settingsDialog'); }
  });
  document.addEventListener('input', event => {
    const target = event.target;
    const dialog = target.closest('dialog');
    if (dialog && !['loginDialog','confirmDialog'].includes(dialog.id)) dirtyDialogs.add(dialog.id);
    const frame = target.closest('[data-frame-prefix]');
    if (frame) updateFramePreview(frame.dataset.framePrefix);
    if (target.dataset.pendingCaption) {
      const photo = pending.find(item => item.id === target.dataset.pendingCaption);
      if (photo) photo.caption = target.value;
    }
    if (target.dataset.pendingDate) {
      const photo = pending.find(item => item.id === target.dataset.pendingDate);
      if (photo) {
        photo.takenAt = target.value; photo.dateSource = target.value ? 'manual' : 'unknown'; photo.dateOffset = '';
        target.closest('.pending-photo').querySelector('.pending-date-source').textContent = dateLabel(photo);
      }
    }
    if (target.id === 'editTakenAt') $('#photoDateSource').textContent = target.value ? '手动填写 · ' + target.value.replace('T', ' ') : '拍摄时间未知 · 不会使用文件日期代替';
  });
  function wireDialog(dialog) {
    dialog.addEventListener('cancel', event => {
      if (dialog.id === 'confirmDialog') return;
      event.preventDefault(); requestClose(dialog.id);
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || dialog.id === 'confirmDialog') return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose(dialog.id);
    });
    dialog.addEventListener('close', () => {
      dirtyDialogs.delete(dialog.id);
      if (dialog.id === 'uploadDialog') { clearPending(); $('#photoFiles').disabled = false; }
      if (dialog.id === 'loginDialog') $('#githubToken').value = '';
      if (dialog.id === 'albumDialog') closeDialog('lightbox');
    });
  }
  $$('dialog').forEach(wireDialog);
  document.addEventListener('keydown', event => {
    if (saving || loading || event.target.matches('input,textarea,select') || event.isComposing) return;
    if (event.key === '/' && !$('dialog[open]')) { event.preventDefault(); $('#search').focus(); $('#collection').scrollIntoView({ behavior: 'smooth' }); }
    const top = $$('dialog[open]').at(-1);
    if (top && ['albumDialog', 'lightbox'].includes(top.id)) {
      if (event.key === 'ArrowRight') { event.preventDefault(); stepPhoto(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepPhoto(-1); }
    }
  });
  window.addEventListener('beforeunload', event => {
    if (saving || pending.length || dirtyDialogs.size) { event.preventDefault(); event.returnValue = ''; }
  });
  render();
  loadGallery();
})();
