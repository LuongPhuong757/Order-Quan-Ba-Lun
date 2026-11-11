import { describe, expect, it } from 'vitest';
import { legacyTabToGroup, parseSettingsGroup, settingsHref } from './settings-groups.ts';

describe('settings-groups', () => {
  it('đổi 7 tab cũ sang đúng nhóm mới', () => {
    expect(legacyTabToGroup('ordering')).toEqual({ group: 'online' });
    expect(legacyTabToGroup('blacklist')).toEqual({ group: 'online', subTab: 'blacklist' });
    expect(legacyTabToGroup('top-dishes')).toEqual({ group: 'online', subTab: 'top-dishes' });
    expect(legacyTabToGroup('payment-qr')).toEqual({ group: 'payment' });
    expect(legacyTabToGroup('menu-qr')).toEqual({ group: 'table' });
    expect(legacyTabToGroup('stale-alert')).toEqual({ group: 'table' });
    expect(legacyTabToGroup('printers')).toEqual({ group: 'printers' });
  });

  it('tab lạ hoặc trống thì không đoán bừa', () => {
    expect(legacyTabToGroup(null)).toBeNull();
    expect(legacyTabToGroup('khong-co')).toBeNull();
  });

  it('chỉ nhận 5 tên nhóm', () => {
    expect(parseSettingsGroup('store')).toBe('store');
    expect(parseSettingsGroup('settings')).toBeNull();
    expect(parseSettingsGroup(null)).toBeNull();
  });

  it('dựng link theo nhóm, bỏ tab con mặc định', () => {
    expect(settingsHref()).toBe('/settings');
    expect(settingsHref('store')).toBe('/settings?g=store');
    expect(settingsHref('online', 'ordering')).toBe('/settings?g=online');
    expect(settingsHref('online', 'blacklist')).toBe('/settings?g=online&tab=blacklist');
  });
});
