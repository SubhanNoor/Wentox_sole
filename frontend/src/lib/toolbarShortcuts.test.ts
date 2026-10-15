import { describe, expect, it } from 'vitest';
import { matchToolbarShortcut, TOOLBAR_SHORTCUTS } from './toolbarShortcuts';

// The action bar shortcut mapping agreed with the user, 2026-10-16.
const key = (code: string, mods: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) => ({
  code,
  altKey: mods.alt ?? true,
  shiftKey: !!mods.shift,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
});

describe('action bar shortcuts', () => {
  it('maps every agreed key to its button', () => {
    expect(matchToolbarShortcut(key('KeyN'))).toBe('newAction');
    expect(matchToolbarShortcut(key('KeyS'))).toBe('save');
    expect(matchToolbarShortcut(key('KeyD'))).toBe('done');
    expect(matchToolbarShortcut(key('KeyE'))).toBe('edit');
    expect(matchToolbarShortcut(key('KeyR'))).toBe('editRow');
    expect(matchToolbarShortcut(key('KeyC'))).toBe('cancel');
    expect(matchToolbarShortcut(key('Delete'))).toBe('remove');
    expect(matchToolbarShortcut(key('KeyP'))).toBe('post');
    expect(matchToolbarShortcut(key('KeyU'))).toBe('unpost');
    expect(matchToolbarShortcut(key('KeyA'))).toBe('saveAndPost');
    expect(matchToolbarShortcut(key('KeyP', { shift: true }))).toBe('postAll');
    expect(matchToolbarShortcut(key('Home'))).toBe('first');
    expect(matchToolbarShortcut(key('ArrowLeft'))).toBe('prev');
    expect(matchToolbarShortcut(key('ArrowRight'))).toBe('next');
    expect(matchToolbarShortcut(key('End'))).toBe('last');
    expect(matchToolbarShortcut(key('KeyF'))).toBe('find');
    expect(matchToolbarShortcut(key('KeyV'))).toBe('print');
    expect(matchToolbarShortcut(key('KeyX'))).toBe('exit');
  });

  it('needs Alt alone: plain keys, Ctrl+Alt (AltGr) and Shift variants of others do nothing', () => {
    expect(matchToolbarShortcut(key('KeyN', { alt: false }))).toBeNull();
    expect(matchToolbarShortcut(key('KeyS', { ctrl: true }))).toBeNull();
    expect(matchToolbarShortcut(key('KeyS', { meta: true }))).toBeNull();
    expect(matchToolbarShortcut(key('KeyS', { shift: true }))).toBeNull();
    expect(matchToolbarShortcut(key('F4'))).toBeNull(); // Alt+F4 stays the OS close
  });

  it('never gives two buttons the same key', () => {
    const keys = Object.values(TOOLBAR_SHORTCUTS).map(s => `${s.code}${s.shift ? '+shift' : ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
