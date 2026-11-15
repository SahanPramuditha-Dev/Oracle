import { expect, test } from '@playwright/test';

test.use({ baseURL: process.env.ORACLE_TEST_URL || 'http://127.0.0.1:5173' });

test('camera exposes capture and automatic product scanning in one view', async ({ page }) => {
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: {} }));
  let scans = 0;
  await page.route('**/api/v1/vision/products/inspect', route => {
    expect(route.request().headers()['x-oracle-product-mode']).toBe('auto');
    scans++;
    return route.fulfill({ json: {
      product_status: 'uncertain',
      evidence: [{ kind: 'ocr', value: 'Example packet', confidence: .94 }],
    } });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 640;
        const context = canvas.getContext('2d')!;
        context.fillStyle = 'white';
        for (let x = 0; x < 360; x += 30) context.fillRect(x, 0, 15, 640);
        return canvas.captureStream(10);
      },
    });
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  await page.getByTitle('Toggle optical vision feed', { exact: true }).click();

  const camera = page.locator('.oracle-camera-card');
  await expect(camera.getByRole('group', { name: 'Camera mode' })).toHaveCount(0);
  await expect(camera.locator('.camera-viewport-frame')).toHaveCSS('aspect-ratio', '360 / 640');

  const scanner = page.getByRole('region', { name: 'Product details' });
  await expect(camera.getByRole('button', { name: 'Scan product' })).toHaveCount(0);
  await expect(scanner.getByText('Example packet', { exact: true })).toBeVisible();
  await scanner.getByRole('button', { name: 'Pin result' }).click();
  await expect(scanner.getByRole('button', { name: 'Unpin result' })).toHaveAttribute('aria-pressed', 'true');
  await camera.getByRole('button', { name: 'Expand camera' }).click();
  await expect(page.locator('.oracle-camera-workspace')).toHaveClass(/is-expanded/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.oracle-camera-workspace')).not.toHaveClass(/is-expanded/);
  await expect(scanner.getByText('Example packet', { exact: true })).toBeVisible();
  await expect(camera.getByRole('button', { name: 'Expand camera' })).toBeFocused();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('oracle_camera_command', { detail: 'expand' })));
  await expect(page.locator('.oracle-camera-workspace')).toHaveClass(/is-expanded/);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('oracle_camera_command', { detail: 'collapse' })));
  await expect(scanner.getByLabel('Search local catalog')).toBeHidden();
  await scanner.getByText('Search catalog', { exact: true }).click();
  await expect(scanner.getByLabel('Search local catalog')).toBeVisible();
  await camera.getByRole('button', { name: 'Camera settings' }).click();
  await expect(camera.getByLabel('Auto-identify products')).toBeChecked();
  await camera.getByLabel('Auto-identify products').uncheck();
  await expect(camera.getByRole('button', { name: 'Scan product' })).toHaveClass(/\bprimary\b/);
  await expect(scanner.getByRole('button', { name: 'Unpin result' })).toBeVisible();
  expect(scans).toBe(1);

  await camera.getByRole('button', { name: 'Capture & ask' }).click();
  const reader = page.getByRole('region', { name: 'Visual Analysis & OCR' });
  await expect(reader.getByLabel('Text or image description')).toBeVisible();
  await reader.getByRole('button', { name: 'Crop' }).click();
  await reader.getByLabel('Crop x', { exact: true }).fill('40');
  await expect(reader.getByRole('button', { name: 'Read Text & QR' })).toBeDisabled();
  await reader.getByLabel('Crop width', { exact: true }).fill('60');
  await expect(reader.getByRole('button', { name: 'Read Text & QR' })).toBeEnabled();
});
