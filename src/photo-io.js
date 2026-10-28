(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CamelliaPhotoIO = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_INPUT_SIZE = 50 * 1024 * 1024;
  const MAX_DECODED_PIXELS = 100 * 1000 * 1000;
  const IMAGE_EDGE = 2560;
  const THUMB_EDGE = 640;

  function newId() {
    try {
      if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
    } catch (_) {}
    return 'photo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  // EXIF capture time is a camera wall clock. Do not apply the browser's zone.
  function cameraDate(value) {
    if (typeof value !== 'string') return '';
    const match = value.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (!match) return '';
    const [, year, month, day, hour, minute, second = '00'] = match;
    const y = Number(year), m = Number(month), d = Number(day);
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!y || m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return '';
    return year + '-' + month + '-' + day + 'T' + hour + ':' + minute;
  }

  function cameraOffset(value) {
    if (typeof value !== 'string') return '';
    const offset = value.trim();
    const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!match || Number(match[2]) > 14 || Number(match[3]) > 59 || (Number(match[2]) === 14 && Number(match[3]) !== 0)) return '';
    return offset;
  }

  function outputDimensions(width, height, longestEdge) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const scale = Math.min(1, longestEdge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  function safeDecodedDimensions(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width * height <= MAX_DECODED_PIXELS;
  }

  function decode(src) {
    return new Promise(function (resolve, reject) {
      const image = new Image();
      image.onload = function () {
        const width = image.naturalWidth, height = image.naturalHeight;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) reject(new Error('Could not read the photo dimensions.'));
        else if (!safeDecodedDimensions(width, height)) reject(new Error('The photo exceeds 100 megapixels. Resize it and try again.'));
        else resolve({ image: image, width: width, height: height });
      };
      image.onerror = function () { reject(new Error('Could not decode the photo.')); };
      image.src = src;
    });
  }

  function encode(image, width, height, quality) {
    return new Promise(function (resolve, reject) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Your browser cannot process this photo.'));
        return;
      }
      // JPEG has no alpha channel; fill transparencies with a neutral near-white.
      context.fillStyle = '#fffefa';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      canvas.toBlob(function (blob) {
        canvas.width = 0;
        canvas.height = 0;
        if (blob && blob.size > 0 && blob.type === 'image/jpeg') resolve(blob);
        else reject(new Error('Could not create a JPEG photo.'));
      }, 'image/jpeg', quality);
    });
  }

  function validImageFile(file) {
    if (!file || typeof file.size !== 'number' || !Number.isFinite(file.size)) return 'Choose a valid image file.';
    if (file.size <= 0) return 'This image file is empty.';
    if (file.size > MAX_INPUT_SIZE) return 'Each photo must be 50 MB or smaller.';
    const type = (file.type || '').toLowerCase();
    const extension = (file.name || '').toLowerCase().split('.').pop();
    if (type.startsWith('image/')) return '';
    if (!type && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff'].includes(extension)) return '';
    return 'Choose an image file.';
  }

  async function readFile(file) {
    const filename = file && file.name || 'Untitled photo';
    const validationError = validImageFile(file);
    if (validationError) return { filename: filename, error: validationError };
    let sourceUrl = '';
    let preparedUrl = '';
    try {
      let metadata = null;
      try {
        if (globalThis.exifr && typeof globalThis.exifr.parse === 'function') {
          metadata = await globalThis.exifr.parse(file, { pick: ['DateTimeOriginal', 'OffsetTimeOriginal'], reviveValues: false });
        }
      } catch (_) {
        // Missing or malformed EXIF does not prevent adding an otherwise valid image.
      }
      const takenAt = cameraDate(metadata && metadata.DateTimeOriginal);
      const dateOffset = cameraOffset(metadata && metadata.OffsetTimeOriginal);
      sourceUrl = URL.createObjectURL(file);
      const decoded = await decode(sourceUrl);
      const imageSize = outputDimensions(decoded.width, decoded.height, IMAGE_EDGE);
      const thumbnailSize = outputDimensions(decoded.width, decoded.height, THUMB_EDGE);
      if (!imageSize || !thumbnailSize) throw new Error('Could not read the photo dimensions.');
      const imageBlob = await encode(decoded.image, imageSize.width, imageSize.height, 0.9);
      const thumbnailBlob = await encode(decoded.image, thumbnailSize.width, thumbnailSize.height, 0.82);
      if (!imageBlob || !thumbnailBlob) throw new Error('Could not create photo files.');
      preparedUrl = URL.createObjectURL(imageBlob);
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = '';
      return {
        id: newId(), src: preparedUrl, imageBlob: imageBlob, thumbnailBlob: thumbnailBlob,
        width: imageSize.width, height: imageSize.height, size: imageBlob.size, sourceSize: file.size,
        mime: 'image/jpeg', filename: filename, caption: '',
        takenAt: takenAt, dateSource: takenAt ? 'exif' : 'unknown', dateOffset: dateOffset,
        kind: 'personal'
      };
    } catch (error) {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      if (preparedUrl) URL.revokeObjectURL(preparedUrl);
      const detail = error && ['Could not create a JPEG photo.', 'The photo exceeds 100 megapixels. Resize it and try again.'].includes(error.message) ? error.message :
        'This browser could not decode or process the photo. HEIC/HEIF may not be supported, or the file may be damaged. Choose a compatible format on your iPhone or convert it to JPEG and try again.';
      return { filename: filename, error: detail };
    }
  }

  function dateLabel(photo) {
    if (!photo || !photo.takenAt) return 'Capture date unknown · Add manually';
    return photo.takenAt.replace('T', ' ') + ' · ' + (photo.dateSource === 'exif' ? 'Photo EXIF' : 'Entered manually');
  }

  return {
    readFile: readFile,
    dateLabel: dateLabel,
    cameraDate: cameraDate,
    cameraOffset: cameraOffset,
    outputDimensions: outputDimensions,
    safeDecodedDimensions: safeDecodedDimensions,
    validImageFile: validImageFile
  };
});
