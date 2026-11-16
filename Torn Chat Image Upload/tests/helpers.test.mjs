// Chat image upload helpers. Run: node --test "Torn Chat Image Upload/tests/helpers.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertAt, uploadRequest, deleteRequest, parseUpload, errorText, addRecent } from '../plugin.js';

test('insertAtCursor', () => {
  assert.deepEqual(insertAt('hi', 2, 'L'), { value: 'hi L ', caret: 5 });
  assert.deepEqual(insertAt('', 0, 'L'), { value: 'L ', caret: 2 });
  assert.deepEqual(insertAt('a b', 2, 'L'), { value: 'a L b', caret: 4 });
  assert.deepEqual(insertAt('hi there', 2, 'L'), { value: 'hi L there', caret: 4 });
});

test('uploadRequest (Catbox, anonymous and with user hash)', () => {
  const f = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' });
  const r = uploadRequest(f, '');
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://catbox.moe/user/api.php');
  assert.equal(r.body.get('reqtype'), 'fileupload');
  assert.equal(r.body.get('fileToUpload').name, 'a.png');
  assert.equal(r.body.has('userhash'), false);
  assert.equal(uploadRequest(f, 'h1').body.get('userhash'), 'h1');
});

test('deleteRequest', () => {
  const r = deleteRequest('ab12cd.png', 'h1');
  assert.equal(r.url, 'https://catbox.moe/user/api.php');
  assert.equal(r.body.get('reqtype'), 'deletefiles');
  assert.equal(r.body.get('userhash'), 'h1');
  assert.equal(r.body.get('files'), 'ab12cd.png');
});

test('parseUpload', () => {
  assert.deepEqual(parseUpload(200, 'https://files.catbox.moe/ab12cd.png\n'), { ok: true, id: 'ab12cd.png', link: 'https://files.catbox.moe/ab12cd.png' });
  assert.deepEqual(parseUpload(413, ''), { ok: false, error: errorText(413) });
  assert.equal(parseUpload(200, 'Something went wrong').ok, false);
  assert.equal(parseUpload(200, 'Something went wrong').error, 'Upload failed: Something went wrong');
  assert.equal(parseUpload(200, 'https://evil.example/x.png').ok, false);
});

test('errorText', () => {
  assert.equal(errorText(0), 'Network error, try again');
  assert.equal(errorText(413), 'Image too big for Catbox.');
  assert.equal(errorText(429), 'Catbox is busy. Try again in a few minutes.');
  assert.equal(errorText(500), 'Upload failed (500)');
});

test('addRecent', () => {
  let l = [];
  for (let i = 0; i < 21; i++) l = addRecent(l, { id: 'i' + i, link: 'L' + i, at: i });
  assert.equal(l.length, 20);
  assert.equal(l[0].id, 'i20');
  assert.equal(l[19].id, 'i1');
});
