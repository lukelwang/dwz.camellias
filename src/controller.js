/* Production gallery: rendered records change only after GitHub confirms a save. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const chineseAliasText = album => [...new Set((album.chinese_name || []).filter(name => typeof name === 'string').map(name => name.trim()).filter(name => name && name !== (album.display_name || album.name)))].join(' / ');
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s\p{P}]/gu, '');
  const isManagerPage = document.body.dataset.page === 'manager';
  const categories = { Japonica: 'Japonica', Sasanqua: 'Sasanqua', Reticulata: 'Reticulata', NRH: 'Hybrid', Wabisuke: 'Wabisuke', Rusticana: 'Rusticana' };
  const speciesGroup = species => species === 'Hybrid' ? 'NRH' : (['Japonica', 'Sasanqua', 'Reticulata', 'NRH'].includes(species) ? species : 'Other');
  const forms = { formal: 'Formal double', single: 'Single', semi: 'Semi-double', peony: 'Peony', anemone: 'Anemone' };
  const colors = { pink: 'Pink', white: 'White', red: 'Red', bicolor: 'Bicolor', yellow: 'Pale yellow' };
  const sizes = { Medium: 'Medium', Large: 'Large', 'Very large': 'Very large', Miniature: 'Miniature', Small: 'Small', 'Small to medium': 'Small to medium', 'Medium to large': 'Medium to large' };
  const model = window.CamelliaModel.create();
  const io = window.CamelliaPhotoIO;
  const store = window.CamelliaStore.create();
  const ownedURLs = new Set();
  let gallery = { category: 'all' };
  let featuredAlbumId = null;
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
  let editCatalogue = { selected: null, matches: [], active: -1, generation: 0, ready: false };
  let toastTimer;
  let saving = false;
  let loading = false;
  let galleryLoaded = false;
  let galleryLoadError = false;
  let sessionGeneration = 0;
  let recoveryRequired = false;
  const dirtyDialogs = new Set();
  const dialogOpeners = new Map();
  const editorBaselines = new Map();
  const editorFields = {
    albumEditDialog: { editDisplayName: 'display_name', editCanonicalName: 'name', editSpecies: 'species', editSize: 'size', editColor: 'color', editForm: 'form', editDescription: 'description', editNotes: 'notes', editRegisteredYear: 'registeredYear' },
    photoEditDialog: { editCaption: 'caption', editTakenAt: 'takenAt' },
    settingsDialog: { settingBrand: 'brand', settingTitle1: 'titleLine1', settingTitle2: 'titleLine2', settingDescription: 'description', settingCount: 'gardenCount', settingCultivarRecordLinks: 'showCultivarRecordLinks', settingWatermarkText: 'watermarkText' }
  };
  const state = () => model.getState();
  const watermarkText = () => state().settings.watermarkText?.trim() || '© ' + state().settings.brand;
  const watermarkMarkup = () => `<span class="photo-watermark" aria-hidden="true">${esc(watermarkText())}</span>`;
  const editableTarget = target => !!(target?.closest?.('input,textarea,select') || target?.isContentEditable);
  const admin = () => isManagerPage && state().role === 'admin' && store.isAuthenticated();
  const getAlbum = id => state().albums.find(item => item.id === id);
  const canonicalKey = value => String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  const existingAlbum = cultivar => (cultivar?.id && getAlbum(cultivar.id)) || state().albums.find(album => canonicalKey(album.name) === canonicalKey(cultivar?.name));
  const cover = album => album.photos.find(photo => photo.id === album.coverPhotoId) || album.photos[0];
  const photosFor = album => album.photos.filter(photo => albumView.filter === 'all' || photo.kind === albumView.filter);
  const flowerForms = value => window.CamelliaModel.flowerForms(value);
  const formLabel = value => flowerForms(value).map(form => forms[form] || form).join(' / ');
  const dateLabel = photo => io.dateLabel(photo);
  const displayDate = photo => photo?.takenAt ? photo.takenAt.replace('T', ' ') : '';
  const addedDateFormat = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric' });
  const addedDateLabel = album => { const time = window.CamelliaModel.addedTime(album); return time === null ? 'Unknown' : addedDateFormat.format(time); };
  const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const sourceURL = value => /^https?:\/\//i.test(value || '') ? value : 'https://camellia-nomenclature.github.io/';
  const imageURL = value => {
    const photo = /^https:\/\/raw\.githubusercontent\.com\/lukelwang\/dwz\.camellias\.photo\/main\/(photos\/[A-Za-z0-9_-]+\/(?:image|thumbnail)\.jpg)$/.exec(value || '');
    if (photo && typeof store.displayURL === 'function') return store.displayURL(photo[1]);
    return /^(data:image\/|blob:|https?:\/\/)/i.test(value || '') ? value : document.querySelector('link[rel="icon"]').href;
  };

  function focusRoot(element = document.activeElement) {
    return element?.closest('dialog,#gallery') || document.body;
  }
  function topDialog() {
    return [...dialogOpeners.keys()].map(id => $('#' + id)).filter(dialog => dialog?.open).at(-1);
  }
  function rememberFocus(root) {
    const element = document.activeElement;
    if (!element || !root.contains(element) || element === document.body) return null;
    const controls = [...root.querySelectorAll('button,a,input,select,textarea')];
    return { element, id: element.id, attributes: [...element.attributes].filter(attribute => attribute.name.startsWith('data-') && !['data-admin','data-lock-disabled'].includes(attribute.name)).map(attribute => [attribute.name, attribute.value]), index: controls.indexOf(element) };
  }
  function restoreFocus(focus, root, fallback) {
    if (!focus || saving || loading) return;
    const top = topDialog();
    if (top && top !== root && !top.contains(root)) return;
    const controls = [...root.querySelectorAll('button,a,input,select,textarea')].filter(element => !element.disabled && !element.closest('[hidden]'));
    let target = focus.element.isConnected && root.contains(focus.element) && !focus.element.disabled ? focus.element : null;
    if (!target && focus.id) target = controls.find(element => element.id === focus.id);
    if (!target && focus.attributes.length) target = controls.find(element => focus.attributes.every(([name, value]) => element.getAttribute(name) === value));
    target ||= controls[Math.min(Math.max(focus.index, 0), controls.length - 1)] || fallback;
    if (target && !target.disabled && !target.closest('[hidden]') && (!top || top.contains(target)) && target !== document.activeElement) target.focus({ preventScroll: true });
  }

  const checkedForms = field => [...field.querySelectorAll('input:checked')].map(input => input.value);
  const editorValue = input => input.hasAttribute('data-multi-field') ? checkedForms(input) : (input.type === 'checkbox' ? input.checked : input.value);
  const sameEditorValue = (a, b) => Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every(value => b.includes(value)) : a === b;
  function setEditorValue(input, value) {
    if (input.hasAttribute('data-multi-field')) input.querySelectorAll('input').forEach(option => { option.checked = value.includes(option.value); });
    else if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  function refreshEditor(id, preserveDraft = false) {
    const fields = editorFields[id];
    let record;
    if (id === 'albumEditDialog') {
      const album = getAlbum($('#editingAlbumId').value);
      if (album) record = { ...album, display_name: album.display_name || album.name, description: album.summary_zh || album.description || '' };
    } else if (id === 'photoEditDialog') record = getAlbum($('#editingPhotoAlbumId').value)?.photos.find(photo => photo.id === $('#editingPhotoId').value);
    else record = state().settings;
    if (!record) return;
    const previous = editorBaselines.get(id);
    const baseline = {};
    Object.entries(fields).forEach(([inputId, field]) => {
      const input = $('#' + inputId);
      const latest = input.hasAttribute('data-multi-field') ? flowerForms(record[field]) : (input.type === 'checkbox' ? record[field] !== false : String(record[field] ?? ''));
      const changed = preserveDraft && previous && !sameEditorValue(editorValue(input), previous[inputId]);
      if (!changed) setEditorValue(input, latest);
      baseline[inputId] = changed ? latest : editorValue(input);
    });
    editorBaselines.set(id, baseline);
    updateEditorDirty(id);
    if (id === 'photoEditDialog') {
      $('#photoPreview').innerHTML = photoMarkup(record);
      $('#photoDateSource').textContent = $('#editTakenAt').value === record.takenAt ? dateLabel(record) : ($('#editTakenAt').value ? 'Entered manually · ' + $('#editTakenAt').value.replace('T', ' ') : 'Capture date unknown');
    }
  }
  function updateEditorDirty(id) {
    const baseline = editorBaselines.get(id);
    if (!baseline) return;
    if ((id === 'albumEditDialog' && editCatalogue.selected) || Object.keys(editorFields[id]).some(inputId => !sameEditorValue(editorValue($('#' + inputId)), baseline[inputId]))) dirtyDialogs.add(id);
    else dirtyDialogs.delete(id);
  }
  function refreshOpenEditors() {
    Object.keys(editorFields).forEach(id => { if ($('#' + id)?.open) refreshEditor(id, true); });
  }
  function editorPatch(id) {
    const baseline = editorBaselines.get(id);
    return Object.fromEntries(Object.entries(editorFields[id]).filter(([inputId]) => !sameEditorValue(editorValue($('#' + inputId)), baseline?.[inputId])).map(([inputId, field]) => [field, editorValue($('#' + inputId))]));
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
  }
  function status(message, retry = false, error = false) {
    $('#storeMessage').textContent = message;
    $('#storeStatus').hidden = !message;
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
    const root = focusRoot();
    const focus = rememberFocus(root);
    saving = true; lockUI();
    status('Saving to GitHub. Keep this page open…');
    if (errorTarget) $(errorTarget).textContent = '';
    try {
      const result = await store.save(proposal.document, { ...options, onProgress: message => status(message) });
      if (generation !== sessionGeneration) return null;
      model.accept(result.document);
      refreshOpenEditors();
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
    } finally { saving = false; lockUI(); render(); updateUpload(); restoreFocus(focus, root, $('#emptyReset')); }
  }
  async function loadGallery() {
    if (saving || loading) return;
    const generation = sessionGeneration;
    const root = focusRoot();
    const focus = rememberFocus(root);
    loading = true; galleryLoadError = false; status('Loading the latest garden…'); renderGallery(); lockUI();
    try {
      const document = await store.loadPublic();
      if (generation !== sessionGeneration) return;
      model.accept(document); recoveryRequired = false; galleryLoaded = true; galleryLoadError = false;
      refreshOpenEditors();
      if (isManagerPage && selected) setSelected(existingAlbum(selected) || selected);
      const reconciled = reconcilePending(document);
      status((reconciled + (dirtyDialogs.size || pending.length ? ' Your edits and pending photos are preserved. Untouched fields now show the latest content. Review your draft before saving.' : '')).trim());
    } catch (error) { galleryLoadError = true; status(error.message || 'Could not load the garden. Please try again.', true, true); }
    finally { loading = false; lockUI(); render(); updateUpload(); restoreFocus(focus, root, $('#emptyReset')); }
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
    if (dialog && !dialog.open) {
      const root = focusRoot();
      dialogOpeners.set(id, { root, focus: rememberFocus(root) });
      dialog.showModal();
    }
  }
  function closeDialog(id) { if (!saving && !loading) $('#' + id)?.close(); }
  function confirmAction(message, label = 'Confirm deletion') {
    if (saving || loading || $('#confirmDialog').open) return Promise.resolve(false);
    $('#confirmMessage').textContent = message;
    $('#confirmAccept').textContent = label;
    openDialog('confirmDialog');
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
    gallery = { category: 'all' };
    $('#search').value = '';
    $('#colorFilter').value = 'all';
    $('#formFilter').querySelectorAll('input').forEach(input => { input.checked = false; });
    $('#sort').value = 'curated';
    $('#moreFilters').hidden = true;
    $('.filter-toggle').setAttribute('aria-expanded', 'false');
    renderGallery();
  }
  function photoMarkup(photo, alt = photo?.caption || photo?.filename || 'Camellia photograph') {
    return `<div class="photo-image"><img src="${esc(imageURL(photo?.src))}" alt="${esc(alt)}" loading="lazy" decoding="async" draggable="false">${photo?.src ? watermarkMarkup() : ''}</div>`;
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
    $$('.photo-watermark').forEach(element => { element.textContent = watermarkText(); });
    document.title = `${s.brand} · Camellia Garden`;
  }
  function renderHero() {
    const eligible = state().albums.filter(album => cover(album));
    const featured = eligible.find(album => album.id === featuredAlbumId) || eligible[0];
    featuredAlbumId = featured?.id || null;
    const hero = $('.hero-art');
    hero.classList.toggle('hero-empty', !featured);
    hero.disabled = eligible.length < 2;
    hero.querySelector('.round-arrow').hidden = eligible.length < 2;
    delete hero.dataset.open;
    let image = hero.querySelector('img');
    if (!featured) {
      image?.remove(); hero.querySelector('.photo-watermark')?.remove();
      hero.setAttribute('aria-label', 'A garden waiting for its first bloom');
      hero.title = 'A garden waiting for its first bloom';
      hero.querySelector('.hero-art-bottom strong').textContent = 'Waiting for the first bloom';
      hero.querySelector('.hero-chinese-alias').textContent = '';
      hero.querySelector('.hero-chinese-alias').hidden = true;
      hero.querySelector('.hero-art-bottom em').textContent = 'A garden growing with time';
      hero.querySelector('.hero-art-top > span').textContent = 'It begins with a bloom';
      hero.querySelector('.hero-ref').textContent = '';
      return;
    }
    const photo = cover(featured);
    if (!image) { image = document.createElement('img'); image.fetchPriority = 'high'; hero.prepend(image); }
    const actionLabel = eligible.length > 1 ? `Show another featured cultivar · Currently ${featured.display_name || featured.name}` : `Featured cultivar · ${featured.display_name || featured.name}`;
    hero.setAttribute('aria-label', actionLabel);
    hero.title = actionLabel;
    image.src = imageURL(photo.src); image.alt = featured.name + ' · Garden photography';
    image.draggable = false;
    hero.querySelector('.photo-watermark')?.remove();
    if (photo.src) image.insertAdjacentHTML('afterend', watermarkMarkup());
    hero.querySelector('.hero-art-bottom strong').textContent = featured.display_name || featured.name;
    const chineseAlias = hero.querySelector('.hero-chinese-alias');
    chineseAlias.textContent = chineseAliasText(featured);
    chineseAlias.hidden = !chineseAlias.textContent;
    hero.querySelector('.hero-art-bottom em').textContent = [categories[featured.species] || featured.species || 'Uncategorized', formLabel(featured.form) || 'Cultivar guide'].join(' · ');
    hero.querySelector('.hero-art-top > span').textContent = `${String(eligible.indexOf(featured) + 1).padStart(2, '0')} / ${String(eligible.length).padStart(2, '0')}`;
    hero.querySelector('.hero-ref').textContent = 'Garden photography';
  }
  function shuffleHero() {
    const alternatives = state().albums.filter(album => cover(album) && album.id !== featuredAlbumId);
    if (!alternatives.length) return;
    featuredAlbumId = alternatives[Math.floor(Math.random() * alternatives.length)].id;
    renderHero();
  }
  function renderGallery() {
    const root = $('#gallery');
    const focus = rememberFocus(root);
    const s = state();
    const hasOtherSpecies = s.albums.some(album => speciesGroup(album.species) === 'Other');
    $('#otherSpecies').hidden = !hasOtherSpecies;
    if (!hasOtherSpecies && gallery.category === 'Other') gallery.category = 'all';
    const query = norm($('#search').value);
    const color = $('#colorFilter').value;
    const selectedForms = checkedForms($('#formFilter'));
    const filtered = s.albums.filter(album => {
      const words = [album.name, album.display_name, ...(album.chinese_name || []), ...(album.japanese_name || []), album.description, album.summary_zh, album.notes, album.species];
      return (!query || words.some(word => norm(word).includes(query))) && (gallery.category === 'all' || speciesGroup(album.species) === gallery.category) && (color === 'all' || album.color === color) && (!selectedForms.length || flowerForms(album.form).some(form => selectedForms.includes(form)));
    });
    const results = window.CamelliaModel.orderAlbums(filtered, { sort: $('#sort').value });
    const cardMarkup = album => {
      const photo = cover(album);
      const ownCount = album.photos.filter(item => item.kind === 'personal').length;
      const tags = [categories[album.species] || album.species || 'Uncategorized', colors[album.color], formLabel(album.form) || sizes[album.size] || album.size].filter(Boolean);
      const year = window.CamelliaModel.registrationYear(album.registeredYear);
      const orderNote = $('#sort').value === 'newly-added' ? (window.CamelliaModel.addedTime(album) === null ? 'Addition date unknown' : 'Added ' + addedDateLabel(album)) : ($('#sort').value === 'registered-year' ? (year === null ? 'Registration year unknown' : 'Registered ' + year) : '');
      return `<article class="cultivar-card" data-id="${esc(album.id)}"><button class="card-open" data-open="${esc(album.id)}" aria-label="Open ${esc(album.name)} album"><div class="card-image">${photoMarkup(photo ? { ...photo, src: photo.thumbnailSrc || photo.src } : null)}<span class="card-number">${String(s.albums.indexOf(album) + 1).padStart(2, '0')}</span>${ownCount ? '<span class="personal-tag">Garden photos</span>' : ''}<span class="card-count">${icon('camera')}${countLabel(album.photos.length, 'photo')}</span></div><div class="card-body"><h3 class="card-name">${esc(album.display_name || album.name)}</h3>${chineseAliasText(album) ? `<p class="cultivar-alias card-chinese-alias" lang="zh-Hans">${esc(chineseAliasText(album))}</p>` : ''}${album.display_name && album.display_name !== album.name ? `<p class="card-latin">${esc(album.name)}</p>` : ''}${orderNote ? `<p class="card-order-note">${esc(orderNote)}</p>` : ''}<div class="card-tags">${tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div></div></button>${admin() ? `<div class="card-admin" data-admin><button data-edit-album="${esc(album.id)}">Edit cultivar</button><button data-delete-album="${esc(album.id)}">Delete album</button></div>` : ''}</article>`;
    };
    root.innerHTML = results.map(cardMarkup).join('');
    $('#emptyState').hidden = results.length > 0;
    $('#headingCount').textContent = s.albums.length;
    const own = results.reduce((sum, album) => sum + album.photos.filter(photo => photo.kind === 'personal').length, 0);
    $('#resultSummary').textContent = !galleryLoaded ? (galleryLoadError ? 'The garden could not be loaded.' : 'Loading the garden…') : `${countLabel(results.length, 'cultivar')} · ${countLabel(own, 'photo')}`;
    let title = 'No cultivars match this view.';
    let message = 'Try another name or clear your filters to see the whole collection.';
    if (!galleryLoaded) {
      title = galleryLoadError ? 'The garden is temporarily unavailable.' : 'Opening the garden…';
      message = galleryLoadError ? 'Check your connection, then try loading the collection again.' : 'The latest cultivars and photographs will appear here shortly.';
    } else if (!s.albums.length) {
      title = 'A garden begins with a bloom.';
      message = 'Real blooms from the garden will grow into a camellia collection here.';
    }
    $('#emptyState h3').textContent = title;
    $('#emptyState p').textContent = message;
    $('#emptyReset').hidden = !galleryLoaded || !s.albums.length;
    $('#emptyReload').hidden = galleryLoaded || !galleryLoadError;
    $('#filterBadge').hidden = color === 'all' && !selectedForms.length;
    $('#filterBadge').textContent = String((color !== 'all' ? 1 : 0) + (selectedForms.length ? 1 : 0));
    $$('[data-category]').forEach(button => {
      const active = button.dataset.category === gallery.category;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', active);
    });
    restoreFocus(focus, root, $('#emptyReset').hidden ? $('#search') : $('#emptyReset'));
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
    const root = $('#albumContent');
    const focus = rememberFocus(root);
    const album = getAlbum(albumView.id);
    if (!album) { closeDialog('albumDialog'); return; }
    const photos = photosFor(album);
    const photo = photos.find(item => item.id === albumView.photoId) || photos[0];
    albumView.photoId = photo?.id || null;
    const index = photos.indexOf(photo);
    const chineseAlias = chineseAliasText(album);
    const aliases = [...new Set(album.japanese_name || [])].filter(name => !(album.chinese_name || []).includes(name) && name !== album.name && name !== album.display_name);
    $('#albumContent').innerHTML = `<div class="album-toolbar"><span>Cultivar album</span><button class="icon-button album-close" data-close="albumDialog" aria-label="Close cultivar album">${icon('close')}</button></div><div class="album-layout"><div class="album-media"><div id="albumStage" class="album-stage">${photo ? `<button class="photo-zoom" data-zoom aria-label="View photograph fullscreen">${photoMarkup(photo)}</button>${photos.length > 1 ? `<button class="photo-arrow prev" data-photo-step="-1" aria-label="Previous photograph">${icon('chevron')}</button><button class="photo-arrow next" data-photo-step="1" aria-label="Next photograph">${icon('chevron')}</button>` : ''}<span class="photo-position">${index + 1} / ${photos.length}</span>` : '<div class="album-empty"><p>No photographs yet.</p><p>Add a photograph to remember this cultivar’s first bloom.</p></div>'}</div><div class="album-photo-heading"><span>${countLabel(photos.length, 'photo')}</span>${admin() && photo ? `<button class="secondary-button cover-choice" data-admin data-cover-photo="${esc(photo.id)}" ${album.coverPhotoId === photo.id ? 'disabled' : ''}>${album.coverPhotoId === photo.id ? 'Current cover' : 'Set as cover'}</button>` : ''}</div><div id="albumThumbnails" class="photo-thumbnails">${photos.map(item => `<button data-photo-id="${esc(item.id)}" class="${item.id === photo?.id ? 'active' : ''}" aria-label="${admin() && album.coverPhotoId === item.id ? 'Current cover · ' : ''}View ${esc(item.caption || item.filename || 'photograph')}" aria-pressed="${item.id === photo?.id}">${photoMarkup({ ...item, src: item.thumbnailSrc || item.src }, '')}${admin() && album.coverPhotoId === item.id ? '<span class="cover-badge">Cover</span>' : ''}</button>`).join('')}</div>${photo ? `<p class="photo-caption">${esc(photo.caption || '')}</p><p id="photoCredit" class="photo-credit">${esc(photo.kind === 'personal' ? 'Garden photograph' : 'Reference photograph' + (photo.credit ? ' · © ' + photo.credit : ''))}${displayDate(photo) ? `<br>${esc(displayDate(photo))}` : ''}${photo.source_url ? `<br><a href="${esc(sourceURL(photo.source_url))}" target="_blank" rel="noopener noreferrer">View image source</a>` : ''}</p>` : ''}${admin() && photo ? `<div class="photo-admin" data-admin><button data-edit-photo="${esc(photo.id)}">Edit photo</button><button data-move-photo="${esc(photo.id)}" data-direction="-1" ${album.photos.indexOf(photo) === 0 ? 'disabled' : ''}>Move earlier</button><button data-move-photo="${esc(photo.id)}" data-direction="1" ${album.photos.indexOf(photo) === album.photos.length - 1 ? 'disabled' : ''}>Move later</button><button data-delete-photo="${esc(photo.id)}">Delete photograph</button></div>` : ''}</div><div class="album-info"><p class="album-category">${esc(categories[album.species] || album.species || 'Uncategorized')}</p><h2>${esc(album.display_name || album.name)}</h2>${chineseAlias ? `<p class="cultivar-alias album-chinese-alias" lang="zh-Hans">${esc(chineseAlias)}</p>` : ''}${album.display_name && album.display_name !== album.name ? `<p class="album-latin">${esc(album.name)}</p>` : ''}${aliases.length ? `<p class="album-aliases">Also known as · ${esc(aliases.join(' / '))}</p>` : ''}<p class="album-description">${esc(album.summary_zh || album.description || 'No cultivar description yet.').replace(/\n/g, '<br>')}</p><dl class="album-facts"><div><dt>Category</dt><dd>${esc(categories[album.species] || album.species || 'Uncategorized')}</dd></div><div><dt>Color</dt><dd>${esc(colors[album.color] || 'See description')}</dd></div><div><dt>Form</dt><dd>${esc(formLabel(album.form) || 'See description')}</dd></div><div><dt>Bloom size</dt><dd>${esc(sizes[album.size] || album.size || 'Not specified')}</dd></div><div><dt>Registered year</dt><dd>${window.CamelliaModel.registrationYear(album.registeredYear) ?? 'Unknown'}</dd></div><div><dt>Added to gallery</dt><dd>${esc(addedDateLabel(album))}</dd></div></dl>${album.notes ? `<div class="album-notes"><h3>Garden notes</h3><p>${esc(album.notes).replace(/\n/g, '<br>')}</p></div>` : ''}${state().settings.showCultivarRecordLinks ? `<a class="source-link" href="${esc(sourceURL(album.reference_url))}" target="_blank" rel="noopener noreferrer">View full cultivar record ${icon('external')}</a>` : ''}<div class="album-photo-tabs" role="group" aria-label="Photo source">${[['all', 'All photos']].map(([kind, label]) => `<button data-photo-filter="${kind}" aria-pressed="${albumView.filter === kind}">${label} ${album.photos.filter(item => kind === 'all' || item.kind === kind).length}</button>`).join('')}</div>${admin() ? `<div class="album-actions"><button class="primary-button" data-add-to="${esc(album.id)}" data-admin>${icon('plus')}Add photos to this cultivar</button><button data-edit-album="${esc(album.id)}" data-admin>Edit cultivar</button><button data-delete-album="${esc(album.id)}" data-admin>Delete album</button></div>` : ''}</div></div>`;
    if ($('#lightbox')?.open) renderLightbox();
    restoreFocus(focus, root, $('#albumDialog .album-close'));
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
  function positionLightboxWatermark() {
    const frame = $('#lightbox > .photo-image');
    const image = frame?.querySelector('img');
    const mark = frame?.querySelector('.photo-watermark');
    if (!image?.naturalWidth || !mark) return;
    const bounds = frame.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    // Anchor to the painted photograph rather than its object-fit letterboxing.
    const scale = Math.min(imageBox.width / image.naturalWidth, imageBox.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const right = imageBox.left + (imageBox.width + width) / 2;
    const bottom = imageBox.top + (imageBox.height + height) / 2;
    mark.style.right = Math.max(12, bounds.right - right + 12) + 'px';
    mark.style.bottom = Math.max(12, bounds.bottom - bottom + 12) + 'px';
    mark.style.maxWidth = Math.max(0, width - 24) + 'px';
    mark.style.fontSize = Math.min(12, Math.min(width, height) * .024) + 'px';
    mark.style.visibility = 'visible';
  }
  function renderLightbox() {
    const root = $('#lightbox');
    const focus = rememberFocus(root);
    const album = getAlbum(albumView.id);
    const photo = album?.photos.find(item => item.id === albumView.photoId);
    if (!photo) { closeDialog('lightbox'); return; }
    $('#lightbox').innerHTML = `<button class="icon-button lightbox-close" data-close="lightbox" aria-label="Exit fullscreen">${icon('close')}</button>${photoMarkup(photo)}<button class="photo-arrow prev" data-photo-step="-1" aria-label="Previous photograph">${icon('chevron')}</button><button class="photo-arrow next" data-photo-step="1" aria-label="Next photograph">${icon('chevron')}</button><p class="lightbox-caption">${esc([album.name, photo.caption].filter(Boolean).join(' · '))}${displayDate(photo) ? `<br>${esc(displayDate(photo))}` : ''}</p>`;
    const image = root.querySelector('.photo-image img');
    image.addEventListener('load', positionLightboxWatermark, { once: true });
    if (image.complete) positionLightboxWatermark();
    restoreFocus(focus, root, $('#lightbox .lightbox-close'));
  }
  function openLightbox() {
    if (!$('#lightbox')) {
      const dialog = document.createElement('dialog');
      dialog.id = 'lightbox'; dialog.className = 'lightbox'; dialog.setAttribute('aria-label', 'Fullscreen photograph');
      document.body.append(dialog); wireDialog(dialog);
    }
    renderLightbox(); openDialog('lightbox'); positionLightboxWatermark();
  }

  function openUpload(id) {
    if (!requireAdmin()) return;
    if ($('#uploadDialog').open) return;
    clearPending();
    $('#uploadForm').reset();
    $('#uploadError').textContent = '';
    $('#importStatus').textContent = '';
    $('#pendingPhotos').innerHTML = '';
    setSelected(id ? getAlbum(id) : null);
    openDialog('uploadDialog');
    revealPhotoPicker();
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
    $('#uploadSubmit').disabled = !selected || pending.length === 0 || reading || !admin() || saving || loading;
    const existing = selected && existingAlbum(selected);
    $('#uploadSubmit').textContent = existing ? 'Add photos to this album →' : 'Save to the garden →';
    $('#uploadSummary').textContent = selected ? `${selected.display_name || selected.name} · ${existing ? existing.photos.length + ' saved · ' : ''}${pending.length} new photos${reading ? ' · Reading files' : ''}` : (pending.length ? `${pending.length} pending photos preserved. Choose a cultivar again` : 'Choose a cultivar first');
    $('#stepCultivar').classList.toggle('active', !selected);
    $('#stepPhotos').classList.toggle('active', !!selected && !pending.length);
    $('#stepReview').classList.toggle('active', pending.length > 0);
  }
  function revealPhotoPicker() {
    if (!selected || !$('#uploadDialog').open || !window.matchMedia('(max-width: 580px)').matches) return;
    $('#cultivarSearch').blur();
    requestAnimationFrame(() => {
      if (selected && $('#uploadDialog').open) $('.mobile-photo-picker').scrollIntoView({ block: 'center' });
    });
  }
  function setSelected(cultivar) {
    selected = cultivar ? existingAlbum(cultivar) || cultivar : null;
    hideMatches();
    $('#clearCultivar').hidden = !selected && !$('#cultivarSearch').value;
    $('#selectedCultivarCard').hidden = !selected;
    $('#useManualCultivar').hidden = !!selected;
    if (selected) {
      $('#cultivarSearch').value = selected.name;
      $('#selectedCultivarCard').innerHTML = `<div class="selected-cultivar-heading"><strong>${esc(selected.display_name || selected.name)}</strong><span>${esc(categories[selected.species] || selected.species || 'Uncategorized')}</span></div>${chineseAliasText(selected) ? `<p class="cultivar-alias selected-chinese-alias" lang="zh-Hans">${esc(chineseAliasText(selected))}</p>` : ''}${selected.display_name && selected.display_name !== selected.name ? `<p class="selected-cultivar-name">${esc(selected.name)}</p>` : ''}<details class="selected-cultivar-details"><summary>Cultivar details</summary><p class="selected-cultivar-description">${esc(selected.summary_zh || selected.description || 'No description yet.')}</p><a class="selected-cultivar-link" href="${esc(sourceURL(selected.reference_url))}" target="_blank" rel="noopener noreferrer">View cultivar record ${icon('external')}</a></details>${existingAlbum(selected) ? `<p class="existing-album-note">${existingAlbum(selected).photos.length} photos already saved. New photos will be added to this album.</p>` : '<p>A new album will be created for this cultivar.</p>'}`;
    }
    updateUpload();
    revealPhotoPicker();
  }
  async function loadCatalogue(generation) {
    if (!selected) $('#catalogueStatus').textContent = 'Connecting to the cultivar catalogue… Your saved cultivars are ready to add more photos.';
    $('#cultivarSearch').setAttribute('aria-busy', 'true');
    try {
      const index = await window.CamelliaCatalog.loadIndex();
      if (generation !== uploadGeneration || !$('#uploadDialog').open) return;
      catalogueReady = true; catalogueCount = index.length;
      if (!selected) { $('#catalogueStatus').textContent = `${catalogueCount.toLocaleString()} searchable cultivars · Choose a result`; renderMatches(); }
    } catch (_) {
      if (generation !== uploadGeneration || !$('#uploadDialog').open) return;
      if (!selected) { $('#catalogueStatus').textContent = 'Catalogue unavailable. Search a saved cultivar to add more photos.'; renderMatches(); }
    } finally {
      if (generation === uploadGeneration) $('#cultivarSearch').setAttribute('aria-busy', 'false');
    }
  }
  function renderMatches() {
    if (selected) { hideMatches(); return; }
    const query = norm($('#cultivarSearch').value);
    const local = state().albums.filter(album => !query || [album.name, album.display_name, ...(album.chinese_name || []), ...(album.japanese_name || [])].some(name => norm(name).includes(query)));
    const live = catalogueReady && query ? window.CamelliaCatalog.search($('#cultivarSearch').value, { limit: 30 }).results : [];
    const seen = new Set();
    catalogueMatches = [...local, ...live.map(item => existingAlbum(item) || item)].filter(item => {
      const key = canonicalKey(item.name);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 35);
    catalogueActive = -1;
    $('#cultivarResults').innerHTML = catalogueMatches.length ? catalogueMatches.map((item, index) => {
      const existing = existingAlbum(item);
      const aliases = [...new Set([item.display_name, ...(item.chinese_name || []), ...(item.japanese_name || [])])].filter(name => name && name !== item.name).join(' / ');
      return `<button type="button" role="option" id="catalog-option-${index}" class="cultivar-option${existing ? ' existing-cultivar' : ''}" data-catalog-name="${esc(item.name)}" aria-selected="false" tabindex="-1"><span class="option-name">${esc(item.name)}</span><span class="option-species">${esc(categories[item.species] || item.species || 'Uncategorized')}</span>${aliases ? `<span class="option-aliases">${esc(aliases)}</span>` : ''}${existing ? `<span class="option-existing">In your garden · ${existing.photos.length} photos · Add photos</span>` : ''}</button>`;
    }).join('') : '<div class="cultivar-no-results">No cultivar found. Try an English or Chinese name, or an alias.</div>';
    $('#cultivarResults').hidden = false;
    $('#cultivarSearch').setAttribute('aria-expanded', 'true');
    $('#cultivarSearch').removeAttribute('aria-activedescendant');
  }
  async function chooseCultivar(name) {
    if (!requireAdmin()) return;
    const local = existingAlbum({ name });
    if (local) { selectionGeneration++; setSelected(local); $('#catalogueStatus').textContent = 'Existing album selected. Choose photos to add to it.'; return; }
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
  function pendingMarkup(photo) {
    return `<article class="pending-photo" data-pending-id="${esc(photo.id)}">${photoMarkup(photo)}<div class="pending-photo-details"><strong>${esc(photo.filename || 'Camellia photograph')}</strong><label>Caption<input data-pending-caption="${esc(photo.id)}" value="${esc(photo.caption)}" placeholder="A few words about this photograph…"></label><label>Date and time taken<input class="pending-date" type="datetime-local" data-pending-date="${esc(photo.id)}" value="${esc(photo.takenAt || '')}"></label><p class="pending-date-source">${esc(dateLabel(photo))}</p><button type="button" data-remove-pending="${esc(photo.id)}">Remove photo</button></div></article>`;
  }
  function renderPending() {
    const root = $('#pendingPhotos');
    const focus = rememberFocus(root);
    const ids = new Set(pending.map(photo => photo.id));
    [...root.children].forEach(row => { if (!ids.has(row.dataset.pendingId)) row.remove(); });
    const rendered = new Set([...root.children].map(row => row.dataset.pendingId));
    pending.forEach(photo => { if (!rendered.has(photo.id)) root.insertAdjacentHTML('beforeend', pendingMarkup(photo)); });
    updateUpload();
    restoreFocus(focus, root, $('#photoFiles'));
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
    $('#importStatus').textContent = `${countLabel(pending.length, 'photo')} ready. You can add more to this batch.`;
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
    const files = [];
    const photos = pending.map(photo => {
      const imagePath = `photos/${photo.id}/image.jpg`;
      const thumbnailPath = `photos/${photo.id}/thumbnail.jpg`;
      files.push({ path: imagePath, blob: photo.imageBlob }, { path: thumbnailPath, blob: photo.thumbnailBlob });
      const fields = ['id','filename','caption','takenAt','dateSource','dateOffset','width','height','size','mime'];
      const metadata = Object.fromEntries(fields.filter(key => photo[key] !== undefined).map(key => [key, photo[key]]));
      return { ...metadata, kind: 'personal', imagePath, thumbnailPath, src: store.photoURL(imagePath), thumbnailSrc: store.photoURL(thumbnailPath) };
    });
    const next = await saveAction({ type: 'ADD_PHOTOS', cultivar: target, photos }, { files, message: `Add ${photos.length} photographs` }, '#uploadError');
    if (!next) return;
    const album = next.albums.find(item => item.id === target.id || item.name === target.name);
    dirtyDialogs.delete('uploadDialog'); closeDialog('uploadDialog');
    if (album && !($('#albumEditDialog').open && $('#editingAlbumId').value === album.id)) openAlbum(album.id, photos[0]?.id);
  }

  function openAlbumEdit(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(id);
    if (!album) return;
    $('#editingAlbumId').value = id;
    $('#editAlbumAddPhotos').dataset.addTo = id;
    $('#editAlbumReload').dataset.reloadCultivar = id;
    resetEditCatalogue();
    refreshEditor('albumEditDialog');
    $('#albumEditError').textContent = '';
    openDialog('albumEditDialog');
  }
  function hideEditMatches() {
    $('#editCultivarResults').hidden = true;
    $('#editCultivarSearch').setAttribute('aria-expanded', 'false');
    $('#editCultivarSearch').removeAttribute('aria-activedescendant');
    editCatalogue.active = -1;
  }
  function resetEditCatalogue() {
    editCatalogue = { selected: null, matches: [], active: -1, generation: editCatalogue.generation + 1, ready: false };
    $('#editCultivarPicker').open = false;
    $('#editCultivarSearch').value = '';
    $('#editCultivarStatus').textContent = '';
    $('#editCultivarSearch').setAttribute('aria-busy', 'false');
    $('#editAlbumReload').disabled = false;
    hideEditMatches();
  }
  async function loadEditCatalogue() {
    const generation = ++editCatalogue.generation;
    editCatalogue.ready = false;
    editCatalogue.matches = [];
    hideEditMatches();
    $('#editCultivarStatus').textContent = 'Connecting to the cultivar catalogue…';
    $('#editCultivarSearch').setAttribute('aria-busy', 'true');
    try {
      await window.CamelliaCatalog.loadIndex({ refresh: true });
      if (generation !== editCatalogue.generation || !$('#albumEditDialog').open) return;
      editCatalogue.ready = true;
      $('#editCultivarStatus').textContent = 'Search English or Chinese names and aliases. Your photos stay in this album.';
      renderEditMatches();
    } catch (error) {
      if (generation === editCatalogue.generation) $('#editCultivarStatus').textContent = error.message || 'Could not load the catalogue. Close and reopen this search to retry.';
    } finally {
      if (generation === editCatalogue.generation) $('#editCultivarSearch').setAttribute('aria-busy', 'false');
    }
  }
  function renderEditMatches() {
    if (!editCatalogue.ready || !$('#editCultivarSearch').value.trim()) { hideEditMatches(); return; }
    editCatalogue.matches = window.CamelliaCatalog.search($('#editCultivarSearch').value, { limit: 30 }).results;
    editCatalogue.active = -1;
    $('#editCultivarResults').innerHTML = editCatalogue.matches.length ? editCatalogue.matches.map((item, index) => `<button type="button" role="option" id="edit-catalog-option-${index}" class="cultivar-option" data-edit-catalog-name="${esc(item.name)}" aria-selected="false" tabindex="-1"><span class="option-name">${esc(item.name)}</span><span class="option-species">${esc(categories[item.species] || item.species || 'Uncategorized')}</span>${[...(item.chinese_name || []), ...(item.japanese_name || [])].length ? `<span class="option-aliases">${esc([...(item.chinese_name || []), ...(item.japanese_name || [])].join(' / '))}</span>` : ''}</button>`).join('') : '<div class="cultivar-no-results">No cultivar found. Try another name or alias.</div>';
    $('#editCultivarResults').hidden = false;
    $('#editCultivarSearch').setAttribute('aria-expanded', 'true');
    $('#editCultivarSearch').removeAttribute('aria-activedescendant');
  }
  async function chooseEditCultivar(name) {
    if (!requireAdmin()) return;
    const id = $('#editingAlbumId').value;
    const existing = existingAlbum({ name });
    if (existing && existing.id !== id) { $('#editCultivarStatus').textContent = 'This cultivar already has another album. Choose a different entry. No photos have been moved.'; return; }
    const generation = editCatalogue.generation;
    loading = true; lockUI(); hideEditMatches();
    $('#editCultivarStatus').textContent = 'Loading the selected cultivar…';
    try {
      const cultivar = window.CamelliaCatalog.toCultivar(await window.CamelliaCatalog.getEntry(name));
      if (generation !== editCatalogue.generation || !$('#albumEditDialog').open) return;
      editCatalogue.selected = cultivar;
      Object.entries(editorFields.albumEditDialog).forEach(([inputId, field]) => {
        if (field === 'notes' || ((field === 'color' || field === 'form') && !cultivar[field]?.length)) return;
        const value = field === 'form' ? flowerForms(cultivar[field]) : String(cultivar[field] ?? '');
        setEditorValue($('#' + inputId), value);
      });
      $('#editCultivarSearch').value = cultivar.name;
      $('#editAlbumReload').disabled = true;
      $('#editAlbumReload').dataset.lockDisabled = 'true';
      $('#albumEditError').textContent = '';
      $('#editCultivarStatus').textContent = `Selected: ${cultivar.name}${chineseAliasText(cultivar) ? ' · ' + chineseAliasText(cultivar) : ''}. Review the details below, then save album changes.`;
      updateEditorDirty('albumEditDialog');
    } catch (error) {
      if (generation === editCatalogue.generation) $('#editCultivarStatus').textContent = error.message || 'Could not load this cultivar. Choose the result again to retry.';
    } finally { loading = false; lockUI(); }
  }
  async function reloadCultivar(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(id);
    if (!album) return;
    const generation = sessionGeneration;
    let cultivar;
    loading = true; lockUI();
    $('#editAlbumReload').textContent = 'Reloading…';
    $('#albumEditError').textContent = '';
    status('Reloading cultivar details from the catalogue…');
    try {
      let sourceName = album.name;
      if (album.reference_url) {
        const reference = new URL(album.reference_url);
        if (reference.origin === 'https://camellia-nomenclature.github.io' && reference.hash) sourceName = decodeURIComponent(reference.hash.slice(1));
      }
      const index = await window.CamelliaCatalog.loadIndex({ refresh: true });
      const exact = index.find(item => canonicalKey(item.name) === canonicalKey(sourceName));
      const matches = exact ? [exact] : index.filter(item => [item.name, ...(item.chinese_name || []), ...(item.japanese_name || [])].some(name => canonicalKey(name) === canonicalKey(album.name)));
      if (matches.length !== 1) throw new Error(matches.length ? 'Several catalogue entries match. Check the canonical name before reloading.' : 'This cultivar was not found in the catalogue. Check its canonical name before reloading.');
      cultivar = window.CamelliaCatalog.toCultivar(await window.CamelliaCatalog.getEntry(matches[0].name));
    } catch (error) {
      if (generation === sessionGeneration) {
        const message = error.message || 'Could not reload cultivar details. Please try again.';
        $('#albumEditError').textContent = message;
        status(message, false, true);
      }
    } finally { loading = false; lockUI(); $('#editAlbumReload').textContent = 'Reload cultivar details'; }
    if (cultivar && generation === sessionGeneration) await saveAction({ type: 'REFRESH_CULTIVAR', id, cultivar }, { message: 'Reload cultivar details from the catalogue' }, '#albumEditError');
  }
  function openPhotoEdit(id) {
    if (!requireAdmin()) return;
    const album = getAlbum(albumView.id);
    const photo = album?.photos.find(item => item.id === id);
    if (!photo) return;
    $('#editingPhotoAlbumId').value = album.id;
    $('#editingPhotoId').value = photo.id;
    refreshEditor('photoEditDialog');
    openDialog('photoEditDialog');
  }
  function openSettings() {
    if (!requireAdmin()) return;
    refreshEditor('settingsDialog');
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
    if (button.matches('.hero-art')) { shuffleHero(); return; }
    if (button.dataset.open) { openAlbum(button.dataset.open); return; }
    if (button.dataset.editAlbum) { openAlbumEdit(button.dataset.editAlbum); return; }
    if (button.dataset.reloadCultivar) { reloadCultivar(button.dataset.reloadCultivar); return; }
    if (button.dataset.editCatalogName) { chooseEditCultivar(button.dataset.editCatalogName); return; }
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
    if (button.id === 'reloadGallery' || button.id === 'emptyReload' || button.matches('.reload-draft')) { loadGallery(); return; }
    if (isManagerPage && (button.id === 'loginEntry' || button.matches('.reauth-draft'))) { $('#githubToken').value = ''; $('#loginError').textContent = ''; openDialog('loginDialog'); return; }
    if (button.id === 'logoutButton') { logout(); return; }
    if (button.id === 'siteSettings') { openSettings(); return; }
    if (button.id === 'useManualCultivar') {
      if (!requireAdmin()) return;
      const name = $('#cultivarSearch').value.trim();
      if (!name) { $('#catalogueStatus').textContent = 'Enter a cultivar name first.'; return; }
      selectionGeneration++;
      const exact = existingAlbum({ name });
      const matches = exact ? [exact] : state().albums.filter(album => [album.display_name, ...(album.chinese_name || []), ...(album.japanese_name || [])].some(alias => canonicalKey(alias) === canonicalKey(name)));
      if (matches.length === 1) { setSelected(matches[0]); $('#catalogueStatus').textContent = 'Existing album selected. Choose photos to add to it.'; return; }
      if (matches.length > 1) { renderMatches(); $('#catalogueStatus').textContent = 'Several saved cultivars share this name. Choose the album from the results.'; return; }
      setSelected({ name, display_name: name }); return;
    }
    if (button.id === 'clearCultivar') {
      if (!requireAdmin()) return;
      selectionGeneration++; $('#cultivarSearch').value = ''; setSelected(null); renderMatches(); $('#cultivarSearch').focus(); return;
    }
    if (button.id === 'resetFilters' || button.id === 'emptyReset') { resetFilters(); return; }
    if (button.matches('.filter-toggle')) {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', !expanded); $('#moreFilters').hidden = expanded;
    }
  });
  if (isManagerPage) document.addEventListener('click', event => {
    if (!event.target.closest('.cultivar-picker')) hideMatches();
    if (!event.target.closest('#editCultivarPicker')) hideEditMatches();
  });
  $('#search').addEventListener('input', renderGallery);
  ['colorFilter', 'formFilter', 'sort'].forEach(id => $('#' + id).addEventListener('change', renderGallery));
  if (isManagerPage) {
    $('#editCultivarPicker').addEventListener('toggle', () => { if ($('#editCultivarPicker').open) loadEditCatalogue(); else hideEditMatches(); });
    $('#editCultivarSearch').addEventListener('input', renderEditMatches);
    $('#editCultivarSearch').addEventListener('focus', renderEditMatches);
    $('#editCultivarSearch').addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if ($('#editCultivarResults').hidden) renderEditMatches();
        if (!editCatalogue.matches.length) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        editCatalogue.active = editCatalogue.active < 0 ? (step > 0 ? 0 : editCatalogue.matches.length - 1) : (editCatalogue.active + step + editCatalogue.matches.length) % editCatalogue.matches.length;
        $$('#editCultivarResults .cultivar-option').forEach((option, index) => option.setAttribute('aria-selected', index === editCatalogue.active));
        const active = $('#edit-catalog-option-' + editCatalogue.active);
        $('#editCultivarSearch').setAttribute('aria-activedescendant', active.id);
        active.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = editCatalogue.matches[editCatalogue.active] || (editCatalogue.matches.length === 1 ? editCatalogue.matches[0] : null);
        if (!$('#editCultivarResults').hidden && item) chooseEditCultivar(item.name);
      } else if (event.key === 'Escape' && !$('#editCultivarResults').hidden) { event.preventDefault(); event.stopPropagation(); hideEditMatches(); }
      else if (event.key === 'Tab') hideEditMatches();
    });
    $('#editCultivarResults').addEventListener('mousedown', event => event.preventDefault());
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
        model.accept(result.document); model.setAuthenticated(true); recoveryRequired = false; galleryLoaded = true; galleryLoadError = false;
        refreshOpenEditors();
        if (selected) setSelected(existingAlbum(selected) || selected);
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
      const patch = editorPatch('albumEditDialog');
      if (!Object.keys(patch).length && !editCatalogue.selected) { closeDialog('albumEditDialog'); toast('No album changes to save.'); return; }
      if (Object.hasOwn(patch, 'description')) patch.summary_zh = patch.description;
      const action = { type: editCatalogue.selected ? 'REASSIGN_CULTIVAR' : 'PATCH_ALBUM', id: $('#editingAlbumId').value, patch };
      if (editCatalogue.selected) action.cultivar = editCatalogue.selected;
      const next = await saveAction(action, { message: editCatalogue.selected ? 'Correct cultivar selection' : 'Update cultivar album' }, '#albumEditError');
      if (next) { dirtyDialogs.delete('albumEditDialog'); closeDialog('albumEditDialog'); }
    });
    $('#photoEditForm').addEventListener('submit', async event => {
      event.preventDefault(); if (!requireAdmin()) return;
      const albumId = $('#editingPhotoAlbumId').value;
      const photoId = $('#editingPhotoId').value;
      const patch = editorPatch('photoEditDialog');
      if (!Object.keys(patch).length) { closeDialog('photoEditDialog'); toast('No photo changes to save.'); return; }
      if (Object.hasOwn(patch, 'takenAt')) { patch.dateSource = patch.takenAt ? 'manual' : 'unknown'; patch.dateOffset = ''; }
      const next = await saveAction({ type: 'PATCH_PHOTO', albumId, photoId, patch });
      if (next) { dirtyDialogs.delete('photoEditDialog'); closeDialog('photoEditDialog'); }
    });
    $('#settingsForm').addEventListener('submit', async event => {
      event.preventDefault(); if (!requireAdmin()) return;
      const patch = editorPatch('settingsDialog');
      if (!Object.keys(patch).length) { closeDialog('settingsDialog'); toast('No garden settings to save.'); return; }
      const next = await saveAction({ type: 'PATCH_SETTINGS', patch });
      if (next) { dirtyDialogs.delete('settingsDialog'); closeDialog('settingsDialog'); }
    });
    document.addEventListener('input', event => {
      const target = event.target;
      const dialog = target.closest('dialog');
      if (dialog && editorFields[dialog.id]) updateEditorDirty(dialog.id);
      else if (dialog && !['loginDialog','confirmDialog'].includes(dialog.id)) dirtyDialogs.add(dialog.id);
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
      editorBaselines.delete(dialog.id);
      const opener = dialogOpeners.get(dialog.id);
      dialogOpeners.delete(dialog.id);
      if (dialog.id === 'uploadDialog') { clearPending(); $('#photoFiles').disabled = false; }
      if (dialog.id === 'loginDialog') $('#githubToken').value = '';
      if (dialog.id === 'albumEditDialog') resetEditCatalogue();
      if (dialog.id === 'albumDialog') closeDialog('lightbox');
      if (opener) restoreFocus(opener.focus, opener.root, $('#emptyReset').hidden ? $('#search') : $('#emptyReset'));
    });
  }
  $$('dialog').forEach(wireDialog);
  document.addEventListener('contextmenu', event => {
    if (!editableTarget(event.target)) event.preventDefault();
  });
  document.addEventListener('dragstart', event => {
    if (event.target.closest?.('img')) event.preventDefault();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); return; }
    if (saving || loading || editableTarget(event.target) || event.isComposing) return;
    if (event.key === '/' && !$('dialog[open]')) { event.preventDefault(); $('#search').focus(); $('#collection').scrollIntoView({ behavior: 'smooth' }); }
    const top = topDialog();
    if (top && ['albumDialog', 'lightbox'].includes(top.id)) {
      if (event.key === 'ArrowRight') { event.preventDefault(); stepPhoto(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepPhoto(-1); }
    }
  });
  window.addEventListener('resize', () => { if ($('#lightbox')?.open) positionLightboxWatermark(); });
  window.addEventListener('beforeunload', event => {
    if (saving || pending.length || dirtyDialogs.size) { event.preventDefault(); event.returnValue = ''; }
  });
  render();
  loadGallery().finally(() => {
    if (isManagerPage && !admin()) openDialog('loginDialog');
  });
})();
