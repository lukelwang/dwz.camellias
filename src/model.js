/* Pure gallery edits are proposed first and accepted only after a confirmed store save. */
(function () {
  'use strict';

  const FRAME = { style: 'none', color: '#d6c29b', width: 5, radius: 12, padding: 8 };
  const SETTINGS = {
    brand: '花间', titleLine1: '收藏花开，', titleLine2: '也收藏时光。',
    description: '四百余种茶花，一个慢慢生长的花园。\n用镜头留住每一朵，独一无二的盛放。',
    gardenCount: '400+'
  };
  const ALBUM_FIELDS = ['name', 'display_name', 'description', 'summary_zh', 'species', 'color', 'form', 'size', 'notes'];
  const PHOTO_FIELDS = ['caption', 'takenAt', 'dateSource', 'dateOffset'];
  const ADMIN_ACTIONS = ['ADD_PHOTOS', 'PATCH_ALBUM', 'PATCH_PHOTO', 'DELETE_PHOTO', 'DELETE_ALBUM', 'SET_COVER', 'MOVE_PHOTO', 'PATCH_SETTINGS'];
  const select = (object, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(object, key)).map(key => [key, object[key]]));
  const sourceURL = name => 'https://camellia-nomenclature.github.io/#' + encodeURIComponent(name);
  const frameCopy = frame => frame == null ? null : { ...FRAME, ...select(frame, Object.keys(FRAME)) };

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
      ...photo,
      id: photo.id || `${album.id}-photo-${index}`,
      kind: photo.kind || 'personal',
      caption: photo.caption || '', filename: photo.filename || '',
      takenAt: photo.takenAt || '', dateSource: photo.dateSource || 'unknown',
      frame: frameCopy(photo.frame)
    }));
    return {
      ...album, photos, notes: album.notes || '', frame: frameCopy(album.frame || FRAME),
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
      if (!album) return finish({}, '这个品种相册已不存在。', true);
      return finish({ albums: state.albums.map(item => item.id === id ? transform(item) : item) }, message);
    }

    function dispatch(action) {
      const type = action.type;
      if (type === 'TOGGLE_FAVORITE') {
        if (!state.albums.some(album => album.id === action.id)) return finish({}, '这个品种相册已不存在。', true);
        const exists = state.favorites.includes(action.id);
        return finish({ favorites: exists ? state.favorites.filter(id => id !== action.id) : [...state.favorites, action.id] }, exists ? '已取消收藏。' : '已收藏这个品种。');
      }
      if (ADMIN_ACTIONS.includes(type) && state.role !== 'admin') {
        return finish({}, '请先验证管理员身份，再修改花园内容。', true);
      }
      if (type === 'PATCH_SETTINGS') {
        return finish({ settings: { ...state.settings, ...select(action.patch || {}, Object.keys(SETTINGS)) } }, '已更新花园标题与介绍。');
      }
      if (type === 'ADD_PHOTOS') {
        const cultivar = typeof action.cultivar === 'string' ? { name: action.cultivar.trim() } : (action.cultivar || {});
        const existing = state.albums.find(album => (cultivar.id && album.id === cultivar.id) || (cultivar.name && album.name === cultivar.name));
        if (!existing && !cultivar.name?.trim()) return finish({}, '请先选择或填写品种名称。', true);
        if (!action.photos?.length) return finish({}, '请先选择照片。', true);
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
            ...photo, id, kind: photo.kind || 'personal', caption: photo.caption || '', filename: photo.filename || '',
            takenAt: photo.takenAt || '', dateSource: photo.dateSource || 'unknown', frame: frameCopy(photo.frame)
          };
        });
        const updated = { ...album, photos: [...album.photos, ...photos], coverPhotoId: album.coverPhotoId || photos[0].id };
        return finish({ albums: existing ? state.albums.map(item => item.id === album.id ? updated : item) : [...state.albums, updated] }, `已向「${album.display_name || album.name}」加入 ${photos.length} 张照片。`);
      }
      if (type === 'PATCH_ALBUM') {
        const patch = select(action.patch || {}, ALBUM_FIELDS);
        if (Object.hasOwn(patch, 'name')) {
          patch.name = String(patch.name || '').trim();
          if (!patch.name) return finish({}, '品种名称不能为空。', true);
          if (state.albums.some(album => album.id !== action.id && album.name === patch.name)) return finish({}, '已有同名品种，请使用不同名称。', true);
          patch.reference_url = sourceURL(patch.name);
        }
        return updateAlbum(action.id, album => ({
          ...album, ...patch,
          frame: Object.hasOwn(action.patch || {}, 'frame') ? frameCopy({ ...album.frame, ...(action.patch.frame || FRAME) }) : album.frame
        }), '已更新品种资料。');
      }
      if (type === 'DELETE_ALBUM') {
        if (!state.albums.some(album => album.id === action.id)) return finish({}, '这个品种相册已不存在。', true);
        return finish({ albums: state.albums.filter(album => album.id !== action.id), favorites: state.favorites.filter(id => id !== action.id) }, '已删除品种及相册中的全部照片。');
      }
      if (['PATCH_PHOTO', 'DELETE_PHOTO', 'SET_COVER', 'MOVE_PHOTO'].includes(type)) {
        const album = state.albums.find(item => item.id === action.albumId);
        const photo = album?.photos.find(item => item.id === action.photoId);
        if (!photo) return finish({}, '这张照片已不存在。', true);
        if (type === 'PATCH_PHOTO') {
          const patch = select(action.patch || {}, PHOTO_FIELDS);
          if (Object.hasOwn(patch, 'takenAt') && !patch.takenAt) {
            patch.takenAt = '';
            patch.dateSource = 'unknown';
          }
          if (Object.hasOwn(action.patch || {}, 'frame')) {
            patch.frame = action.patch.frame == null ? null : frameCopy({ ...(photo.frame || album.frame), ...action.patch.frame });
          }
          return updateAlbum(album.id, item => ({ ...item, photos: item.photos.map(current => current.id === photo.id ? { ...current, ...patch } : current) }), '已更新照片说明、拍摄时间或边框。');
        }
        if (type === 'DELETE_PHOTO') {
          return updateAlbum(album.id, item => {
            const photos = item.photos.filter(current => current.id !== photo.id);
            return { ...item, photos, coverPhotoId: item.coverPhotoId === photo.id ? (photos[0]?.id || null) : item.coverPhotoId };
          }, '已删除照片；品种相册仍保留。');
        }
        if (type === 'SET_COVER') return updateAlbum(album.id, item => ({ ...item, coverPhotoId: photo.id }), '已设为相册封面。');
        if (action.direction !== -1 && action.direction !== 1) return finish({}, '请选择向前或向后移动照片。', true);
        const index = album.photos.indexOf(photo);
        const target = index + action.direction;
        if (target < 0 || target >= album.photos.length) return finish({}, '照片已经在这个方向的尽头。');
        return updateAlbum(album.id, item => {
          const photos = item.photos.slice();
          [photos[index], photos[target]] = [photos[target], photos[index]];
          return { ...item, photos };
        }, '已调整照片顺序。');
      }
      return finish({}, '这个操作暂不支持。', true);
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
