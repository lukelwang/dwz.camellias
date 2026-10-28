'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const photoIO = require('../src/photo-io.js');

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
  assert.equal(photoIO.validImageFile({ size: 1, type: 'text/plain', name: 'notes.txt' }), '请选择图片文件。');
  assert.equal(photoIO.validImageFile({ size: 50 * 1024 * 1024 + 1, type: 'image/jpeg', name: 'large.jpg' }), '单张照片不能超过 50 MB。');
  assert.equal(photoIO.validImageFile({ size: 0, type: 'image/jpeg', name: 'empty.jpg' }), '这张图片是空文件。');
});

test('readFile validation failures retain the source filename', async function () {
  assert.deepEqual(await photoIO.readFile({ size: 1, type: 'text/plain', name: 'notes.txt' }), {
    filename: 'notes.txt', error: '请选择图片文件。'
  });
  assert.deepEqual(await photoIO.readFile(null), {
    filename: '未命名照片', error: '请选择有效的图片文件。'
  });
});
