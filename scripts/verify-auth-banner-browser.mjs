/**
 * Real-browser verification of the v5.1.9 first-run authentication flow and
 * the dashboard banner polish.
 *
 * Happy DOM proves behaviour but not pixels; this drives a real Chromium
 * against a served production build and checks what the operator actually
 * sees:
 *
 *   fresh terminal -> Setup/Sign-Up -> account created -> Sign-In (no
 *   session) -> wrong password rejected -> correct password -> Dashboard
 *   -> built-in banner painting real pixels, no editing overlay, minimal
 *   text, sensible mobile layout -> banner controls in Settings ->
 *   default banner still available with the network switched off.
 *
 * Screenshots are written outside the repository (default: /tmp/pos-v519-ui)
 * so they are never committed.
 *
 * Development-only, like the other smokes. Chromium comes from the
 * @sparticuz/chromium npm tarball (no browser download).
 *
 *   npm install --no-save puppeteer-core @sparticuz/chromium
 *   npm run build                        # a normal build: no password, no test API
 *   node scripts/verify-auth-banner-browser.mjs
 *
 * The build must NOT carry VITE_ADMIN_PASSWORD: this script needs a genuinely
 * fresh terminal so the first screen is Sign-Up. Everything is driven through
 * the real UI, so no test API is required.
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.SHOT_DIR ?? '/tmp/pos-v519-ui';

const USERNAME = 'browser-owner';
const PASSWORD = 'browser-owner-pass';

/* ----------------------- Chromium library bootstrap ---------------------- */
const libDir = '/tmp/al2023/lib';
if (!fs.existsSync(path.join(libDir, 'libnspr4.so'))) {
  const br = path.join(root, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br');
  fs.mkdirSync('/tmp/al2023', { recursive: true });
  fs.writeFileSync('/tmp/al2023.tar', zlib.brotliDecompressSync(fs.readFileSync(br)));
  execFileSync('tar', ['-xf', '/tmp/al2023.tar', '-C', '/tmp/al2023']);
}

/* ------------------------------ Preview server --------------------------- */
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
process.on('exit', () => server.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* keep waiting */
    }
    await sleep(250);
  }
  throw new Error('preview server did not start');
}

/**
 * Dismiss the guided tour, which can sit over the panel on a first visit
 * (pre-existing onboarding behaviour, unrelated to these screens).
 */
async function skipTour(page) {
  await page.evaluate(() => {
    const skip = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Skip tour',
    );
    skip?.click();
  });
}

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(`FAILED: ${label}`);
  passed += 1;
  console.log(`PASS  ${label}`);
}

fs.mkdirSync(SHOTS, { recursive: true });

await waitServer();

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: libDir },
});

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  /* ------------------------- 1. Fresh terminal ------------------------- */

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.body.textContent.includes('Create your account'),
    { timeout: 20000 },
  );
  check(
    new URL(page.url()).pathname.endsWith('/setup'),
    'a fresh terminal opens the Setup / Sign-Up screen at /setup',
  );
  check(
    (await page.$('input[name="password"]')) === null,
    'the Sign-In form is not offered before an account exists',
  );
  const signUpLabels = await page.$$eval('input', (nodes) =>
    nodes.map((node) => node.name),
  );
  check(
    ['displayName', 'newUsername', 'newPassword', 'confirmPassword'].every((name) =>
      signUpLabels.includes(name),
    ),
    'Setup collects name, username, password and confirmation only',
  );
  await page.screenshot({ path: path.join(SHOTS, '01-setup-desktop.png'), fullPage: true });

  // Mobile: no horizontal overflow, fields usable.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.body.textContent.includes('Create your account'),
    { timeout: 20000 },
  );
  const setupOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(setupOverflow <= 1, 'the Setup screen has no horizontal overflow on mobile');
  await page.screenshot({ path: path.join(SHOTS, '02-setup-mobile.png'), fullPage: true });

  /* --------------------- 2. Validation then creation -------------------- */

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.type('input[name="displayName"]', 'Browser Test Kitchen');
  await page.type('input[name="newUsername"]', USERNAME);
  await page.type('input[name="newPassword"]', PASSWORD);
  await page.type('input[name="confirmPassword"]', 'mismatch-pass');
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => document.body.textContent.includes('Passwords do not match.'),
    { timeout: 10000 },
  );
  check(true, 'a mismatched confirmation is rejected with a field message');

  await page.$eval('input[name="confirmPassword"]', (input) => {
    input.value = '';
  });
  await page.type('input[name="confirmPassword"]', PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForFunction(
    () => document.body.textContent.includes('Account created successfully. Please sign in.'),
    { timeout: 20000 },
  );
  check(
    new URL(page.url()).pathname.endsWith('/login'),
    'creating the account lands on Sign-In, not the Dashboard',
  );
  const sessionAfterSignUp = await page.evaluate(() =>
    window.localStorage.getItem('pos.auth.session'),
  );
  check(sessionAfterSignUp === null, 'registration created no signed-in session');
  check(
    (await page.$('#main-content')) === null,
    'the dashboard is not reachable immediately after registration',
  );
  await page.screenshot({ path: path.join(SHOTS, '03-login-after-signup.png'), fullPage: true });

  /* ------------------------ 3. Signing in ------------------------------ */

  await page.$eval('input[name="password"]', (input) => {
    input.value = '';
  });
  await page.type('input[name="password"]', 'definitely-wrong');
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => document.body.textContent.includes('Incorrect username or password.'),
    { timeout: 20000 },
  );
  check(
    (await page.$('#main-content')) === null,
    'a wrong password is rejected and never opens the Dashboard',
  );

  await page.$eval('input[name="password"]', (input) => {
    input.value = '';
  });
  await page.type('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => Boolean(document.querySelector('#main-content')), {
    timeout: 20000,
  });
  await page.waitForFunction(
    () => window.location.pathname.endsWith('/dashboard'),
    { timeout: 20000 },
  );
  check(true, 'the correct password signs in and opens the Dashboard');

  /* ------------------------ 4. Banner polish --------------------------- */

  await page.waitForFunction(
    () => {
      const image = document.querySelector('section[aria-label="Restaurant banner"] img');
      return Boolean(image && image.complete && image.naturalWidth > 0);
    },
    { timeout: 20000 },
  );
  const banner = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Restaurant banner"]');
    const image = section?.querySelector('img');
    const rect = section?.getBoundingClientRect();
    const style = image ? getComputedStyle(image) : null;
    const text = section?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const controls = section
      ? Array.from(section.querySelectorAll('button, a, label, input, [role="button"]')).map(
          (node) => node.textContent?.trim() || node.getAttribute('aria-label') || node.tagName,
        )
      : [];
    return {
      src: image?.getAttribute('src') ?? '',
      naturalWidth: image?.naturalWidth ?? 0,
      objectFit: style?.objectFit ?? '',
      height: rect?.height ?? 0,
      text,
      controls,
      bodyHasEditCopy: /change banner|add banner|edit banner|upload banner/i.test(
        document.body.textContent ?? '',
      ),
    };
  });
  check(
    /default-restaurant-banner/.test(banner.src) && banner.naturalWidth > 0,
    'the built-in restaurant banner is the default and paints real pixels',
  );
  check(banner.objectFit === 'cover', 'the banner image is cropped with object-fit: cover');
  check(banner.height >= 150, 'the banner has a real, visible height on desktop');
  check(banner.controls.length === 0, 'the banner carries no buttons, links or inputs');
  check(!banner.bodyHasEditCopy, 'no Change/Add Banner copy exists anywhere on the Dashboard');
  check(
    banner.text === 'Welcome back.' && !/orders completed/i.test(banner.text),
    'an unnamed terminal shows only the greeting, with no statistics or instructions',
  );
  await page.screenshot({ path: path.join(SHOTS, '04-dashboard-banner-unconfigured.png'), fullPage: true });

  // Save a restaurant name through the real Settings form (no test API
  // needed), then check the banner shows exactly the name and greeting.
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => Boolean(document.getElementById('admin-tab-restaurant')),
    { timeout: 20000 },
  );
  await skipTour(page);
  await page.click('#admin-tab-restaurant');
  await page.waitForSelector('input[name="name"]', { timeout: 20000 });
  await page.type('input[name="name"]', 'Browser Test Kitchen');
  await page.evaluate(() => {
    const save = Array.from(document.querySelectorAll('button')).find((button) =>
      /^Save changes$/.test(button.textContent.trim()),
    );
    if (!save) throw new Error('no Save changes button');
    save.click();
  });
  // Wait for the form's own "Profile saved." confirmation so the record is
  // really written before the Dashboard reads it back.
  await page.waitForFunction(
    () => document.body.textContent.includes('Profile saved.'),
    { timeout: 20000 },
  );
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => {
      const image = document.querySelector('section[aria-label="Restaurant banner"] img');
      return Boolean(image && image.complete && image.naturalWidth > 0);
    },
    { timeout: 20000 },
  );
  const namedBanner = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Restaurant banner"]');
    return {
      title: section?.querySelector('h2')?.textContent?.trim() ?? '',
      lines: Array.from(section?.querySelectorAll('p') ?? []).map(
        (node) => node.textContent?.trim() ?? '',
      ),
    };
  });
  check(
    namedBanner.title === 'Browser Test Kitchen' &&
      namedBanner.lines.length === 1 &&
      namedBanner.lines[0] === 'Welcome back.',
    'the banner shows exactly the restaurant name and greeting (no tagline, no extras)',
  );
  await page.screenshot({ path: path.join(SHOTS, '04-dashboard-banner-desktop.png'), fullPage: true });

  // Mobile banner: actual layout, no overflow, readable text on the image.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => Boolean(document.querySelector('#main-content')),
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => {
      const image = document.querySelector('section[aria-label="Restaurant banner"] img');
      return Boolean(image && image.complete && image.naturalWidth > 0);
    },
    { timeout: 20000 },
  );
  const mobile = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Restaurant banner"]');
    const title = section?.querySelector('h2');
    const titleRect = title?.getBoundingClientRect();
    const sectionRect = section?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      bannerHeight: sectionRect?.height ?? 0,
      titleVisible:
        Boolean(titleRect) &&
        titleRect.width > 0 &&
        titleRect.height > 0 &&
        titleRect.right <= window.innerWidth + 1 &&
        Boolean(sectionRect) &&
        titleRect.bottom <= sectionRect.bottom + 1,
    };
  });
  check(mobile.overflow <= 1, 'the Dashboard has no horizontal overflow on mobile');
  check(mobile.bannerHeight >= 120, 'the banner keeps a real height on mobile');
  check(mobile.titleVisible, 'the restaurant name stays inside the banner on mobile');
  await page.screenshot({ path: path.join(SHOTS, '05-dashboard-banner-mobile.png'), fullPage: true });

  /* -------------------- 5. Banner controls in Settings ----------------- */

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => Boolean(document.getElementById('admin-tab-appearance')),
    { timeout: 20000 },
  );
  await skipTour(page);
  await page.click('#admin-tab-appearance');
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent.trim() === 'Save banner',
      ),
    { timeout: 20000 },
  );
  const settings = await page.evaluate(() => {
    const text = document.body.textContent ?? '';
    const fileInput = document.querySelector('input[type="file"]');
    return {
      hasCard: text.includes('Dashboard banner'),
      hasSave: Array.from(document.querySelectorAll('button')).some(
        (button) => button.textContent.trim() === 'Save banner',
      ),
      hasFileInput: Boolean(fileInput),
      previewIsDefault: Array.from(document.querySelectorAll('img')).some((image) =>
        /default-restaurant-banner/.test(image.getAttribute('src') ?? ''),
      ),
    };
  });
  check(settings.hasCard, 'Settings -> Appearance hosts the banner card');
  check(settings.hasSave, 'the banner card offers an explicit Save action');
  check(settings.hasFileInput, 'the banner card offers an upload control');
  check(settings.previewIsDefault, 'the banner card previews the built-in banner');
  await page.screenshot({ path: path.join(SHOTS, '06-settings-appearance.png'), fullPage: true });

  /* ------------------- 6. Default banner works offline ---------------- */

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
  // Give the service worker time to finish precaching the shell + banner.
  await page.waitForFunction(
    () => navigator.serviceWorker?.controller !== null,
    { timeout: 30000 },
  );
  await sleep(1500);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(document.querySelector('#main-content')),
    { timeout: 30000 },
  );
  const offlineBanner = await page.waitForFunction(
    () => {
      const image = document.querySelector('section[aria-label="Restaurant banner"] img');
      return image && image.complete && image.naturalWidth > 0
        ? { width: image.naturalWidth, src: image.getAttribute('src') }
        : false;
    },
    { timeout: 30000 },
  );
  const offline = await offlineBanner.jsonValue();
  check(
    /default-restaurant-banner/.test(offline.src) && offline.width > 0,
    'the built-in banner still renders with the network switched off',
  );
  await page.setOfflineMode(false);

  /* ------------------------- 7. Signing out --------------------------- */

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
  const signedOut = await page.evaluate(async () => {
    const button = Array.from(document.querySelectorAll('button')).find((node) =>
      node.textContent.trim().includes('Sign out'),
    );
    if (!button) return false;
    button.click();
    return true;
  });
  check(signedOut, 'the terminal offers a Sign out control');
  await page.waitForFunction(
    () => document.body.textContent.includes('Administrator access is required'),
    { timeout: 20000 },
  );
  check(
    new URL(page.url()).pathname.endsWith('/login'),
    'signing out returns to Sign-In and not to Setup',
  );
  const sessionAfterLogout = await page.evaluate(() =>
    window.localStorage.getItem('pos.auth.session'),
  );
  check(sessionAfterLogout === null, 'signing out clears the stored session');

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(
    () => document.body.textContent.includes('Administrator access is required'),
    { timeout: 20000 },
  );
  check(
    new URL(page.url()).pathname.endsWith('/login'),
    'a protected URL is still guarded after signing out',
  );

  const relevantErrors = consoleErrors.filter(
    (message) => !/Not implemented|Could not parse CSS|Failed to load resource/i.test(message),
  );
  if (relevantErrors.length > 0) {
    throw new Error(`console errors: ${relevantErrors.slice(0, 5).join(' | ')}`);
  }
  check(true, 'the whole journey ran with no unexpected console errors');

  console.log(`\nBrowser verification complete: ${passed} checks passed.`);
  console.log(`Screenshots: ${SHOTS}`);
} finally {
  await browser.close();
  server.kill();
}
