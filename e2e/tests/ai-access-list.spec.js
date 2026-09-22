// Admin › AI › "Who has the assistant": a list an admin can actually use once
// the instance has more than a handful of accounts — paged, searchable, and
// able to show only the accounts the assistant was taken away from.
//
// In a browser because the defect it guards was invisible anywhere else: a
// search that does not send the pager back to page 1 leaves the admin on
// "page 2 of a one-page result", an empty list that looks like "no such user".
const { test, expect } = require('@playwright/test');

const STAMP = Date.now();
const email = (n) => `ai-list-${STAMP}-${String(n).padStart(2, '0')}@example.test`;

test('the access list pages, searches from page 1, and filters on refused accounts', async ({ page }) => {
  const created = [];
  try {
    // Enough accounts for a second page (10 per page), whatever the seed holds.
    for (let n = 1; n <= 12; n++) {
      const res = await page.request.post('/api/admin/users', {
        data: { email: email(n), password: `Passw0rd!-${STAMP}-${n}`, displayName: `Listed ${String(n).padStart(2, '0')}`, role: 'editor' },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
      created.push((await res.json()).user.id);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin?tab=ai');
    const rows = page.getByRole('button', { name: /^AI assistant for / });
    await expect(page.getByText('Who has the assistant')).toBeVisible();
    await expect(rows).toHaveCount(10);

    // Onto page 2, then a search whose result STILL spans two pages (12 matches):
    // the pager only falls back to page 1 by itself when the current page no
    // longer exists, so this is the case where a missing reset shows — the
    // admin would be left on matches 11–12, the first ten out of sight.
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByRole('button', { name: 'AI assistant for Listed 12' })).toBeVisible();
    await page.getByLabel('Search a user').fill('Listed');
    await expect(page.getByRole('button', { name: 'AI assistant for Listed 01' })).toBeVisible();
    await expect(rows).toHaveCount(10);

    await page.getByLabel('Search a user').fill('Listed 03');
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'AI assistant for Listed 03' })).toBeVisible();

    // Take the assistant away from that account; the server agrees.
    await page.getByRole('button', { name: 'AI assistant for Listed 03' }).click();
    await expect(page.getByRole('button', { name: 'AI assistant for Listed 03' })).toHaveText('No assistant');
    const users = (await (await page.request.get('/api/admin/users')).json()).users;
    expect(users.find((u) => u.email === email(3)).aiDenied).toBe(true);

    // The short list an admin comes back for: only the refused accounts.
    await page.getByLabel('Search a user').fill('');
    await page.getByLabel(/Without access only \(1\)/).check();
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'AI assistant for Listed 03' })).toBeVisible();

    // By e-mail too, and a search with no match says so instead of going blank.
    await page.getByLabel(/Without access only/).uncheck();
    await page.getByLabel('Search a user').fill(email(7));
    await expect(page.getByRole('button', { name: 'AI assistant for Listed 07' })).toBeVisible();
    await page.getByLabel('Search a user').fill('nobody-by-that-name');
    await expect(page.getByText('No account matches')).toBeVisible();
  } finally {
    for (const id of created) await page.request.delete(`/api/admin/users/${id}`);
  }
});
