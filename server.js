/**
 * CareerPilot Automation Microservice
 * Fournit un navigateur Playwright streamé par WebSocket sous forme de captures JPEG.
 * L'utilisateur interagit via un canvas côté client qui envoie les actions (click/type/key/scroll).
 */

require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const { chromium } = require('playwright-core');
const http = require('http');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const AUTH_SECRET = process.env.AUTOMATION_SECRET;
if (!AUTH_SECRET) {
  console.warn('WARNING: AUTOMATION_SECRET non configurée — toutes les requêtes authentifiées seront rejetées');
}

// Sessions actives : sessionId → { browser, context, page, createdAt }
const sessions = new Map();

// ── Middleware auth ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const secret = process.env.AUTOMATION_SECRET;
  if (!secret || req.headers['x-automation-secret'] !== secret) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, sessions: sessions.size }));

// ── POST /sessions — Créer une session navigateur ─────────────────────────────
app.post('/sessions', requireAuth, async (req, res) => {
  const { sessionId, initialUrl } = req.body;
  if (!sessionId || !initialUrl) {
    return res.status(400).json({ error: 'sessionId et initialUrl requis' });
  }
  if (sessions.has(sessionId)) {
    return res.status(409).json({ error: 'Session déjà existante' });
  }

  try {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,720',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    // Masquer les traces d'automatisation
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    sessions.set(sessionId, { browser, context, page, createdAt: Date.now() });
    console.log(`[sessions] Créée: ${sessionId} → ${initialUrl}`);

    res.json({ success: true, sessionId });
  } catch (e) {
    console.error('[sessions] Erreur création:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /sessions/:id/cookies — Récupérer cookies + URL courante ─────────────
app.post('/sessions/:id/cookies', requireAuth, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session non trouvée' });

  try {
    const currentUrl = session.page.url();
    const cookies = await session.context.cookies();
    console.log(`[cookies] ${cookies.length} cookies | URL: ${currentUrl}`);
    res.json({ success: true, cookies, currentUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /sessions/:id — Fermer et libérer ──────────────────────────────────
app.delete('/sessions/:id', requireAuth, async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.json({ success: true }); // déjà fermée

  try {
    await session.browser.close();
    sessions.delete(req.params.id);
    console.log(`[sessions] Fermée: ${req.params.id}`);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Nettoyage automatique des sessions > 10 min ───────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > 10 * 60 * 1000) {
      session.browser.close().catch(() => {});
      sessions.delete(id);
      console.log(`[cleanup] Session expirée: ${id}`);
    }
  }
}, 60 * 1000);

// ── WebSocket — Stream screenshots + réception actions utilisateur ─────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');
  const secret = url.searchParams.get('secret');

  const wsSecret = process.env.AUTOMATION_SECRET;
  if (!wsSecret || secret !== wsSecret) {
    ws.close(1008, 'Non autorisé');
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    ws.close(1008, 'Session non trouvée');
    return;
  }

  console.log(`[ws] Connecté: ${sessionId}`);

  // Stream JPEG toutes les 200ms
  const interval = setInterval(async () => {
    if (ws.readyState !== ws.OPEN) { clearInterval(interval); return; }
    try {
      const shot = await session.page.screenshot({ type: 'jpeg', quality: 65 });
      ws.send(shot);
    } catch {
      clearInterval(interval);
    }
  }, 200);

  // Recevoir les actions clavier/souris du client
  ws.on('message', async (data) => {
    try {
      const { type, x, y, text, key, delta } = JSON.parse(data.toString());
      if      (type === 'click')  await session.page.mouse.click(x, y);
      else if (type === 'type')   await session.page.keyboard.type(text);
      else if (type === 'key')    await session.page.keyboard.press(key);
      else if (type === 'scroll') await session.page.mouse.wheel(0, delta);
    } catch (e) {
      console.error('[ws] Action error:', e.message);
    }
  });

  ws.on('close', () => {
    clearInterval(interval);
    console.log(`[ws] Déconnecté: ${sessionId}`);
  });
});

const PORT = process.env.PORT ?? 3001;
server.listen(PORT, () => console.log(`Automation server démarré sur le port ${PORT}`));
