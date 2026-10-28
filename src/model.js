/* Pure gallery edits are proposed first and accepted only after a confirmed store save. */
(function () {
  'use strict';

  const SETTINGS = {
    brand: 'DWZ Camellias', titleLine1: 'Every bloom,', titleLine2: 'a moment kept.',
    description: 'A garden of more than 400 camellia cultivars.\nPhotographed, remembered, and grown with care.',
    gardenCount: '400+'
  };
  const ALBUM_FIELDS = ['name', 'display_name', 'description', 'summary_zh', 'species', 'color', 'form', 'size', 'notes'];
  const PHOTO_FIELDS = ['caption', 'takenAt', 'dateSource', 'dateOffset'];
  const ADMIN_ACTIONS = ['ADD_PHOTOS', 'PATCH_ALBUM', 'PATCH_PHOTO', 'DELETE_PHOTO', 'DELETE_ALBUM', 'SET_COVER', 'MOVE_PHOTO', 'PATCH_SETTINGS'];
  const select = (object, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(object, key)).map(key => [key, object[key]]));
  const sourceURL = name => 'https://camellia-nomenclature.github.io/#' + encodeURIComponent(name);
  const canonicalName = name => typeof name === 'string' ? name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
  const withoutFrame = ({ frame, ...value }) => value;

  function shuffle(albums) {
    const result = albums.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function copyAlbum(album) {
    const photos = (album.photos || []).map((photo, index) => ({
      ...withoutFrame(photo),
      id: photo.id || `${album.id}-photo-${index}`,
      kind: photo.kind || 'personal',
      caption: photo.caption || '', filename: photo.filename || '',
      takenAt: photo.takenAt || '', dateSource: photo.dateSource || 'unknown'
    }));
    return {
      ...withoutFrame(album), photos, notes: album.notes || '',
      coverPhotoId: photos.some(photo => photo.id === album.coverPhotoId) ? album.coverPhotoId : (photos[0]?.id || null)
    };
  }

  function create(document = { albums: [], settings: {} }) {
    const extras = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['schemaVersion', 'settings', 'albums'].includes(key)));
    let documentExtras = extras(document);
    let nextAlbumNumber = 1;
    let nextPhotoNumber = 1;
    let state = {
      role: 'visitor', albums: shuffle((document.albums || []).map(copyAlbum)), favorites: [],
      settings: { ...SETTINGS, ...document.settings }, revision: 0,
      lastAction: '', history: [], notice: '', error: false
    };

    function finish(patch, message, error = false) {
      state = {
        ...state, ...patch, revision: state.revision + 1,
        lastAction: message, history: [...state.history, message].slice(-30), notice: message, error
      };
      return state;
    }

    function updateAlbum(id, transform, message) {
      const album = state.albums.find(item => item.id === id);
      if (!album) return finish({}, 'This cultivar album no longer exists.', true);
      return finish({ albums: state.albums.map(item => item.id === id ? transform(item) : item) }, message);
    }

    function dispatch(action) {
      const type = action.type;
      if (type === 'TOGGLE_FAVORITE') {
        if (!state.albums.some(album => album.id === action.id)) return finish({}, 'This cultivar album no longer exists.', true);
        const exists = state.favorites.includes(action.id);
        return finish({ favorites: exists ? state.favorites.filter(id => id !== action.id) : [...state.favorites, action.id] }, exists ? 'Removed from favorites.' : 'Added this cultivar to favorites.');
      }
      if (ADMIN_ACTIONS.includes(type) && state.role !== 'admin') {
        return finish({}, 'Verify the owner account before editing the garden.', true);
      }
      if (type === 'PATCH_SETTINGS') {
        return finish({ settings: { ...state.settings, ...select(action.patch || {}, Object.keys(SETTINGS)) } }, 'Garden title and description updated.');
      }
      if (type === 'ADD_PHOTOS') {
        const cultivar = typeof action.cultivar === 'string' ? { name: action.cultivar.trim() } : (action.cultivar || {});
        const name = canonicalName(cultivar.name);
        const existing = (cultivar.id && state.albums.find(album => album.id === cultivar.id)) ||
          (name && state.albums.find(album => canonicalName(album.name) === name));
        if (!existing && !cultivar.name?.trim()) return finish({}, 'Choose or enter a cultivar name first.', true);
        if (!action.photos?.length) return finish({}, 'Choose at least one photo first.', true);
        let album = existing;
        if (!album) {
          let id = cultivar.id;
          if (!id || !/^[A-Za-z0-9_-]{1,160}$/.test(id) || state.albums.some(item => item.id === id)) {
            do { id = `cultivar-${nextAlbumNumber++}`; } while (state.albums.some(item => item.id === id));
          }
          album = copyAlbum({ ...cultivar, id, name: cultivar.name.trim(), display_name: cultivar.display_name || cultivar.name.trim(), reference_url: sourceURL(cultivar.name.trim()), photos: [] });
        }
        const usedIds = new Set(state.albums.flatMap(item => item.photos.map(photo => photo.id)));
        const photos = action.photos.map(photo => {
          let id = photo.id;
          if (!id || usedIds.has(id)) {
            do { id = `${album.id}-upload-${nextPhotoNumber++}`; } while (usedIds.has(id));
          }
          usedIds.add(id);
          return {
            ...withoutFrame(photo), id, kind: photo.kind || 'personal', caption: photo.caption || '', filename: photo.filename || '',
            takenAt: photo.takenAt || '', dateSource: photo.dateSource || 'unknown'
          };
        });
        const updated = { ...album, photos: [...album.photos, ...photos], coverPhotoId: album.coverPhotoId || photos[0].id };
        return finish({ albums: existing ? state.albums.map(item => item.id === album.id ? updated : item) : [...state.albums, updated] }, `Added ${photos.length} photo${photos.length === 1 ? '' : 's'} to “${album.display_name || album.name}”.`);
      }
      if (type === 'PATCH_ALBUM') {
        const patch = select(action.patch || {}, ALBUM_FIELDS);
        if (Object.hasOwn(patch, 'name')) {
          patch.name = String(patch.name || '').trim();
          if (!patch.name) return finish({}, 'Cultivar name cannot be empty.', true);
          if (state.albums.some(album => album.id !== action.id && canonicalName(album.name) === canonicalName(patch.name))) return finish({}, 'A cultivar with this name already exists. Choose a different name.', true);
          patch.reference_url = sourceURL(patch.name);
        }
        return updateAlbum(action.id, album => ({ ...album, ...patch }), 'Cultivar details updated.');
      }
      if (type === 'DELETE_ALBUM') {
        if (!state.albums.some(album => album.id === action.id)) return finish({}, 'This cultivar album no longer exists.', true);
        return finish({ albums: state.albums.filter(album => album.id !== action.id), favorites: state.favorites.filter(id => id !== action.id) }, 'Cultivar and all its photos deleted.');
      }
      if (['PATCH_PHOTO', 'DELETE_PHOTO', 'SET_COVER', 'MOVE_PHOTO'].includes(type)) {
        const album = state.albums.find(item => item.id === action.albumId);
        const photo = album?.photos.find(item => item.id === action.photoId);
        if (!photo) return finish({}, 'This photo no longer exists.', true);
        if (type === 'PATCH_PHOTO') {
          const patch = select(action.patch || {}, PHOTO_FIELDS);
          if (Object.hasOwn(patch, 'takenAt') && !patch.takenAt) {
            patch.takenAt = '';
            patch.dateSource = 'unknown';
          }
          return updateAlbum(album.id, item => ({ ...item, photos: item.photos.map(current => current.id === photo.id ? { ...current, ...patch } : current) }), 'Photo caption or capture date updated.');
        }
        if (type === 'DELETE_PHOTO') {
          return updateAlbum(album.id, item => {
            const photos = item.photos.filter(current => current.id !== photo.id);
            return { ...item, photos, coverPhotoId: item.coverPhotoId === photo.id ? (photos[0]?.id || null) : item.coverPhotoId };
          }, 'Photo deleted. The cultivar album remains.');
        }
        if (type === 'SET_COVER') return updateAlbum(album.id, item => ({ ...item, coverPhotoId: photo.id }), 'Set as album cover.');
        if (action.direction !== -1 && action.direction !== 1) return finish({}, 'Choose whether to move the photo forward or backward.', true);
        const index = album.photos.indexOf(photo);
        const target = index + action.direction;
        if (target < 0 || target >= album.photos.length) return finish({}, 'The photo is already at the end in that direction.');
        return updateAlbum(album.id, item => {
          const photos = item.photos.slice();
          [photos[index], photos[target]] = [photos[target], photos[index]];
          return { ...item, photos };
        }, 'Photo order updated.');
      }
      return finish({}, 'This action is not supported yet.', true);
    }

    function documentValue(value = state) {
      return { ...documentExtras, schemaVersion: 1, settings: { ...value.settings }, albums: value.albums.map(copyAlbum) };
    }
    function accept(document) {
      documentExtras = extras(document);
      const rank = new Map(state.albums.map((album, index) => [album.id, index]));
      const incoming = (document.albums || []).map(copyAlbum);
      const newcomers = shuffle(incoming.filter(album => !rank.has(album.id)));
      const previousCount = rank.size;
      newcomers.forEach((album, index) => rank.set(album.id, previousCount + index));
      incoming.sort((a, b) => rank.get(a.id) - rank.get(b.id));
      state = { ...state, albums: incoming, settings: { ...SETTINGS, ...document.settings }, error: false, favorites: state.favorites.filter(id => incoming.some(album => album.id === id)) };
      return state;
    }
    function propose(action) {
      const previous = state;
      const proposed = dispatch(action);
      state = previous;
      return { ...proposed, document: documentValue(proposed) };
    }
    function setAuthenticated(verified) {
      state = { ...state, role: verified ? 'admin' : 'visitor' };
    }
    return { getState: () => state, dispatch, propose, accept, setAuthenticated, document: documentValue };
  }

  window.CamelliaModel = { create };
})();
