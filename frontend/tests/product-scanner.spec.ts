import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.ORACLE_TEST_URL || 'http://127.0.0.1:5173' });

test('product scanner opens without camera permission and saves a corrected upload', async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/vision/products/inspect', (route) => route.fulfill({ json: {
    product_status: 'uncertain',
    brand: { name: 'Sprite' },
    product: { barcode: '4006381333931' },
    evidence: [{ kind: 'ocr', value: 'Sprite', confidence: .9 }],
    needs_more_evidence: true,
  } }));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  await page.getByRole('button', { name: 'Applications Menu' }).click();
  await page.getByRole('button', { name: 'Identify product', exact: true }).click();
  const scanner = page.getByRole('region', { name: 'Identify product' });
  await scanner.getByLabel('Upload photo').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(scanner.getByRole('status')).toHaveText('Brand only');
  await expect(scanner.getByText('Brand · Sprite')).toBeVisible();
  await scanner.getByRole('button', { name: 'Enter product manually' }).click();
  await scanner.getByRole('textbox', { name: 'Product', exact: true }).fill('Lemon-lime drink');
  await scanner.getByRole('button', { name: 'Save product' }).click();
  await scanner.getByText('Saved products (1)').click();
  await expect(scanner.getByText('Sprite Lemon-lime drink')).toBeVisible();
  await scanner.getByRole('button', { name: 'Delete Lemon-lime drink' }).click();
  await expect(scanner.getByText('Saved products (1)')).toHaveCount(0);
});
