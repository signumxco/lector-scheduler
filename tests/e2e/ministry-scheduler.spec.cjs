const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const screenshotDir = 'test-results/screenshots';

async function capture(page, name) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ fullPage: true, path: `${screenshotDir}/${name}.png` });
}

test.describe('parish ministry scheduler admin console', () => {
  test('loads all-ministry calendar and groups Lectors with EMHC', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: 'Parish Ministries' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All ministries' })).toHaveClass(/active/);
    await expect(page.getByText('4:00 PM · Saturday Vigil').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Lectors 2 of 2/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /EMHC \d of 4/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /EMHC 2 of 4/ }).first()).toHaveAttribute('data-filled', 'false');
    await expect(page.locator('.calendar-day.blank')).toHaveCount(0);
    await expect(page.locator('.calendar-day-row').first()).toContainText('Saturday');
  });

  test('drills from a calendar ministry count into the filtered schedule queue', async ({ page }) => {
    await page.goto('/admin');

    await page.getByRole('button', { name: /EMHC 2 of 4/ }).first().click();

    await expect(page.getByRole('heading', { name: 'Eucharistic Ministers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Needs review/ })).toHaveAttribute('data-active', 'true');
    await expect(page.getByText('4 ministers needed').first()).toBeVisible();
    await expect(page.getByText('2 lectors needed')).toHaveCount(0);
  });

  test('switches workspace scope and filters schedule, volunteers, and Mass times', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Lectors', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Lectors' })).toBeVisible();
    await expect(page.getByText('2 lectors needed').first()).toBeVisible();
    await expect(page.getByText('5 ministers needed')).toHaveCount(0);

    await page.getByRole('button', { name: 'Volunteers', exact: true }).click();
    await expect(page.locator('.table-row').filter({ hasText: 'Grace Murphy' })).toBeVisible();
    await expect(page.locator('.table-row').filter({ hasText: 'Maria Santos' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Mass Times' }).click();
    await expect(page.getByText(/Sunday · Lectors/).first()).toBeVisible();
    await expect(page.getByText(/Sunday · EMHC/)).toHaveCount(0);
  });

  test('summary tiles and review tabs filter the work queue', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'EMHC', exact: true }).click();

    await page.getByRole('button', { name: /Needs review/ }).click();
    await expect(page.getByRole('button', { name: /Needs review/ })).toHaveAttribute('data-active', 'true');
    await expect(page.getByRole('button', { name: /Needs review/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Needs review/ }).locator('span')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('.schedule-card')).toHaveCount(13);

    await page.getByRole('button', { name: /^Reviewed/ }).click();
    await expect(page.getByRole('button', { name: /^Reviewed/ })).toHaveAttribute('data-active', 'true');
    await expect(page.getByText('Nothing approved yet')).toBeVisible();

    await page.getByRole('button', { name: /^All Masses/ }).click();
    await expect(page.getByRole('button', { name: /^All Masses/ })).toHaveAttribute('data-active', 'true');

    await page.getByRole('button', { name: /Active volunteers/ }).click();
    await expect(page.getByRole('heading', { name: 'Volunteers' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Active volunteers/ })).toHaveAttribute('data-active', 'true');
    await expect(page.getByText('Joan Weaver')).toHaveCount(0);

    await page.getByRole('button', { name: /All volunteers/ }).click();
    await expect(page.getByText('Joan Weaver')).toBeVisible();
  });

  test('keeps admin actions in one safe workflow with confirmations', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByRole('button', { name: 'Next: Review schedule' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Availability', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: /Request availability/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Build schedule from availability/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Send reminders/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Publish approved schedule/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Print sacristy sheet/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Preview volunteer experience/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Preview reminder email/ })).toBeVisible();

    await page.getByRole('menuitem', { name: /Request availability/ }).click();
    const availabilityPicker = page.getByRole('dialog', { name: 'Choose a ministry for availability' });
    await expect(availabilityPicker).toBeVisible();
    await availabilityPicker.getByRole('combobox').selectOption({ label: 'Lectors' });
    await availabilityPicker.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('dialog', { name: 'Request availability?' })).toBeVisible();
    await expect(page.getByText('Ministry: Lectors')).toBeVisible();
    await expect(page.getByText('Active volunteers:')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.toast')).toHaveCount(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Build schedule from availability/ }).click();
    await expect(page.getByRole('dialog', { name: 'Build schedule from availability?' })).toBeVisible();
    await page.getByRole('button', { name: 'Build draft schedule' }).click();
    await expect(page.locator('.toast')).toContainText('Draft schedule rebuilt');
    await page.getByLabel('Dismiss notification').click();

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Send reminders/ }).click();
    await expect(page.getByRole('dialog', { name: 'Send reminders?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Publish approved schedule/ }).click();
    await expect(page.getByRole('dialog', { name: 'Publish approved schedule?' })).toBeVisible();
    await page.getByRole('button', { name: 'Publish approved schedule' }).click();
    await expect(page.locator('.toast')).toContainText('Approved assignments are ready to publish');
  });

  test('opens demo volunteer preview links from the admin action menu', async ({ page, context }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Preview volunteer experience/ }).click();

    const previewDialog = page.getByRole('dialog', { name: 'Preview volunteer experience' });
    await expect(previewDialog).toBeVisible();

    const lectorPagePromise = context.waitForEvent('page');
    await previewDialog.getByRole('button', { name: /Lector availability form/ }).click();
    const lectorPage = await lectorPagePromise;
    await lectorPage.waitForLoadState();
    await expect(lectorPage).toHaveURL(/\/availability\?token=demo&ministry=lector/);
    await expect(lectorPage.getByText('Demo preview only')).toBeVisible();
    await lectorPage.close();

    const coveragePagePromise = context.waitForEvent('page');
    await previewDialog.getByRole('button', { name: /Coverage request form/ }).click();
    const coveragePage = await coveragePagePromise;
    await coveragePage.waitForLoadState();
    await expect(coveragePage).toHaveURL(/\/coverage\?token=demo/);
    await expect(coveragePage.getByText('Demo preview only')).toBeVisible();
    await coveragePage.close();
  });

  test('previews beautiful reminder emails for lector and EMHC roles', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Preview reminder email/ }).click();

    const dialog = page.getByRole('dialog', { name: 'Preview reminder email' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Lector 1' })).toHaveAttribute('data-active', 'true');
    await expect(page.frameLocator('.email-preview-frame').getByRole('heading', { name: /serving as Lector 1/ })).toBeVisible();
    await expect(page.frameLocator('.email-preview-frame').getByRole('heading', { name: 'First Reading' })).toBeVisible();
    await expect(page.frameLocator('.email-preview-frame').getByText('Please prepare for the First Reading')).toBeVisible();
    await expect(page.frameLocator('.email-preview-frame').getByText('Your reading')).toHaveCount(0);
    await expect(page.frameLocator('.email-preview-frame').getByRole('link', { name: 'View on USCCB' })).toHaveCount(1);

    await dialog.getByRole('button', { name: 'Lector 2' }).click();
    await expect(page.frameLocator('.email-preview-frame').getByRole('heading', { name: 'Second Reading' }).first()).toBeVisible();
    await expect(page.frameLocator('.email-preview-frame').getByText('Please prepare for the Second Reading')).toBeVisible();
    await expect(page.frameLocator('.email-preview-frame').getByText('announcements after Mass')).toBeVisible();

    await dialog.getByRole('button', { name: 'EMHC' }).click();
    await expect(page.frameLocator('.email-preview-frame').getByText('Please arrive a few minutes early')).toBeVisible();
    await expect(page.frameLocator('.email-preview-frame').getByText('Sunday readings')).toHaveCount(0);
  });

  test('prints a selected-ministry sacristy sign-off sheet', async ({ page }) => {
    await page.addInitScript(() => {
      window.__printed = false;
      window.print = () => {
        window.__printed = true;
      };
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Lectors', exact: true }).click();
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Print sacristy sheet/ }).click();

    await expect.poll(() => page.evaluate(() => window.__printed)).toBe(true);

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-sheet')).toBeVisible();
    await expect(page.locator('.print-sheet')).toContainText('Lectors Sign-Off Sheet');
    await expect(page.locator('.print-schedule-table thead')).toContainText('Date and Time');
    await expect(page.locator('.print-schedule-table thead')).toContainText('Lector #1');
    await expect(page.locator('.print-schedule-table thead')).toContainText('Lector #2');
    await expect(page.locator('.print-schedule-table thead')).not.toContainText('Lector #3');
    await expect(page.locator('.print-schedule-table thead').getByText('Sign In')).toHaveCount(2);
    await expect(page.locator('.print-schedule-table tbody tr')).toHaveCount(13);
    await expect(page.locator('.print-schedule-table tbody tr').first()).toContainText('Sat, Jun 6');
    await expect(page.locator('.print-sheet footer')).toContainText('Lector 1 does announcements');
    await expect(page.locator('.admin-sidebar')).toBeHidden();
    const hasLandscapePage = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) =>
        Array.from((() => {
          try {
            return sheet.cssRules;
          } catch {
            return [];
          }
        })()).some((rule) => rule.cssText.includes('letter landscape')),
      ),
    );
    expect(hasLandscapePage).toBe(true);
    await page.emulateMedia({ media: 'screen' });
  });

  test('asks for a ministry before printing from all ministries', async ({ page }) => {
    await page.addInitScript(() => {
      window.__printed = false;
      window.print = () => {
        window.__printed = true;
      };
    });

    await page.goto('/admin');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Print sacristy sheet/ }).click();

    const printDialog = page.getByRole('dialog', { name: 'Choose a ministry to print' });
    await expect(printDialog).toBeVisible();
    await printDialog.getByRole('combobox').selectOption({ label: 'Eucharistic Ministers' });
    await page.getByRole('button', { name: 'Print sacristy sheet' }).click();
    await expect.poll(() => page.evaluate(() => window.__printed)).toBe(true);

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.print-sheet')).toContainText('Eucharistic Ministers Sign-Off Sheet');
    await expect(page.locator('.print-schedule-table thead')).toContainText('Minister #1');
    await expect(page.locator('.print-schedule-table thead')).toContainText('Minister #6');
    await expect(page.locator('.print-schedule-table')).toContainText('Open');
    await page.emulateMedia({ media: 'screen' });
  });

  test('edits volunteer name, email, active status, and ministries', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: /All volunteers/ }).click();

    await page.getByLabel('Edit Maria Santos').click();
    const row = page.locator('.volunteer-edit-row');
    await row.getByLabel('Name').fill('Maria Santos Ruiz');
    await row.getByLabel('Email').fill('maria.ruiz@example.com');
    await row.getByLabel('Lectors').check();
    await row.getByLabel('Active').uncheck();
    await row.getByRole('button', { name: 'Save' }).click();

    const mariaRow = page.locator('.table-row').filter({ hasText: 'Maria Santos Ruiz' });
    await expect(mariaRow.getByText('Maria Santos Ruiz', { exact: true })).toBeVisible();
    await expect(mariaRow.getByText('maria.ruiz@example.com')).toBeVisible();
    await expect(mariaRow.getByLabel('Edit Maria Santos Ruiz')).toBeVisible();
    await expect(mariaRow.getByText('Lectors')).toBeVisible();
    await expect(mariaRow.getByText('EMHC')).toBeVisible();
    await expect(mariaRow.getByRole('button', { name: 'Paused' })).toBeVisible();

    await page.getByRole('button', { name: 'Lectors', exact: true }).click();
    await expect(page.locator('.table-row').filter({ hasText: 'Maria Santos Ruiz' })).toBeVisible();
  });

  test('fills openings in place, keeps full cards visible, supports rescheduling, and approval', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Lectors', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();

    const mass = page.locator('.schedule-card').filter({ hasText: 'Sunday, June 7 at 10:30 AM' }).first();
    await expect(mass.getByText('Opening')).toBeVisible();
    const cardTitlesBeforeFill = await page.locator('.schedule-card h3').allTextContents();
    const massIndexBeforeFill = cardTitlesBeforeFill.indexOf('Sunday, June 7 at 10:30 AM');

    await expect(mass.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await mass.getByLabel(/Fill opening 1/).selectOption({ label: 'Daniel Kim' });
    await expect(mass.getByText('Opening')).toHaveCount(0);
    await expect(mass).toBeVisible();
    await expect(mass.locator('.status-pill.draft')).toContainText('Draft');
    const cardTitlesAfterFill = await page.locator('.schedule-card h3').allTextContents();
    expect(cardTitlesAfterFill.indexOf('Sunday, June 7 at 10:30 AM')).toBe(massIndexBeforeFill);

    await mass.getByLabel('Remove Grace Murphy').click();
    await expect(mass.getByText('Opening')).toBeVisible();
    await expect(mass.getByText('Daniel Kim')).toBeVisible();
    await expect(mass.getByText('Lector 1')).toBeVisible();

    await mass.getByLabel(/Fill opening 1/).selectOption({ label: 'Elena Price' });
    await expect(mass.getByText('Opening')).toHaveCount(0);
    await expect(mass.getByText('Elena Price')).toBeVisible();
    await expect(mass.getByText('Lector 2')).toBeVisible();

    await mass.getByRole('button', { name: 'Approve' }).click();
    await expect(mass).toHaveCount(0);
    await page.getByRole('button', { name: /^Reviewed/ }).click();
    const reviewedMass = page.locator('.schedule-card').filter({ hasText: 'Sunday, June 7 at 10:30 AM' }).first();
    await expect(reviewedMass.locator('.status-pill.approved')).toContainText('Approved');
  });

  test('toast floats bottom-left and dismisses automatically', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'EMHC', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();

    await page.locator('.schedule-card').first().getByRole('button', { name: 'Approve' }).click();

    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('marked approved');
    await expect(toast).toHaveCSS('position', 'fixed');
    const box = await toast.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport ? box.x < viewport.width / 2 && box.y > viewport.height / 2 : false).toBe(true);
    await expect(toast).toBeHidden({ timeout: 11_500 });
  });

  test('EMHC schedule does not offer Lector-only volunteers', async ({ page }) => {
    await page.goto('/admin');
    await page.getByRole('button', { name: 'EMHC', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();

    const mass = page.locator('.schedule-card').filter({ hasText: 'Sunday, June 7 at 10:30 AM' }).first();
    await expect(mass.getByLabel(/Fill opening 1/)).toContainText('Maria Santos');
    await expect(mass.getByLabel(/Fill opening 1/)).not.toContainText('Grace Murphy');
  });
});

test.describe('volunteer-facing flows', () => {
  test('submits Lector availability and handles missing token', async ({ page }) => {
    await page.goto('/availability?token=demo&ministry=lector');

    await expect(page.getByText('Demo preview only')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lectors Availability' })).toBeVisible();
    const firstCard = page.locator('.availability-card').nth(1);
    await firstCard.click();
    await expect(firstCard).toHaveClass(/available/);
    await firstCard.click();
    await expect(firstCard).toHaveClass(/unavailable/);
    await firstCard.click();
    await expect(firstCard).not.toHaveClass(/available|unavailable/);

    await page.getByRole('button', { name: 'Submit availability' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Availability saved' })).toBeVisible();

    await page.goto('/availability');
    await expect(page.getByText('missing a token')).toBeVisible();
  });

  test('submits EMHC availability', async ({ page }) => {
    await page.goto('/availability?token=demo&ministry=emhc');

    await expect(page.getByText('Demo preview only')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EMHC Availability' })).toBeVisible();
    await expect(page.getByText(/ministers needed/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Submit availability' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Availability saved' })).toBeVisible();
  });

  test('requests coverage', async ({ page }) => {
    await page.goto('/coverage?token=demo');

    await expect(page.getByText('Demo preview only')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request Coverage' })).toBeVisible();
    await page.getByRole('button', { name: 'Request coverage' }).click();
    await expect(page.getByRole('heading', { name: 'Coverage requested' })).toBeVisible();
  });
});

test.describe('mobile responsiveness', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ['/admin', '/availability?token=demo&ministry=emhc', '/coverage?token=demo']) {
    test(`has no horizontal overflow on ${path}`, async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
    });
  }

  test('mobile admin calendar and switcher remain usable', async ({ page }) => {
    await page.goto('/admin');

    await expect(page.getByRole('button', { name: 'All ministries' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lectors 2 of 2/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'EMHC', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Eucharistic Ministers' })).toBeVisible();
  });
});

test.describe('requested screenshot pass', () => {
  test('captures admin, schedule editing, mobile, availability, and coverage states', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await capture(page, 'all-ministries-calendar');

    await page.getByRole('button', { name: 'Lectors', exact: true }).click();
    await page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await capture(page, 'lector-schedule');

    const lectorMass = page.locator('.schedule-card').filter({ hasText: 'Sunday, June 7 at 10:30 AM' }).first();
    await lectorMass.getByLabel(/Fill opening 1/).selectOption({ label: 'Daniel Kim' });
    await capture(page, 'full-slot-mass');

    await lectorMass.getByLabel('Remove Grace Murphy').click();
    await lectorMass.getByLabel(/Fill opening 1/).selectOption({ label: 'Elena Price' });
    await capture(page, 'rescheduled-mass');

    await page.getByRole('button', { name: 'EMHC', exact: true }).click();
    await capture(page, 'emhc-schedule');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Preview reminder email/ }).click();
    const reminderDialog = page.getByRole('dialog', { name: 'Preview reminder email' });
    await capture(page, 'reminder-email-lector-1');
    await reminderDialog.getByRole('button', { name: 'Lector 2' }).click();
    await capture(page, 'reminder-email-lector-2');
    await reminderDialog.getByRole('button', { name: 'EMHC' }).click();
    await capture(page, 'reminder-email-emhc');
    await reminderDialog.getByRole('button', { name: 'Close' }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await capture(page, 'mobile-admin-calendar');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /Preview reminder email/ }).click();
    await capture(page, 'mobile-reminder-email');
    await page.getByRole('dialog', { name: 'Preview reminder email' }).getByRole('button', { name: 'Close' }).click();

    await page.goto('/availability?token=demo&ministry=emhc');
    await expect(page.getByRole('heading', { name: 'EMHC Availability' })).toBeVisible();
    await capture(page, 'mobile-volunteer-availability');

    await page.goto('/coverage?token=demo');
    await expect(page.getByRole('heading', { name: 'Request Coverage' })).toBeVisible();
    await capture(page, 'coverage-request-page');
  });
});
