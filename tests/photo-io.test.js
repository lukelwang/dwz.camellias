'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const photoIO = require('../src/photo-io.js');
const fs = require('node:fs');
const vm = require('node:vm');

test('cameraDate keeps camera wall time and rejects invalid or incomplete timestamps', function () {
  assert.equal(photoIO.cameraDate('2024:02:29 23:59:58'), '2024-02-29T23:59');
  assert.equal(photoIO.cameraDate('2023:02:29 12:00:00'), '');
  assert.equal(photoIO.cameraDate('2024:13:01 12:00:00'), '');
  assert.equal(photoIO.cameraDate('2024:01:01 24:00:00'), '');
  assert.equal(photoIO.cameraDate('2024-01-01T12:00:00Z'), '');
  assert.equal(photoIO.cameraDate(new Date()), '');
});

test('cameraOffset is kept separate and accepts only valid EXIF offsets', function () {
  assert.equal(photoIO.cameraOffset('-07:00'), '-07:00');
  assert.equal(photoIO.cameraOffset('+14:00'), '+14:00');
  assert.equal(photoIO.cameraOffset('+14:01'), '');
  assert.equal(photoIO.cameraOffset('+02:60'), '');
  assert.equal(photoIO.cameraOffset('Z'), '');
});

test('capture-date labels describe public metadata without unavailable editing instructions', function () {
  assert.equal(photoIO.dateLabel({ takenAt: '' }), 'Capture date unknown');
  assert.equal(photoIO.dateLabel({ takenAt: '2026-03-20T10:23', dateSource: 'exif' }), '2026-03-20 10:23 · Photo EXIF');
  assert.equal(photoIO.dateLabel({ takenAt: '2026-03-20T10:23', dateSource: 'manual' }), '2026-03-20 10:23 · Entered manually');
});

test('outputDimensions preserves aspect ratio and caps the longest edge', function () {
  assert.deepEqual(photoIO.outputDimensions(6000, 4000, 2560), { width: 2560, height: 1707 });
  assert.deepEqual(photoIO.outputDimensions(600, 400, 640), { width: 600, height: 400 });
  assert.deepEqual(photoIO.outputDimensions(1, 9000, 640), { width: 1, height: 640 });
  assert.equal(photoIO.outputDimensions(0, 10, 640), null);
  assert.equal(photoIO.outputDimensions(Infinity, 10, 640), null);
});

test('decoded images above 100 million pixels are rejected before canvas work', function () {
  assert.equal(photoIO.safeDecodedDimensions(10000, 10000), true);
  assert.equal(photoIO.safeDecodedDimensions(10001, 10000), false);
  assert.equal(photoIO.safeDecodedDimensions(Infinity, 10), false);
});

test('input validation accepts image formats and rejects non-images and oversized files', function () {
  assert.equal(photoIO.validImageFile({ size: 1, type: 'image/heic', name: 'garden.heic' }), '');
  assert.equal(photoIO.validImageFile({ size: 1, type: '', name: 'garden.HEIF' }), '');
  assert.equal(photoIO.validImageFile({ size: 1, type: 'text/plain', name: 'notes.txt' }), 'Choose an image file.');
  assert.equal(photoIO.validImageFile({ size: 50 * 1024 * 1024 + 1, type: 'image/jpeg', name: 'large.jpg' }), 'Each photo must be 50 MB or smaller.');
  assert.equal(photoIO.validImageFile({ size: 0, type: 'image/jpeg', name: 'empty.jpg' }), 'This image file is empty.');
});

test('readFile validation failures retain the source filename', async function () {
  assert.deepEqual(await photoIO.readFile({ size: 1, type: 'text/plain', name: 'notes.txt' }), {
    filename: 'notes.txt', error: 'Choose an image file.'
  });
  assert.deepEqual(await photoIO.readFile(null), {
    filename: 'Untitled photo', error: 'Choose a valid image file.'
  });
});

test('processed photos retain Unicode names and EXIF metadata and omit custom frames', async function () {
  const revoked = [];
  let urlNumber = 0;
  const scope = {
    module: { exports: {} },
    crypto: { randomUUID: () => 'photo-new' },
    exifr: { parse: async () => ({ DateTimeOriginal: '2026:03:20 10:23:45', OffsetTimeOriginal: '+08:00' }) },
    URL: { createObjectURL: () => 'blob:photo-' + (++urlNumber), revokeObjectURL: url => revoked.push(url) },
    Image: class {
      naturalWidth = 4000;
      naturalHeight = 3000;
      set src(value) { this.onload(); }
    },
    document: {
      createElement: () => ({
        getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob: callback => callback({ size: 100, type: 'image/jpeg' })
      })
    }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/photo-io.js'), 'utf8'), scope);
  const photo = await scope.module.exports.readFile({ size: 5000, type: 'image/jpeg', name: '我的茶花 🌸.jpg' });
  assert.equal(photo.error, undefined);
  assert.equal(photo.id, 'photo-new');
  assert.equal(photo.filename, '我的茶花 🌸.jpg');
  assert.equal(photo.takenAt, '2026-03-20T10:23');
  assert.equal(photo.dateSource, 'exif');
  assert.equal(photo.dateOffset, '+08:00');
  assert.equal(photo.width, 2560);
  assert.equal(photo.height, 1920);
  assert.equal(photo.kind, 'personal');
  assert.equal(photo.mime, 'image/jpeg');
  assert.equal(photo.imageBlob.size, 100);
  assert.equal(photo.thumbnailBlob.size, 100);
  assert.equal(Object.hasOwn(photo, 'frame'), false);
  assert.deepEqual(revoked, ['blob:photo-1']);
});
