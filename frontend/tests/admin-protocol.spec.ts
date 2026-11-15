import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('oracle_session_initialized', 'true');
    localStorage.setItem('oracle_has_initialized', 'true');
    localStorage.setItem('oracle_admin_override', 'true');
  });
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: { authenticated: true } }));
  await page.route('**/api/v1/admin/attempts', route =>
    route.fulfill({ json: { id: 'test-attempt', expires_in_seconds: 120 } })
  );
  await page.route('**/api/v1/admin/attempts/test-attempt', route =>
    route.fulfill({ json: { status: 'cancelled' } })
  );

  await page.route('**/api/v1/people', route =>
    route.fulfill({
      json: {
        people: [
          {
            id: 'admin-01',
            name: 'Dr. Oracle Admin',
            permission: 'administrator',
            relationship: 'Operator',
            notes: 'Primary Root Administrator',
            enrollment_state: 'active',
            samples: 3
          }
        ]
      }
    })
  );

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  await page.keyboard.press('Escape');
});

test('Workspace has Protocols tab with Select Protocol Admin that launches camera scanner', async ({ page }) => {
  // Open Workspace
  const workspaceBtn = page.getByRole('button', { name: 'Workspace', exact: true }).first();
  await expect(workspaceBtn).toBeVisible();
  await workspaceBtn.click();

  // Verify Workspace opens
  const navBar = page.getByRole('navigation', { name: 'Record categories' });
  await expect(navBar).toBeVisible();

  // Select Protocols tab
  const protocolsTabBtn = page.getByRole('button', { name: /Protocols/i });
  await expect(protocolsTabBtn).toBeVisible();
  await protocolsTabBtn.click();

  // Verify Protocol Admin card exists
  const adminProtoTitle = page.getByText('Protocol Admin · Biometric Optical Identification');
  await expect(adminProtoTitle).toBeVisible();

  // Click "Select Protocol Admin"
  const selectAdminBtn = page.getByRole('button', { name: /Select Protocol Admin/i }).first();
  await expect(selectAdminBtn).toBeVisible();
  await selectAdminBtn.click();

  // Verify Admin Protocol Overlay opened with optical viewfinder
  const overlayTitle = page.getByText('Administrator Verification', { exact: true });
  await expect(overlayTitle).toBeVisible();
  const opticalTag = page.locator('.admin-auth-backdrop video');
  await expect(opticalTag).toBeVisible();
});

test('Admin activation event opens the shared verification overlay', async ({ page }) => {
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('oracle_activate_admin_protocol'));
  });

  // Verify Admin Protocol Overlay appears
  const overlayTitle = page.getByText('Administrator Verification', { exact: true });
  await expect(overlayTitle).toBeVisible();
});

test('Typed Admin command starts a gateway attempt and closing cancels it', async ({ page }) => {
  await page.locator('.header-status-chip').click();
  await expect(page.getByText('Normal Operator · Restricted', { exact: true })).toBeVisible();
  await page.locator('.header-status-chip').click();
  await page.locator('.header-status-chip').blur();
  await page.keyboard.press('Slash');
  const input = page.getByRole('textbox', { name: 'Message ORACLE' });
  await input.fill('Oracle, could you activate the Admin Protocol?');
  const started = page.waitForResponse(response =>
    response.url().endsWith('/api/v1/admin/attempts') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Send message' }).click();
  await started;
  const overlay = page.locator('.admin-auth-backdrop');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('button', { name: 'Instant Unlock' })).toHaveCount(0);
  const cancelled = page.waitForRequest(request =>
    request.url().endsWith('/api/v1/admin/attempts/test-attempt') && request.method() === 'DELETE'
  );
  await overlay.getByRole('button', { name: 'Close modal' }).click();
  await cancelled;
  await expect(overlay).toHaveCount(0);
});

test('Sentinel reports sensor status without requesting camera access', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        if (constraints.video) document.body.dataset.cameraRequested = 'true';
        throw new DOMException('Permission denied', 'NotAllowedError');
      }
    });
    window.dispatchEvent(new Event('oracle_activate_sentinel_protocol'));
  });
  await expect(page.getByText('Sentinel activity')).toBeVisible();
  await expect(page.getByText(/Camera off \(permission/).first()).toBeVisible();
  expect(await page.locator('body').getAttribute('data-camera-requested')).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event('oracle_activate_sentry_protocol')));
  await expect(page.locator('body')).toHaveAttribute('data-camera-requested', 'true');
  await expect(page.getByText(/Camera unavailable \(permission/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Stop Sentinel' }).click();
  await expect(page.getByText('Sentinel activity')).toHaveCount(0);
});

test('Hibernate survives late mode updates and wakes explicitly', async ({ page }) => {
  await page.keyboard.press('Slash');
  await page.getByRole('textbox', { name: 'Message ORACLE' }).fill('Oracle, hibernate system');
  await page.getByRole('button', { name: 'Send message' }).click();
  const wake = page.getByRole('button', { name: 'Wake Oracle' });
  await expect(wake).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('oracle_activate_hibernate_protocol'));
    window.ORACLE?.setMode('ready');
  });
  expect(await page.evaluate(() => window.ORACLE?.getMode())).toBe('dormant');
  await expect(page.getByRole('textbox', { name: 'Message ORACLE' })).toBeHidden();
  await wake.click();
  await expect(wake).toBeHidden();
  expect(await page.evaluate(() => window.ORACLE?.getMode())).toBe('ready');
});

test('Ghost activation is idempotent and exits through its visible control', async ({ page }) => {
  await page.keyboard.press('Slash');
  await page.getByRole('textbox', { name: 'Message ORACLE' }).fill('Oracle, enable Ghost mode');
  await page.getByRole('button', { name: 'Send message' }).click();
  const exit = page.getByRole('button', { name: 'Exit Ghost mode' });
  await expect(exit).toBeVisible();
  await expect(page.locator('#ui')).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Message ORACLE' })).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('oracle_activate_ghost_protocol')));
  await expect(exit).toBeVisible();
  await exit.click();
  await expect(exit).toBeHidden();
  await expect(page.locator('#ui')).toBeVisible();
});

for (const source of ['Workspace', 'typed chat'] as const) {
  test(`Lockdown from ${source} uses the gateway and enters dormant mode`, async ({ page }) => {
    await page.route('**/api/v1/protocols/lockdown', route =>
      route.fulfill({ json: { oracle: 'restricted', windows: 'failed', cancelled_actions: 1, already_active: false } })
    );
    const request = page.waitForRequest(req =>
      req.url().endsWith('/api/v1/protocols/lockdown') && req.method() === 'POST'
    );
    if (source === 'Workspace') {
      await page.getByRole('button', { name: 'Workspace', exact: true }).first().click();
      await page.getByRole('button', { name: /Protocols/i }).click();
      await page.getByRole('button', { name: 'Select Protocol LOCKDOWN' }).click();
    } else {
      await page.keyboard.press('Slash');
      await page.getByRole('textbox', { name: 'Message ORACLE' }).fill('Oracle, could you activate Lockdown?');
      await page.getByRole('button', { name: 'Send message' }).click();
    }
    await request;
    await expect.poll(() => page.evaluate(() => window.ORACLE?.getMode())).toBe('dormant');
    await page.evaluate(() => window.ORACLE?.setMode('ready'));
    await page.locator('.header-status-chip').click();
    await expect(page.getByRole('status').filter({ hasText: 'Oracle is restricted. Windows did not accept the lock request.' })).toBeVisible();
  });
}

test('Protocols tab displays full protocol catalog and permissions matrix', async ({ page }) => {
  // Open Workspace
  const workspaceBtn = page.getByRole('button', { name: 'Workspace', exact: true }).first();
  await expect(workspaceBtn).toBeVisible();
  await workspaceBtn.click();

  // Select Protocols tab
  const protocolsTabBtn = page.getByRole('button', { name: /Protocols/i });
  await expect(protocolsTabBtn).toBeVisible();
  await protocolsTabBtn.click();

  // Check key protocols exist
  await expect(page.getByText('Protocol SENTINEL · Monitors ORACLE permissions, access requests, and sensor activation')).toBeVisible();
  await expect(page.getByText('Protocol GHOST · Hides sensitive information, pauses sensing, suppresses previews')).toBeVisible();
  await expect(page.getByText('Protocol FOCUS · Opens dev workspace, starts focus session, silences nonessentials')).toBeVisible();
  await expect(page.getByText('Protocol DIAGNOSTIC · Checks CPU, RAM, GPU, storage, running services, and models')).toBeVisible();
  await expect(page.getByText('Protocol COMMAND · Application launches, window management, media control')).toBeVisible();
  await expect(page.getByText('Protocol ATLAS · Map tools, route planning, location bookmarks, geospatial layers')).toBeVisible();
  await expect(page.getByText('Protocol WATCHTOWER · Connectivity, known devices, service availability, latency')).toBeVisible();
  await expect(page.getByText('Protocol BRIEFING · Presents calendar, upcoming tasks, weather, spoken briefing')).toBeVisible();
  await expect(page.getByText('Protocol HIBERNATE · Pauses Oracle activity and reduces rendering')).toBeVisible();
  await expect(page.getByText('Protocol LOCKDOWN · Revokes admin, cancels queued actions, locks workstation')).toBeVisible();

  // Check Permissions matrix headers exist
  const standardModes = page.getByText('Standard Mode:');
  await expect(standardModes.first()).toBeVisible();
  const adminModes = page.getByText('Admin Mode:');
  await expect(adminModes.first()).toBeVisible();
});

test('User can author a custom protocol and customize existing protocols', async ({ page }) => {
  // Open Workspace
  const workspaceBtn = page.getByRole('button', { name: 'Workspace', exact: true }).first();
  await expect(workspaceBtn).toBeVisible();
  await workspaceBtn.click();

  // Select Protocols tab
  const protocolsTabBtn = page.getByRole('button', { name: /Protocols/i });
  await expect(protocolsTabBtn).toBeVisible();
  await protocolsTabBtn.click();

  // Verify Create Custom Protocol button exists
  const createBtn = page.getByRole('button', { name: /Create Custom Protocol/i });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  // Protocol Editor Modal opens
  await expect(page.getByText('AUTHOR NEW SYSTEM PROTOCOL')).toBeVisible();

  // Fill out form
  const nameInput = page.getByPlaceholder('e.g. Protocol NIGHTOWL');
  await nameInput.fill('Protocol NIGHTOWL');

  const codeInput = page.getByPlaceholder('PROTO-CUST-01');
  await codeInput.fill('PROTO-CUST-99');

  const phrasesInput = page.getByPlaceholder(/activate nightowl/i);
  await phrasesInput.fill('activate nightowl, protocol nightowl');

  // Click Save Protocol
  const saveBtn = page.getByRole('button', { name: /Save Protocol/i });
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  // Verify custom protocol appears in the list
  await expect(page.getByText('Protocol NIGHTOWL').first()).toBeVisible();
  await expect(page.getByText('PROTO-CUST-99')).toBeVisible();

  // Verify Customize button on existing protocols works
  const customizeBtn = page.getByRole('button', { name: /Customize/i }).first();
  await expect(customizeBtn).toBeVisible();
  await customizeBtn.click();
  await expect(page.getByText(/CUSTOMIZE PROTOCOL/i)).toBeVisible();

  // Close editor
  const cancelBtn = page.getByRole('button', { name: 'Cancel' });
  await cancelBtn.click();
});


