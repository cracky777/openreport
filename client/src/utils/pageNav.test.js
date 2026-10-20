import { describe, expect, test } from 'vitest';
import { withPageNav, describePageNav, navStateColors, pageIconOf } from './pageNav';

describe('the page menu', () => {
  test('a page_nav op merges the look and sets icons, keeping an uploaded image and the logo', () => {
    const settings = { pageNav: { logo: 'data:x', width: 180, pageIcons: { a: { default: { image: '/i.png' } }, b: { icon: 'home' } } } };
    const next = withPageNav(settings, { set: { position: 'top', activeBgColor: '#c2410c' }, icons: { a: 'euro', b: null } });
    expect(next.pageNav).toMatchObject({ logo: 'data:x', width: 180, position: 'top', activeBgColor: '#c2410c' });
    expect(next.pageNav.pageIcons).toEqual({ a: { default: { image: '/i.png' }, icon: 'euro' } });
    expect(pageIconOf(next.pageNav, 'a')).toBeTruthy();
    expect(pageIconOf(next.pageNav, 'b')).toBeNull();
  });

  test('what the assistant is told: the look and the icons, never an image', () => {
    expect(describePageNav({ logo: 'data:x', position: 'right', title: '', pageIcons: { a: { icon: 'map', default: { image: '/i.png' } } } }))
      .toEqual({ position: 'right', icons: { a: 'map' }, hasLogo: true });
  });

  test('colors by state: the menu own first, then the theme', () => {
    expect(navStateColors({ activeBgColor: '#111111', textColor: '#222222' }, 'active')).toEqual({ bg: '#111111', text: 'var(--accent-primary)' });
    expect(navStateColors({ textColor: '#222222' }, 'default')).toEqual({ bg: 'transparent', text: '#222222' });
  });
});

describe('the menu logo a design card sets', () => {
  test('set to the image the user added, taken off with null, left alone otherwise', () => {
    const set = withPageNav({ pageNav: { title: 'T' } }, { set: { logoSize: 48 }, icons: {}, logo: '/uploads/images/a.png' });
    expect(set.pageNav).toMatchObject({ title: 'T', logo: '/uploads/images/a.png', logoSize: 48 });
    expect(withPageNav(set, { set: {}, icons: {} }).pageNav.logo).toBe('/uploads/images/a.png');
    expect(withPageNav(set, { set: {}, icons: {}, logo: null }).pageNav.logo).toBeUndefined();
  });
});
