/* Production gallery: rendered records change only after GitHub confirms a save. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s\p{P}]/gu, '');
  const isManagerPage = document.body.dataset.page === 'manager';
  const categories = { Japonica: 'Japonica', Sasanqua: 'Sasanqua', Reticulata: 'Reticulata', NRH: 'Hybrid', Wabisuke: 'Wabisuke', Rusticana: 'Rusticana' };
  const forms = { formal: 'Formal double', single: 'Single', semi: 'Semi-double', peony: 'Peony', anemone: 'Anemone' };
  const colors = { pink: 'Pink', white: 'White', red: 'Red', bicolor: 'Bicolor', yellow: 'Pale yellow' };
  const sizes = { Medium: 'Medium', Large: 'Large', 'Very large': 'Very large', Miniature: 'Miniature', Small: 'Small', 'Small to medium': 'Small to medium', 'Medium to large': 'Medium to large' };
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
  const admin = () => isManagerPage && state().role === 'admin' && store.isAuthenticated();
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
    if (recoveryRequired) { status('Reload the latest garden before saving. Your draft is preserved.', true, true); return null; }
    const proposal = model.propose(action);
    if (proposal.error) { if (errorTarget) $(errorTarget).textContent = proposal.notice; toast(proposal.notice); return null; }
    const generation = sessionGeneration;
    saving = true; lockUI();
    status('Saving to GitHub. Keep this page open…');
    if (errorTarget) $(errorTarget).textContent = '';
    try {
      const result = await store.save(proposal.document, { ...options, onProgress: message => status(message) });
      if (generation !== sessionGeneration) return null;
      model.accept(result.document);
      status('Saved to the garden.');
      toast(proposal.notice);
      return state();
    } catch (error) {
      const message = error.message || 'Could not save. Please try again.';
      recoveryRequired = ['CONFLICT', 'UNCERTAIN'].includes(error.code);
      if (['AUTH', 'PERMISSION'].includes(error.code)) {
        store.logout(); model.setAuthenticated(false);
      }
      if (errorTarget) $(errorTarget).textContent = message + ' Your draft is preserved.';
      status(message + ' Your draft is preserved.' + (recoveryRequired ? ' Reload the latest garden, review your draft, then save.' : ''), true, true);
      toast(message);
      return null;
    } finally { saving = false; lockUI(); render(); updateUpload(); }
  }
  async function loadGallery() {
    if (saving || loading) return;
    const generation = sessionGeneration;
    loading = true; lockUI(); status('Loading the latest garden…');
    try {
      const document = await store.loadPublic();
      if (generation !== sessionGeneration) return;
      model.accept(document); recoveryRequired = false;
      const reconciled = reconcilePending(document);
      status('Garden updated.' + reconciled + (dirtyDialogs.size || pending.length ? ' Your edits and pending photos are preserved. Review the latest content before saving.' : ''));
    } catch (error) { status(error.message || 'Could not load the garden. Please try again.', true, true); }
    finally { loading = false; lockUI(); render(); updateUpload(); }
  }
  function requireAdmin() {
    if (!isManagerPage) return false;
    if (admin() && !saving && !loading) return true;
    if (!saving && !loading) toast('Sign in as the owner before making changes.');
    return false;
  }
  function openDialog(id) {
    if (saving || loading) return;
    if (id === 'loginDialog' && !isManagerPage) return;
    const dialog = $('#' + id);
    if (dialog && !dialog.open) dialog.showModal();
  }
  function closeDialog(id) { if (!saving && !loading) $('#' + id)?.close(); }
  function confirmAction(message, label = 'Confirm deletion') {
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
      if (!await confirmAction('Closing will discard unsaved edits and photos in this window. Published content will remain.', 'Discard draft')) return;
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
    return count ? ` Confirmed ${count} pending photos were saved and removed their previews. Other draft content is preserved.` : '';
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
    return `<div class="photo-frame ${extraClass}" ${frameAttributes(frame)}><img src="${esc(imageURL(photo?.src))}" alt="${esc(photo?.caption || photo?.filename || 'Camellia photograph')}" loading="lazy" decoding="async"></div>`;
  }
  function frameControls(container, prefix, frame, inherit = false) {
    const f = { ...defaultFrame, ...(frame || {}) };
    const options = [['none', 'None'], ['line', 'Line'], ['double', 'Double line'], ['mat', 'Mat'], ['shadow', 'Shadow'], ['polaroid', 'Polaroid']];
    if (inherit) options.unshift(['inherit', 'Use album frame']);
    const chosen = inherit && frame == null ? 'inherit' : f.style;
    $('#' + container).innerHTML = `<div class="frame-controls" data-frame-prefix="${prefix}"><label>Style<select id="${prefix}Style">${options.map(([value, label]) => `<option value="${value}" ${value === chosen ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Color<input id="${prefix}Color" type="color" value="${esc(f.color)}"></label><label>Width<input id="${prefix}Width" type="range" min="0" max="24" value="${Number(f.width)}"></label><label>Corners<input id="${prefix}Radius" type="range" min="0" max="40" value="${Number(f.radius)}"></label><label>Padding<input id="${prefix}Padding" type="range" min="0" max="40" value="${Number(f.padding)}"></label></div>`;
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
    document.title = `${s.brand} · Camellia Garden`;
  }
  function renderHero() {
    const featured = state().albums.find(album => cover(album));
    const hero = $('.hero-art');
    hero.classList.toggle('hero-empty', !featured);
    hero.disabled = !featured;
    let image = hero.querySelector('img');
    if (!featured) {
      image?.remove(); delete hero.dataset.open;
      hero.setAttribute('aria-label', 'A garden waiting for its first bloom');
      hero.querySelector('.hero-art-bottom strong').textContent = 'Waiting for the first bloom';
      hero.querySelector('.hero-art-bottom em').textContent = 'A garden growing with time';
      hero.querySelector('.hero-art-top > span').textContent = 'It begins with a bloom';
      hero.querySelector('.hero-ref').textContent = '';
      return;
    }
    const photo = cover(featured);
    if (!image) { image = document.createElement('img'); image.fetchPriority = 'high'; hero.prepend(image); }
    hero.dataset.open = featured.id;
    hero.setAttribute('aria-label', `Open ${featured.name} album`);
    image.src = imageURL(photo.src); image.alt = featured.name + ' · Garden photography';
    hero.querySelector('.hero-art-bottom strong').textContent = featured.display_name || featured.name;
    hero.querySelector('.hero-art-bottom em').textContent = [categories[featured.species] || featured.species || 'Uncategorized', forms[featured.form] || 'Cultivar guide'].join(' · ');
    hero.querySelector('.hero-art-top > span').textContent = `01 / ${String(state().albums.length).padStart(2, '0')}`;
    hero.querySelector('.hero-ref').textContent = 'Garden photography';
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
      const tags = [categories[album.species] || album.species || 'Uncategorized', colors[album.color], forms[album.form] || sizes[album.size] || album.size].filter(Boolean);
      return `<article class="cultivar-card" data-id="${esc(album.id)}"><button class="card-open" data-open="${esc(album.id)}" aria-label="Open ${esc(album.name)} album"><div class="card-image">${framedPhoto(photo ? { ...photo, src: photo.thumbnailSrc || photo.src } : null, photo?.frame || album.frame)}<span class="card-number">${String(s.albums.indexOf(album) + 1).padStart(2, '0')}</span>${ownCount ? '<span class="personal-tag">Garden photos</span>' : ''}<span class="card-count">${icon('camera')}${album.photos.length} photos</span></div><div class="card-body"><h3 class="card-name">${esc(album.display_name || album.name)}</h3><p class="card-latin">${esc(album.name)}</p><div class="card-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div></div></button><button class="favorite-button" data-favorite="${esc(album.id)}" aria-pressed="${favorite}" aria-label="${favorite ? 'Remove favorite' : 'Favorite'} ${esc(album.name)}">${icon('heart')}</button>${admin() ? `<div class="card-admin" data-admin><button data-edit-album="${esc(album.id)}">Edit cultivar</button><button data-delete-album="${esc(album.id)}">Delete album</button></div>` : ''}</article>`;
    }).join('');
    $('#emptyState').hidden = results.length > 0;
    $('#headingCount').textContent = s.albums.length;
    $('#navFavoriteCount').textContent = s.favorites.length;
    const own = results.reduce((sum, album) => sum + album.photos.filter(photo => photo.kind === 'personal').length, 0);
    $('#resultSummary').textContent = `${results.length} cultivars · ${own} photos`;
    $('#emptyState h3').textContent = s.albums.length ? 'This bloom is still waiting to be found.' : 'A garden begins with a bloom.';
    $('#emptyState p').textContent = s.albums.length ? 'Try another name or broaden your filters.' : 'Real blooms from the garden will grow into a camellia collection here.';
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
    ['adminBadge', 'siteSettings', 'logoutButton'].forEach(id => { const element = $('#' + id); if (element) element.hidden = !admin(); });
    if ($('#loginEntry')) $('#loginEntry').hidden = admin();
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
    $('#albumContent').innerHTML = `<div class="album-toolbar"><span>Cultivar album</span><button class="icon-button album-close" data-close="albumDialog" aria-label="Close cultivar album">${icon('close')}</button></div><div class="album-layout"><div class="album-media"><div id="albumStage" class="album-stage">${photo ? `<button class="photo-zoom" data-zoom aria-label="View photograph fullscreen">${framedPhoto(photo, photo.frame || album.frame)}</button>${photos.length > 1 ? `<button class="photo-arrow prev" data-photo-step="-1" aria-label="Previous photograph">${icon('chevron')}</button><button class="photo-arrow next" data-photo-step="1" aria-label="Next photograph">${icon('chevron')}</button>` : ''}<span class="photo-position">${index + 1} / ${photos.length}</span>` : '<div class="album-empty"><p>No photographs yet.</p><p>Add a photograph to remember this cultivar’s first bloom.</p></div>'}</div><div id="albumThumbnails" class="photo-thumbnails">${photos.map(item => `<button data-photo-id="${esc(item.id)}" class="${item.id === photo?.id ? 'active' : ''}" aria-label="View ${esc(item.caption || item.filename || 'photograph')}" aria-pressed="${item.id === photo?.id}"><img src="${esc(imageURL(item.thumbnailSrc || item.src))}" alt=""></button>`).join('')}</div>${photo ? `<p class="photo-caption">${esc(photo.caption || '')}</p><p id="photoCredit" class="photo-credit">${esc(photo.kind === 'personal' ? 'Garden photograph · ' + photo.filename : 'Reference photograph' + (photo.credit ? ' · © ' + photo.credit : ''))}<br>${esc(dateLabel(photo))}${photo.source_url ? `<br><a href="${esc(sourceURL(photo.source_url))}" target="_blank" rel="noopener noreferrer">View image source</a>` : ''}</p>` : ''}${admin() && photo ? `<div class="photo-admin" data-admin><button data-edit-photo="${esc(photo.id)}">Edit photo and frame</button><button data-cover-photo="${esc(photo.id)}" ${album.coverPhotoId === photo.id ? 'disabled' : ''}>${album.coverPhotoId === photo.id ? 'Current cover' : 'Set as cover'}</button><button data-move-photo="${esc(photo.id)}" data-direction="-1" ${album.photos.indexOf(photo) === 0 ? 'disabled' : ''}>Move earlier</button><button data-move-photo="${esc(photo.id)}" data-direction="1" ${album.photos.indexOf(photo) === album.photos.length - 1 ? 'disabled' : ''}>Move later</button><button data-delete-photo="${esc(photo.id)}">Delete photograph</button></div>` : ''}</div><div class="album-info"><p class="album-category">${esc(categories[album.species] || album.species || 'Uncategorized')}</p><h2>${esc(album.display_name || album.name)}</h2><p class="album-latin">${esc(album.name)}</p>${aliases.length ? `<p class="album-aliases">Also known as · ${esc(aliases.join(' / '))}</p>` : ''}<p class="album-description">${esc(album.summary_zh || album.description || 'No cultivar description yet.').replace(/\n/g, '<br>')}</p><dl class="album-facts"><div><dt>Category</dt><dd>${esc(categories[album.species] || album.species || 'Uncategorized')}</dd></div><div><dt>Color</dt><dd>${esc(colors[album.color] || 'See description')}</dd></div><div><dt>Form</dt><dd>${esc(forms[album.form] || 'See description')}</dd></div><div><dt>Bloom size</dt><dd>${esc(sizes[album.size] || album.size || 'Not specified')}</dd></div></dl>${album.notes ? `<div class="album-notes"><h3>Garden notes</h3><p>${esc(album.notes).replace(/\n/g, '<br>')}</p></div>` : ''}<a class="source-link" href="${esc(sourceURL(album.reference_url))}" target="_blank" rel="noopener noreferrer">View full cultivar record ${icon('external')}</a><div class="album-photo-tabs" role="group" aria-label="Photo source">${[['all', 'All photos']].map(([kind, label]) => `<button data-photo-filter="${kind}" aria-pressed="${albumView.filter === kind}">${label} ${album.photos.filter(item => kind === 'all' || item.kind === kind).length}</button>`).join('')}</div><div class="album-actions">${admin() ? `<button class="primary-button" data-add-to="${esc(album.id)}" data-admin>${icon('plus')}Add photos to this cultivar</button><button data-edit-album="${esc(album.id)}" data-admin>Edit cultivar</button><button data-delete-album="${esc(album.id)}" data-admin>Delete album</button>` : ''}<button class="album-heart" data-favorite="${esc(album.id)}" aria-pressed="${favorite}">${icon('heart')}${favorite ? 'Favorited' : 'Favorite cultivar'}</button></div></div></div>`;
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
    $('#lightbox').innerHTML = `<button class="icon-button lightbox-close" data-close="lightbox" aria-label="Exit fullscreen">${icon('close')}</button>${framedPhoto(photo, photo.frame || album.frame)}<button class="photo-arrow prev" data-photo-step="-1" aria-label="Previous photograph">${icon('chevron')}</button><button class="photo-arrow next" data-photo-step="1" aria-label="Next photograph">${icon('chevron')}</button><p class="lightbox-caption">${esc(album.name)} · ${esc(photo.caption || photo.filename)}<br>${esc(dateLabel(photo))}</p>`;
  }
  function openLightbox() {
    if (!$('#lightbox')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'lightbox'; dialog.className = 'lightbox'; dialog.setAttribute('aria-label', 'Fullscreen photograph');
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
    if (!isManagerPage) return;
    $('#uploadPhotoSection').hidden = !selected;
    $('#batchFrame').hidden = pending.length === 0;
    $('#uploadSubmit').disabled = !selected || pending.length === 0 || reading || !admin() || saving || loading;
    $('#uploadSummary').textContent = selected ? `${selected.display_name || selected.name} · ${pending.length} pending photos${reading ? ' · Reading files' : ''}` : (pending.length ? `${pending.length} pending photos preserved. Choose a cultivar again` : 'Choose a cultivar first');
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
      $('#selectedCultivarCard').innerHTML = `<div class="selected-cultivar-heading"><strong>${esc(selected.display_name || selected.name)}</strong><span>${esc(categories[selected.species] || selected.species || 'Uncategorized')}</span></div><p class="selected-cultivar-name">${esc(selected.name)}</p><p class="selected-cultivar-description">${esc(selected.summary_zh || selected.description || 'No description yet.')}</p><p>All photos in this batch will be added to this cultivar’s album.</p><a class="selected-cultivar-link" href="${esc(sourceURL(selected.reference_url))}" target="_blank" rel="noopener noreferrer">View cultivar record ${icon('external')}</a>`;
    }
    if (pending.length) updateFramePreview('uploadFrame');
    updateUpload();
  }
  async function loadCatalogue(generation) {
    $('#catalogueStatus').textContent = 'Connecting to the cultivar catalogue… Existing albums are available offline.';
    $('#cultivarSearch').setAttribute('aria-busy', 'true');
    try {
      const index = await window.CamelliaCatalog.loadIndex();
      if (generation !== uploadGeneration || !$('#uploadDialog').open) return;
      catalogueReady = true; catalogueCount = index.length;
      $('#catalogueStatus').textContent = `${catalogueCount.toLocaleString()} searchable cultivars · Choose a result`;
      if (!selected) renderMatches();
    } catch (_) {
      if (generation !== uploadGeneration || !$('#uploadDialog').open) return;
      $('#catalogueStatus').textContent = 'Catalogue unavailable. You can still search and choose an existing album.';
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
    $('#cultivarResults').innerHTML = catalogueMatches.length ? catalogueMatches.map((item, index) => `<button type="button" role="option" id="catalog-option-${index}" class="cultivar-option" data-catalog-name="${esc(item.name)}" aria-selected="false" tabindex="-1"><span class="option-name">${esc(item.name)}</span><span class="option-species">${esc(categories[item.species] || item.species || 'Uncategorized')}</span><span class="option-aliases">${esc([item.display_name, ...(item.chinese_name || []), ...(item.japanese_name || [])].filter(Boolean).join(' / '))}${getAlbum(item.id) ? ' · Existing album' : ''}</span></button>`).join('') : '<div class="cultivar-no-results">No cultivar found. Try an English or Chinese name, or an alias.</div>';
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
    $('#catalogueStatus').textContent = `Loading the full cultivar record for ${name}…`;
    try {
      const raw = await window.CamelliaCatalog.getEntry(name);
      if (generation !== uploadGeneration || selection !== selectionGeneration || !$('#uploadDialog').open) return;
      setSelected(window.CamelliaCatalog.toCultivar(raw));
      $('#catalogueStatus').textContent = 'Cultivar selected · Choose multiple photos for this album.';
    } catch (_) {
      if (generation !== uploadGeneration || selection !== selectionGeneration || !$('#uploadDialog').open) return;
      $('#catalogueStatus').textContent = 'Could not load the full record. Choose the cultivar again or use an existing album.';
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
    $('#pendingPhotos').innerHTML = pending.map(photo => `<article class="pending-photo" data-pending-id="${esc(photo.id)}">${framedPhoto(photo, frame)}<div class="pending-photo-details"><strong>${esc(photo.filename || 'Camellia photograph')}</strong><label>Caption<input data-pending-caption="${esc(photo.id)}" value="${esc(photo.caption)}" placeholder="A few words about this photograph…"></label><label>Date and time taken<input class="pending-date" type="datetime-local" data-pending-date="${esc(photo.id)}" value="${esc(photo.takenAt || '')}"></label><p class="pending-date-source">${esc(dateLabel(photo))}</p><button type="button" data-remove-pending="${esc(photo.id)}">Remove photo</button></div></article>`).join('');
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
      $('#importStatus').textContent = `Reading ${i + 1} / ${list.length}: ${list[i].name}`;
      const photo = await io.readFile(list[i]);
      if (photo.src?.startsWith('blob:')) ownedURLs.add(photo.src);
      if (generation !== uploadGeneration || !$('#uploadDialog').open) { revoke(photo.src); break; }
      if (photo.error) failed.push(list[i].name + ': ' + photo.error);
      else pending.push(photo);
      renderPending();
    }
    if (generation !== uploadGeneration) return;
    reading = false;
    $('#photoFiles').disabled = false;
    $('#photoFiles').value = '';
    $('#importStatus').textContent = `${pending.length} photos ready. You can add more to this batch.`;
    $('#uploadError').textContent = failed.length ? `Could not preview: ${failed.join(', ')}. Convert these files to JPEG or PNG and try again. Other photos are preserved.` : '';
    renderPending();
  }
  async function saveUpload(event) {
    event.preventDefault();
    if (!requireAdmin() || reading) return;
    if (!selected || !pending.length) { $('#uploadError').textContent = 'Choose a cultivar and at least one photograph.'; return; }
    if (pending.some(photo => state().albums.some(album => album.photos.some(saved => saved.id === photo.id)))) {
      $('#uploadError').textContent = 'Some photos from this batch are already in the latest garden. Review the album and remove saved previews before continuing to avoid duplicates.';
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
    if (!await confirmAction(`Delete the entire “${album.display_name || album.name}” album and its ${album.photos.length} photos? They will be removed from the public garden and can be recovered through Git history.`)) return;
    if (!requireAdmin()) return;
    const removePaths = album.photos.flatMap(photo => [photo.imagePath, photo.thumbnailPath]).filter(Boolean);
    await saveAction({ type: 'DELETE_ALBUM', id }, { removePaths, message: 'Delete cultivar album' });
  }
  async function deletePhoto(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(albumView.id);
    const photo = album?.photos.find(item => item.id === id);
    if (!photo) return;
    if (!await confirmAction(`Delete “${photo.caption || photo.filename}”? The cultivar album will remain. The photograph can be recovered through Git history.`)) return;
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
    if (isManagerPage && (button.id === 'loginEntry' || button.matches('.reauth-draft'))) { $('#githubToken').value = ''; $('#loginError').textContent = ''; openDialog('loginDialog'); return; }
    if (button.id === 'logoutButton') { logout(); return; }
    if (button.id === 'siteSettings') { openSettings(); return; }
    if (button.id === 'useManualCultivar') {
      if (!requireAdmin()) return;
      const name = $('#cultivarSearch').value.trim();
      if (!name) { $('#catalogueStatus').textContent = 'Enter a cultivar name first.'; return; }
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
  if (isManagerPage) document.addEventListener('click', event => { if (!event.target.closest('.cultivar-picker')) hideMatches(); });
  $('#search').addEventListener('input', renderGallery);
  ['colorFilter', 'formFilter', 'sort'].forEach(id => $('#' + id).addEventListener('change', renderGallery));
  if (isManagerPage) {
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
      loading = true; lockUI(); $('#loginError').textContent = 'Verifying your identity and repository write access…';
      const generation = ++sessionGeneration;
      try {
        const result = await store.login(token);
        token = '';
        if (generation !== sessionGeneration) return;
        model.accept(result.document); model.setAuthenticated(true); recoveryRequired = false;
        const reconciled = reconcilePending(result.document);
        status('Owner verified. Changes will be saved to GitHub.' + reconciled);
        loading = false; lockUI(); closeDialog('loginDialog');
      } catch (error) {
        token = ''; store.logout(); model.setAuthenticated(false);
        $('#loginError').textContent = error.message || 'Verification failed. Please try again.';
      } finally { loading = false; lockUI(); render(); updateUpload(); }
    });
  }
  async function logout() {
    if (!isManagerPage || saving || loading) return;
    if ((pending.length || dirtyDialogs.size) && !await confirmAction('Signing out will discard unsaved edits and photos. Published content will remain.', 'Discard and sign out')) return;
    sessionGeneration++; store.logout(); model.setAuthenticated(false);
    dirtyDialogs.clear(); clearPending();
    $$('dialog[open]').filter(dialog => dialog.id !== 'albumDialog').forEach(dialog => dialog.close());
    render(); status('Signed out. The garden is still available to browse.');
  }
  if (isManagerPage) {
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
      if (target.id === 'editTakenAt') $('#photoDateSource').textContent = target.value ? 'Entered manually · ' + target.value.replace('T', ' ') : 'Date taken unknown · File dates are not used as a substitute';
    });
  }
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
  loadGallery().finally(() => {
    if (isManagerPage && !admin()) openDialog('loginDialog');
  });
})();
