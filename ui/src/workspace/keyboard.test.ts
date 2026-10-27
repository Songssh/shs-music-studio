import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { isWindowsClient } from './registry';
import { editorOwnsKeyboard, workspaceOwnsKeyboard } from './keyboard';

test('Windows eligibility explicitly rejects Android even with desktop platform hints', () => {
  assert.equal(isWindowsClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32'), true);
  assert.equal(isWindowsClient('Mozilla/5.0 (Linux; Android 14)', 'Win32'), false);
  assert.equal(isWindowsClient('Mozilla/5.0 (iPad)', 'MacIntel'), false);
  assert.equal(isWindowsClient('Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64'), false);
});
test('nonmodal floating windows retain shortcuts; editor, IME and real dialog block them', () => {
  const { document } = parseHTML('<html><body><section data-workspace-active="compare-studio"><div role="dialog" aria-modal="false"><div id="canvas"></div><textarea></textarea></div></section></body></html>');
  const previous = globalThis.document;
  Object.assign(globalThis, { document });
  try {
    const event = { target: document.querySelector('#canvas'), defaultPrevented:false, isComposing:false, keyCode:32 } as unknown as KeyboardEvent;
    assert.equal(workspaceOwnsKeyboard('library'), false);
    assert.equal(workspaceOwnsKeyboard('compare-studio'), true);
    assert.equal(editorOwnsKeyboard(event), false);
    assert.equal(editorOwnsKeyboard({ ...event, isComposing:true }), true);
    assert.equal(editorOwnsKeyboard({ ...event, target:document.querySelector('textarea') }), true);
    document.body.insertAdjacentHTML('beforeend','<dialog open></dialog>');
    assert.equal(editorOwnsKeyboard(event), true);
  } finally { Object.assign(globalThis, { document:previous }); }
});
