require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

if (!process.env.AUTOMATION_SECRET) console.warn('WARNING: AUTOMATION_SECRET non configuree');

const sessions = new Map();

function requireAuth(req, res, next) {
  const secret = process.env.AUTOMATION_SECRET;
  if (!secret || req.headers['x-automation-secret'] !== secret) return res.status(401).json({ error: 'Non autorise' });
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true, sessions: sessions.size }));

// Résolution automatique Cloudflare Turnstile via 2captcha
async function autoSolveTurnstile(page) {
  const apiKey = process.env.TWOCAPTCHA_API_KEY;
  if (!apiKey) return { solved: false, reason: 'no_api_key' };
  try {

        await page.waitForLoadState('domcontentloaded').catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    // === DEBUG COMPLET — À RETIRER APRÈS ===
    console.log('[DEBUG] URL:', page.url());
    console.log('[DEBUG] Frames count:', page.frames().length);
    page.frames().forEach((f, i) => console.log(`[DEBUG] Frame ${i}:`, f.url()));

    const html = await page.content().catch(() => '');
    console.log('[DEBUG] HTML[:3000]:', html.substring(0, 3000));

    const allMatches = [...html.matchAll(/0x[0-9a-fA-F]{10,}/g)];
    console.log('[DEBUG] Tous les hex trouvés:', allMatches.map(m => m[0]));

    for (const frame of page.frames()) {
      try {
        const cfVars = await frame.evaluate(() => ({
          chlOpt: window._cf_chl_opt,
          chlCtx: window._cf_chl_ctx,
          keys: Object.keys(window).filter(k => k.includes('cf') || k.includes('CF') || k.includes('turnstile'))
        }));
        console.log(`[DEBUG] Frame ${frame.url()} CF vars:`, JSON.stringify(cfVars));
      } catch(e) {}
    }
    // === FIN DEBUG ===
    // Attendre que le widget Turnstile soit rendu (SPAs Angular/React)
    await page.waitForTimeout(2000).catch(() => {});

    // Chercher le widget Turnstile sur la page courante — stratégies multiples
    const sitekey = await page.evaluate(() => {
      // 1. Attribut data-sitekey direct (div.cf-turnstile ou tout élément)
      const bySitekey = document.querySelector('[data-sitekey]');
      if (bySitekey) return bySitekey.getAttribute('data-sitekey');

      // 2. Classe cf-turnstile (widget non encore rendu mais présent dans le DOM)
      const byClass = document.querySelector('.cf-turnstile, [class*="cf-turnstile"], [id*="cf-chl"]');
      if (byClass) {
        const sk = byClass.getAttribute('data-sitekey') || byClass.getAttribute('data-cf-turnstile-sitekey');
        if (sk) return sk;
      }

      // 3. iframe Cloudflare Turnstile (challenges.cloudflare.com)
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.getAttribute('src') || '';
        if (src.includes('challenges.cloudflare.com') || src.includes('turnstile') || src.includes('cf-chl')) {
          // Extraire le sitekey depuis l'URL de l'iframe
          const m = src.match(/[?&]sitekey=([^&]+)/);
          if (m) return decodeURIComponent(m[1]);
          // Parfois le sitekey est dans le param k=
          const k = src.match(/[?&]k=([^&]+)/);
          if (k) return decodeURIComponent(k[1]);
        }
      }

      // 4. Chercher dans les scripts inline (window.turnstile.render ou data-sitekey dans JSON)
      const scripts = document.querySelectorAll('script:not([src])');
      for (const s of scripts) {
        const m = s.textContent.match(/['"](0x[0-9a-fA-F]{16,})['"]/);
        if (m) return m[1]; // sitekeys Turnstile commencent souvent par 0x
      }

      return null;
    }).catch(() => null);
    if (!sitekey) return { solved: false, reason: 'no_turnstile_found' };

    const pageUrl = page.url();
    console.log('[captcha] Turnstile sitekey:', sitekey, 'url:', pageUrl);

    // Créer la tâche 2captcha
    const createRes = await fetch('https://api.2captcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: { type: 'TurnstileTaskProxyless', websiteURL: pageUrl, websiteKey: sitekey },
      }),
    });
    const { taskId, errorId, errorCode } = await createRes.json();
    if (errorId) { console.error('[captcha] Create error:', errorCode); return { solved: false, reason: errorCode }; }
    console.log('[captcha] Task created:', taskId);

    // Attendre la solution (max 2min)
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const res = await fetch('https://api.2captcha.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });
      const result = await res.json();
      if (result.status === 'ready') {
        const token = result.solution.token;
        // Injecter le token dans la page
        await page.evaluate((t) => {
          document.querySelectorAll('[name="cf-turnstile-response"], [name="g-recaptcha-response"]').forEach(el => { el.value = t; });
          if (typeof window.cfCallback === 'function') window.cfCallback(t);
          if (typeof window.turnstileCallback === 'function') window.turnstileCallback(t);
          // Chercher et appeler le callback Turnstile enregistré
          const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"]');
          iframes.forEach(iframe => {
            try {
              const cfInput = iframe.closest('form')?.querySelector('[name="cf-turnstile-response"]');
              if (cfInput) cfInput.value = t;
            } catch {}
          });
        }, token);
        console.log('[captcha] ✅ Turnstile solved');
        return { solved: true, token };
      }
      if (result.errorId) { console.error('[captcha] Poll error:', result.errorCode); return { solved: false, reason: result.errorCode }; }
    }
    return { solved: false, reason: 'timeout' };
  } catch (e) {
    console.error('[captcha] Exception:', e.message);
    return { solved: false, reason: e.message };
  }
}

app.post('/sessions', requireAuth, async (req, res) => {
  const { sessionId, initialUrl } = req.body;
  if (!sessionId || !initialUrl) return res.status(400).json({ error: 'sessionId et initialUrl requis' });
  if (sessions.has(sessionId)) return res.status(409).json({ error: 'Session deja existante' });
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,720', '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-infobars', '--no-first-run', '--no-default-browser-check',
        '--lang=fr-FR,fr', '--disable-ipc-flooding-protection',
      ],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      if (!window.chrome) {
        window.chrome = {
          app: { isInstalled: false },
          runtime: {},
          csi() {}, loadTimes() {},
        };
      }
      const makeMime = (type, suffixes, desc) => { const m = Object.create(MimeType.prototype); Object.defineProperties(m, { type: { value: type }, suffixes: { value: suffixes }, description: { value: desc } }); return m; };
      const makePlugin = (name, filename, desc, mimes) => { const p = Object.create(Plugin.prototype); Object.defineProperties(p, { name: { value: name }, filename: { value: filename }, description: { value: desc }, length: { value: mimes.length } }); mimes.forEach((m, i) => { p[i] = m; m.enabledPlugin = p; }); p.item = (i) => p[i]; p.namedItem = (t) => mimes.find(m => m.type === t) || null; return p; };
      const plugins = [
        makePlugin('Chrome PDF Plugin', 'internal-pdf-viewer', 'Portable Document Format', [makeMime('application/x-google-chrome-pdf', 'pdf', 'Portable Document Format')]),
        makePlugin('Chrome PDF Viewer', 'mhjfbmdgcfjbbpaeojofohoefgiehjai', '', [makeMime('application/pdf', 'pdf', '')]),
        makePlugin('Native Client', 'internal-nacl-plugin', '', [makeMime('application/x-nacl', '', 'Native Client Executable'), makeMime('application/x-pnacl', '', 'Portable Native Client Executable')]),
      ];
      const pluginArr = Object.create(PluginArray.prototype);
      plugins.forEach((p, i) => { pluginArr[i] = p; });
      Object.defineProperty(pluginArr, 'length', { value: plugins.length });
      pluginArr.item = (i) => pluginArr[i]; pluginArr.namedItem = (n) => plugins.find(p => p.name === n) || null; pluginArr.refresh = () => {};
      Object.defineProperty(navigator, 'plugins', { get: () => pluginArr });
      const allMimes = plugins.flatMap(p => Array.from({ length: p.length }, (_, i) => p[i]));
      const mimeArr = Object.create(MimeTypeArray.prototype);
      allMimes.forEach((m, i) => { mimeArr[i] = m; });
      Object.defineProperty(mimeArr, 'length', { value: allMimes.length });
      mimeArr.item = (i) => mimeArr[i]; mimeArr.namedItem = (t) => allMimes.find(m => m.type === t) || null;
      Object.defineProperty(navigator, 'mimeTypes', { get: () => mimeArr });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      if (navigator.permissions && navigator.permissions.query) {
        const orig = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (params) => params.name === 'notifications' ? Promise.resolve({ state: 'default', onchange: null }) : orig(params);
      }
    });
    const page = await context.newPage();
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const sessionObj = { browser, context, page, createdAt: Date.now() };
    sessions.set(sessionId, sessionObj);
    // Auto-solve Turnstile si 2captcha configuré
    autoSolveTurnstile(page).then(r => { if (r.solved) console.log('[captcha] Auto-solved on load'); }).catch(() => {});
    // Suivre les popups (Google OAuth, etc.)
    context.on('page', async (newPage) => {
      try {
        await newPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        sessionObj.page = newPage;
        console.log('[sessions] Popup ouverte:', newPage.url());
        newPage.on('close', () => {
          const pages = context.pages();
          if (pages.length > 0) { sessionObj.page = pages[pages.length - 1]; console.log('[sessions] Popup fermee, retour:', sessionObj.page.url()); }
        });
      } catch (e) { console.error('[sessions] Popup error:', e.message); }
    });
    console.log('[sessions] Creee:', sessionId);
    res.json({ success: true, sessionId });
  } catch (e) {
    console.error('[sessions] Erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/sessions/:id/cookies', requireAuth, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session non trouvee' });
  try {
    const currentUrl = session.page.url();
    const cookies = await session.context.cookies();
    res.json({ success: true, cookies, currentUrl });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Endpoint pour résoudre manuellement un CAPTCHA Turnstile sur la session active
app.post('/sessions/:id/solve-captcha', requireAuth, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session non trouvee' });
  const result = await autoSolveTurnstile(session.page);
  if (result.solved) return res.json({ success: true });
  if (result.reason === 'no_turnstile_found') return res.json({ success: false, reason: 'no_turnstile_found' });
  res.status(result.reason === 'no_api_key' ? 503 : 500).json({ success: false, reason: result.reason });
});

app.delete('/sessions/:id', requireAuth, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.json({ success: true });
  try {
    await session.browser.close();
    sessions.delete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (now - s.createdAt > 10 * 60 * 1000) { s.browser.close().catch(() => {}); sessions.delete(id); }
  }
}, 60 * 1000);

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');
  const secret = url.searchParams.get('secret');
  if (!process.env.AUTOMATION_SECRET || secret !== process.env.AUTOMATION_SECRET) { ws.close(1008, 'Non autorise'); return; }
  const session = sessions.get(sessionId);
  if (!session) { ws.close(1008, 'Session non trouvee'); return; }
  const interval = setInterval(async () => {
    if (ws.readyState !== ws.OPEN) { clearInterval(interval); return; }
    try { const shot = await session.page.screenshot({ type: 'jpeg', quality: 65 }); ws.send(shot); }
    catch { clearInterval(interval); }
  }, 200);
  ws.on('message', async (data) => {
    try {
      const { type, x, y, text, key, delta } = JSON.parse(data.toString());
      if (type === 'click') await session.page.mouse.click(x, y);
      else if (type === 'type') await session.page.keyboard.type(text);
      else if (type === 'key') await session.page.keyboard.press(key);
      else if (type === 'scroll') await session.page.mouse.wheel(0, delta);
    } catch (e) { console.error('[ws] Action error:', e.message); }
  });
  ws.on('close', () => { clearInterval(interval); });
});

const PORT = parseInt(process.env.PORT || '3001', 10);
server.listen(PORT, '0.0.0.0', () => console.log('[startup] Listening on 0.0.0.0:' + PORT));
server.on('error', (e) => { console.error('[startup] ERROR:', e.message); process.exit(1); });
