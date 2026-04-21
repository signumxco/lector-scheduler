// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

// ── Helpers ──────────────────────────────────────────────────────────────────

const availURL = (token = '') =>
  `file://${path.resolve(__dirname, '../web/availability.html')}${token ? `?token=${token}` : ''}`;

const swapURL = (token = '', mass = '') =>
  `file://${path.resolve(__dirname, '../web/swap.html')}${token ? `?token=${token}${mass ? '&mass=' + encodeURIComponent(mass) : ''}` : ''}`;

const confirmURL = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return `file://${path.resolve(__dirname, '../web/confirm.html')}${qs ? '?' + qs : ''}`;
};

/** Mock mass data returned by the Apps Script endpoint */
const MOCK_MASSES = [
  { massDateTime: '2025-05-03 09:00', label: 'Sunday 9:00 AM',  massType: '', lectorsNeeded: 2, dayOfWeek: 'Saturday', time: '09:00', date: '2025-05-03', available: null },
  { massDateTime: '2025-05-03 11:00', label: 'Sunday 11:00 AM', massType: '', lectorsNeeded: 2, dayOfWeek: 'Sunday',   time: '11:00', date: '2025-05-03', available: null },
  { massDateTime: '2025-05-10 09:00', label: 'Sunday 9:00 AM',  massType: '', lectorsNeeded: 2, dayOfWeek: 'Sunday',   time: '09:00', date: '2025-05-10', available: null },
  { massDateTime: '2025-05-17 09:00', label: 'Sunday 9:00 AM',  massType: '', lectorsNeeded: 2, dayOfWeek: 'Sunday',   time: '09:00', date: '2025-05-17', available: null },
  { massDateTime: '2025-05-17 11:00', label: 'Sunday 11:00 AM', massType: '', lectorsNeeded: 2, dayOfWeek: 'Sunday',   time: '11:00', date: '2025-05-17', available: null },
];

// Special-mass mock — uses free-text MassType values, not a boolean
const MOCK_TRIDUUM_MASSES = [
  { massDateTime: '2025-04-17 19:00', label: 'Holy Thursday', massType: 'Triduum',  lectorsNeeded: 2, dayOfWeek: 'Thursday', time: '19:00', date: '2025-04-17', available: null },
  { massDateTime: '2025-04-18 15:00', label: 'Good Friday',   massType: 'Triduum',  lectorsNeeded: 2, dayOfWeek: 'Friday',   time: '15:00', date: '2025-04-18', available: null },
  { massDateTime: '2025-04-19 20:30', label: 'Easter Vigil',  massType: 'Triduum',  lectorsNeeded: 2, dayOfWeek: 'Saturday', time: '20:30', date: '2025-04-19', available: null },
];

const MOCK_ASSIGNMENTS = [
  { massDateTime: '2025-05-03 09:00', label: 'Sunday 9:00 AM', role: 'Lector 1' },
  { massDateTime: '2025-05-17 11:00', label: 'Sunday 11:00 AM', role: 'Lector 2' },
];

/**
 * Patches APPS_SCRIPT_URL to a fake sentinel so the page's init guard passes,
 * then intercepts all fetch() calls made to that sentinel.
 *
 * Strategy:
 *  - Intercept the .html file request via page.route, read it from disk with
 *    fs.readFileSync (file:// URLs are not fetchable in Node), replace the
 *    placeholder constant, and serve the patched HTML.
 *  - Intercept HTTPS requests to the fake sentinel URL and respond with JSON
 *    from the provided mock handlers.
 */
async function patchAndIntercept(page, mockGetHandler, mockPostHandler) {
  const FAKE_URL = 'https://mock.apps-script.invalid/exec';
  const PLACEHOLDER = "const APPS_SCRIPT_URL = 'YOUR_APPS_SCRIPT_URL_HERE';";
  const REPLACEMENT  = `const APPS_SCRIPT_URL = '${FAKE_URL}';`;

  await page.route('**', async route => {
    const req     = route.request();
    const reqUrl  = req.url();

    // ── Serve patched HTML from disk ──────────────────────────────────────
    // Strip query string before checking extension — file:// URLs with tokens
    // look like file:///path/foo.html?token=abc, so .endsWith('.html') fails.
    const reqPathOnly = reqUrl.split('?')[0];
    if (reqUrl.startsWith('file://') && reqPathOnly.endsWith('.html')) {
      // Convert file:// URL → absolute filesystem path (no query string)
      const filePath = decodeURIComponent(reqPathOnly.replace(/^file:\/\//, ''));
      let body;
      try {
        body = fs.readFileSync(filePath, 'utf-8');
      } catch (e) {
        await route.abort();
        return;
      }
      body = body.replace(PLACEHOLDER, REPLACEMENT);
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      return;
    }

    // ── Mock the Apps Script API ──────────────────────────────────────────
    if (reqUrl.startsWith(FAKE_URL)) {
      if (req.method() === 'GET' && mockGetHandler) {
        const result = await mockGetHandler(new URL(reqUrl));
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(result),
        });
      } else if (req.method() === 'POST' && mockPostHandler) {
        let posted = {};
        try { posted = req.postDataJSON(); } catch (_) {}
        const result = await mockPostHandler(posted);
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(result),
        });
      } else {
        await route.fulfill({ contentType: 'application/json', body: '{}' });
      }
      return;
    }

    // ── Pass everything else through (Google Fonts, etc.) ─────────────────
    await route.continue();
  });
}

// ── availability.html tests ───────────────────────────────────────────────────

test.describe('availability.html', () => {

  test('shows error when no token in URL', async ({ page }) => {
    await page.goto(availURL());
    // Error state should be visible
    const errorPanel = page.locator('#error');
    await expect(errorPanel).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#error-message')).toContainText('No token found');
  });

  test('shows error when system not configured (placeholder URL)', async ({ page }) => {
    // Load with a token but without replacing the placeholder URL
    await page.goto(availURL('test-token-abc'));
    const errorPanel = page.locator('#error');
    await expect(errorPanel).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#error-message')).toContainText('not yet configured');
  });

  test('shows loading state then renders calendar with mock data', async ({ page }) => {
    await patchAndIntercept(page, url => {
      const action = url.searchParams.get('action');
      if (action === 'getAvailabilityData') {
        return {
          lectorName: 'Jane Smith',
          lectorEmail: 'jane@parish.org',
          month: 5,
          year: 2025,
          monthName: 'May',
          masses: MOCK_MASSES,
        };
      }
      return { error: 'Unknown action' };
    });

    await page.goto(availURL('valid-token-123'));

    // Calendar should render
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });
    // Lector name should appear
    await expect(page.locator('#lector-name-heading')).toContainText('Jane Smith');
    // Header month label
    await expect(page.locator('#header-subtitle')).toContainText('May 2025');
    // Mass cards should be rendered
    const cards = page.locator('.mass-card');
    await expect(cards).toHaveCount(MOCK_MASSES.length);
    // Footer bar appears
    await expect(page.locator('#footer-bar')).toBeVisible();
    // Submit button disabled until at least one answered
    await expect(page.locator('#btn-submit')).toBeDisabled();
  });

  test('toggling a Mass card cycles through available → unavailable → unset', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org',
      month: 5, year: 2025, monthName: 'May', masses: MOCK_MASSES,
    }));

    await page.goto(availURL('valid-token-123'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    const firstCard = page.locator('.mass-card').first();

    // Tap once → available (gold)
    await firstCard.click();
    await expect(firstCard).toHaveClass(/available/);
    const ind1 = firstCard.locator('.mass-indicator');
    await expect(ind1).toContainText('✓');
    // Submit button should now be enabled
    await expect(page.locator('#btn-submit')).toBeEnabled();

    // Tap again → unavailable (red)
    await firstCard.click();
    await expect(firstCard).toHaveClass(/unavailable/);
    await expect(ind1).toContainText('✕');

    // Tap once more → unset (no class)
    await firstCard.click();
    await expect(firstCard).not.toHaveClass(/available/);
    await expect(firstCard).not.toHaveClass(/unavailable/);
    await expect(ind1).toHaveText('');
    // Submit disabled again (nothing answered)
    await expect(page.locator('#btn-submit')).toBeDisabled();
  });

  test('counter updates as cards are toggled', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org',
      month: 5, year: 2025, monthName: 'May', masses: MOCK_MASSES,
    }));

    await page.goto(availURL('valid-token-123'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    // Initially 0 answered
    await expect(page.locator('#submit-count')).toContainText('0');

    const cards = page.locator('.mass-card');
    await cards.nth(0).click(); // available
    await expect(page.locator('#submit-count')).toContainText('1');

    await cards.nth(1).click(); // available
    await cards.nth(1).click(); // unavailable
    await expect(page.locator('#submit-count')).toContainText('2');

    await cards.nth(2).click();
    await expect(page.locator('#submit-count')).toContainText('3');
  });

  test('successful submission shows confirmation and hides footer', async ({ page }) => {
    let postedBody = null;

    await patchAndIntercept(
      page,
      () => ({
        lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org',
        month: 5, year: 2025, monthName: 'May', masses: MOCK_MASSES,
      }),
      body => {
        postedBody = body;
        return { success: true, message: 'Thank you, Jane Smith! Your availability has been saved.' };
      }
    );

    await page.goto(availURL('valid-token-123'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    // Mark a few masses
    const cards = page.locator('.mass-card');
    await cards.nth(0).click(); // available
    await cards.nth(1).click(); // available
    await cards.nth(1).click(); // unavailable
    await cards.nth(2).click(); // available

    await page.locator('#btn-submit').click();

    // Success panel should appear
    await expect(page.locator('#success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#success-message')).toContainText('Jane Smith');
    // Footer should be hidden
    await expect(page.locator('#footer-bar')).not.toBeVisible();

    // Verify the POST body had the right action and selections
    expect(postedBody.action).toBe('submitAvailability');
    expect(postedBody.token).toBe('valid-token-123');
    expect(Array.isArray(postedBody.selections)).toBe(true);
    expect(postedBody.selections.length).toBe(3);
    const avail = postedBody.selections.filter(s => s.available === true);
    const unavail = postedBody.selections.filter(s => s.available === false);
    expect(avail.length).toBe(2);
    expect(unavail.length).toBe(1);
  });

  test('API error on submit shows alert without navigating away', async ({ page }) => {
    await patchAndIntercept(
      page,
      () => ({ lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org', month: 5, year: 2025, monthName: 'May', masses: MOCK_MASSES }),
      () => ({ error: 'Token already used.' })
    );

    await page.goto(availURL('valid-token-123'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });
    await page.locator('.mass-card').first().click();

    // Register dialog handler BEFORE clicking — alert fires inside the await fetch chain
    const dialogPromise = page.waitForEvent('dialog');
    await page.locator('#btn-submit').click();
    const dialog = await dialogPromise;
    const alertMsg = dialog.message();
    await dialog.accept();

    // Main view should still be visible (not success state)
    await expect(page.locator('#main')).toBeVisible();
    expect(alertMsg).toContain('Token already used');
    // Button re-enabled after error
    await expect(page.locator('#btn-submit')).toBeEnabled();
  });

  test('special-type masses show MassType badge and violet styling', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org',
      month: 4, year: 2025, monthName: 'April', masses: MOCK_TRIDUUM_MASSES,
    }));

    await page.goto(availURL('valid-token-456'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    const cards = page.locator('.mass-card');
    await expect(cards).toHaveCount(3);

    // All three should have the special-mass class (non-blank massType)
    for (let i = 0; i < 3; i++) {
      await expect(cards.nth(i)).toHaveClass(/special-mass/);
    }

    // Badge displays the MassType value verbatim ("Triduum")
    const badges = page.locator('.holy-week-badge');
    await expect(badges).toHaveCount(3);
    await expect(badges.first()).toContainText('Triduum');
  });

  test('pre-populated availability from existing submission', async ({ page }) => {
    const massesWithExisting = MOCK_MASSES.map((m, i) => ({
      ...m,
      available: i === 0 ? true : i === 1 ? false : null,
    }));

    await patchAndIntercept(page, () => ({
      lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org',
      month: 5, year: 2025, monthName: 'May', masses: massesWithExisting,
    }));

    await page.goto(availURL('valid-token-123'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    const cards = page.locator('.mass-card');
    // First card pre-set to available
    await expect(cards.first()).toHaveClass(/available/);
    // Second card pre-set to unavailable
    await expect(cards.nth(1)).toHaveClass(/unavailable/);
    // Third card unset
    await expect(cards.nth(2)).not.toHaveClass(/available/);
    await expect(cards.nth(2)).not.toHaveClass(/unavailable/);

    // Counter shows 2 pre-answered
    await expect(page.locator('#submit-count')).toContainText('2');
  });

  test('error state shown when API returns error', async ({ page }) => {
    await patchAndIntercept(page, () => ({ error: 'Invalid or expired token.' }));

    await page.goto(availURL('bad-token'));
    await expect(page.locator('#error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#error-message')).toContainText('Invalid or expired token');
  });

});

// ── swap.html tests ───────────────────────────────────────────────────────────

test.describe('swap.html', () => {

  test('shows error when no token in URL', async ({ page }) => {
    await page.goto(swapURL());
    await expect(page.locator('#error')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#error-message')).toContainText('No token found');
  });

  test('renders assignment cards with mock data', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Bob Johnson',
      lectorEmail: 'bob@parish.org',
      assignments: MOCK_ASSIGNMENTS,
    }));

    await page.goto(swapURL('swap-token-xyz'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    await expect(page.locator('#lector-name')).toContainText('Bob Johnson');
    const cards = page.locator('.assignment-card');
    await expect(cards).toHaveCount(2);
    // Submit button disabled — nothing selected
    await expect(page.locator('#btn-submit')).toBeDisabled();
  });

  test('selecting a card enables submit and shows gold border', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Bob Johnson',
      lectorEmail: 'bob@parish.org',
      assignments: MOCK_ASSIGNMENTS,
    }));

    await page.goto(swapURL('swap-token-xyz'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    const firstCard = page.locator('.assignment-card').first();
    await firstCard.click();
    await expect(firstCard).toHaveClass(/selected/);
    await expect(page.locator('#btn-submit')).toBeEnabled();
  });

  test('clicking selected card again deselects it', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Bob Johnson',
      lectorEmail: 'bob@parish.org',
      assignments: MOCK_ASSIGNMENTS,
    }));

    await page.goto(swapURL('swap-token-xyz'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    const firstCard = page.locator('.assignment-card').first();
    await firstCard.click();
    await expect(page.locator('#btn-submit')).toBeEnabled();
    await firstCard.click();
    await expect(firstCard).not.toHaveClass(/selected/);
    await expect(page.locator('#btn-submit')).toBeDisabled();
  });

  test('selecting second card deselects the first', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Bob Johnson',
      lectorEmail: 'bob@parish.org',
      assignments: MOCK_ASSIGNMENTS,
    }));

    await page.goto(swapURL('swap-token-xyz'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    const cards = page.locator('.assignment-card');
    await cards.first().click();
    await expect(cards.first()).toHaveClass(/selected/);

    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveClass(/selected/);
    await expect(cards.first()).not.toHaveClass(/selected/);
  });

  test('successful swap submission shows success state', async ({ page }) => {
    let postedBody = null;

    await patchAndIntercept(
      page,
      () => ({ lectorName: 'Bob Johnson', lectorEmail: 'bob@parish.org', assignments: MOCK_ASSIGNMENTS }),
      body => {
        postedBody = body;
        return {
          success: true,
          message: 'Your swap request has been sent to all lectors.',
          massDateTime: body.massDateTime,
        };
      }
    );

    await page.goto(swapURL('swap-token-xyz'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    await page.locator('.assignment-card').first().click();
    await page.locator('#btn-submit').click();

    await expect(page.locator('#success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#success-message')).toContainText('all lectors');

    expect(postedBody.action).toBe('requestSwap');
    expect(postedBody.token).toBe('swap-token-xyz');
    expect(postedBody.massDateTime).toBe(MOCK_ASSIGNMENTS[0].massDateTime);
  });

  test('preselected mass via URL param is highlighted on load', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Bob Johnson',
      lectorEmail: 'bob@parish.org',
      assignments: MOCK_ASSIGNMENTS.map((a, i) => ({ ...a, selected: i === 1 })),
    }));

    const preselect = MOCK_ASSIGNMENTS[1].massDateTime;
    await page.goto(swapURL('swap-token-xyz', preselect));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    // Second card should be selected
    const cards = page.locator('.assignment-card');
    await expect(cards.nth(1)).toHaveClass(/selected/);
    await expect(page.locator('#btn-submit')).toBeEnabled();
  });

  test('shows no-assignments message when lector has no assignments', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Bob Johnson',
      lectorEmail: 'bob@parish.org',
      assignments: [],
    }));

    await page.goto(swapURL('swap-token-xyz'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#assignment-list')).toContainText('No approved assignments');
  });

});

// ── confirm.html tests ────────────────────────────────────────────────────────

test.describe('confirm.html', () => {

  test('default state (no params) shows generic thank you', async ({ page }) => {
    await page.goto(confirmURL());
    // JS sets "Thank you!" (lowercase y) — use case-insensitive match
    await expect(page.locator('#main-heading')).toContainText(/thank you/i);
    await expect(page.locator('.check-circle')).toBeVisible();
  });

  test('availability type with name and month shows personalized message', async ({ page }) => {
    await page.goto(confirmURL({ type: 'availability', name: 'Jane Smith', month: 'May 2025' }));
    await expect(page.locator('#main-heading')).toContainText('Jane Smith');
    await expect(page.locator('#header-title')).toContainText('Availability Saved');
    await expect(page.locator('#main-message')).toContainText('May 2025');
  });

  test('swap type shows swap-specific content and what-happens-next section', async ({ page }) => {
    await page.goto(confirmURL({
      type: 'swap',
      name: 'Bob Johnson',
      mass: '2025-05-03 09:00',
    }));
    await expect(page.locator('#header-title')).toContainText('Request Sent');
    await expect(page.locator('#main-heading')).toContainText('Bob Johnson');
    await expect(page.locator('#next-steps')).toBeVisible();
    await expect(page.locator('#next-steps')).toContainText('What happens next');
    // Mass detail card shown
    await expect(page.locator('#detail-card')).toBeVisible();
    await expect(page.locator('#detail-card')).toContainText('Mass needing coverage');
  });

  test('gold check circle is visible and animated', async ({ page }) => {
    await page.goto(confirmURL({ type: 'availability', name: 'Jane' }));
    const circle = page.locator('.check-circle');
    await expect(circle).toBeVisible();
    // Verify the gold background via computed style: rgb(212, 168, 67)
    const bg = await circle.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toMatch(/rgb\(212,\s*168,\s*67\)/);
    // SVG checkmark is inside
    await expect(circle.locator('svg')).toBeAttached();
  });

  test('swap type without mass param hides detail card', async ({ page }) => {
    await page.goto(confirmURL({ type: 'swap', name: 'Bob' }));
    await expect(page.locator('#detail-card')).not.toBeVisible();
    await expect(page.locator('#next-steps')).toBeVisible();
  });

});

// ── Mobile viewport tests ─────────────────────────────────────────────────────

test.describe('Mobile (375px — iPhone SE)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('availability page renders and mass cards are tappable at 375px', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org',
      month: 5, year: 2025, monthName: 'May', masses: MOCK_MASSES,
    }));

    await page.goto(availURL('mobile-token'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });

    const cards = page.locator('.mass-card');
    await expect(cards).toHaveCount(MOCK_MASSES.length);

    // Each card must be at least 48px tall (min tap target)
    const firstHeight = await cards.first().evaluate(el => el.getBoundingClientRect().height);
    expect(firstHeight).toBeGreaterThanOrEqual(48);

    // Can tap
    await cards.first().click();
    await expect(cards.first()).toHaveClass(/available/);
  });

  test('swap page renders assignment cards at 375px', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Bob Johnson', lectorEmail: 'bob@parish.org',
      assignments: MOCK_ASSIGNMENTS,
    }));

    await page.goto(swapURL('mobile-swap'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });
    const cards = page.locator('.assignment-card');
    await expect(cards).toHaveCount(2);
    const height = await cards.first().evaluate(el => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(48);
  });

  test('confirm page renders correctly at 375px', async ({ page }) => {
    await page.goto(confirmURL({ type: 'availability', name: 'Jane', month: 'May 2025' }));
    await expect(page.locator('.check-circle')).toBeVisible();
    await expect(page.locator('#main-heading')).toBeVisible();
  });
});

// ── Tablet viewport tests ─────────────────────────────────────────────────────

test.describe('Tablet (768px — iPad)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('availability page renders at 768px width', async ({ page }) => {
    await patchAndIntercept(page, () => ({
      lectorName: 'Jane Smith', lectorEmail: 'jane@parish.org',
      month: 5, year: 2025, monthName: 'May', masses: MOCK_MASSES,
    }));

    await page.goto(availURL('tablet-token'));
    await expect(page.locator('#main')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.mass-card')).toHaveCount(MOCK_MASSES.length);
  });
});
