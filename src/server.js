import express from 'express';
import proxy from 'express-http-proxy';
import httpProxy from 'http-proxy';
import { WebSocketServer } from 'ws';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getComments, addComment, updateComment, deleteComment, clearComments } from './comments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 5557;
const OUR_WS_PATH = '/__dov__';  // overlay notification channel

// One entry per port: { httpServer, wss, wsClients, currentTarget }
const instances = new Map();

// All WS clients across every running instance (for broadcastComments)
const allWsClients = new Set();

export async function broadcastComments() {
  if (allWsClients.size === 0) return;
  try {
    const comments = await getComments();
    const msg = JSON.stringify({ type: 'comments', data: comments });
    for (const ws of allWsClients) {
      if (ws.readyState === 1) ws.send(msg);
    }
  } catch {}
}

// ── WebSocket: proxy HMR to target dev server ─────────────────────────────────

const hmrProxy = httpProxy.createProxyServer({ changeOrigin: true });
hmrProxy.on('error', (err, req, res) => {
  // Silently handle proxy errors (e.g. target not running yet)
});

// ── HTTP server ───────────────────────────────────────────────────────────────

export async function startServer(targetUrl, port = DEFAULT_PORT) {
  const target = targetUrl.replace(/\/$/, '');

  if (instances.has(port)) {
    instances.get(port).state.currentTarget = target; // update target; takes effect on next request
    return;
  }

  const state = { currentTarget: target };

  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', ws => {
    allWsClients.add(ws);

    // Send current state immediately on connect
    getComments().then(comments => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'comments', data: comments }));
    }).catch(() => {});

    ws.on('close', () => allWsClients.delete(ws));
    ws.on('error', () => allWsClients.delete(ws));
  });

  const app = express();
  app.use(express.json());

  // ── Overlay script ──────────────────────────────────────────────────────────

  app.get('/__overlay__.js', async (req, res) => {
    const src = await readFile(join(__dirname, 'overlay.js'), 'utf8');
    res.type('application/javascript');
    res.send([
      `window.__DESIGN_OVERLAY_API__ = 'http://localhost:${port}/api';`,
      `window.__DESIGN_OVERLAY_WS__  = 'ws://localhost:${port}${OUR_WS_PATH}';`,
      src,
    ].join('\n'));
  });

  // ── Comments API (broadcast after every write) ──────────────────────────────

  app.get('/api/comments', async (req, res) => {
    res.json(await getComments());
  });

  app.post('/api/comments', async (req, res) => {
    const comment = await addComment(req.body);
    res.status(201).json(comment);
    broadcastComments();
  });

  app.put('/api/comments/:id', async (req, res) => {
    await updateComment(req.params.id, req.body);
    res.json({ ok: true });
    broadcastComments();
  });

  app.delete('/api/comments/:id', async (req, res) => {
    await deleteComment(req.params.id);
    res.json({ ok: true });
    broadcastComments();
  });

  app.delete('/api/comments', async (req, res) => {
    await clearComments();
    res.json({ ok: true });
    broadcastComments();
  });

  // ── HTTP proxy → target with overlay injection ──────────────────────────────

  const SCRIPT_TAG = `<script src="/__overlay__.js"></script>`;

  app.use('/', proxy(() => state.currentTarget, {
    proxyReqOptDecorator(opts) {
      opts.headers = opts.headers || {};
      delete opts.headers['accept-encoding'];
      try { opts.headers['host'] = new URL(state.currentTarget).host; } catch {}
      return opts;
    },
    userResHeaderDecorator(headers) {
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      delete headers['content-length'];
      return headers;
    },
    userResDecorator(proxyRes, proxyResData) {
      const ct = proxyRes.headers['content-type'] || '';
      if (ct.includes('text/html')) {
        let html = proxyResData.toString('utf8');
        html = html.includes('</body>')
          ? html.replace('</body>', SCRIPT_TAG + '\n</body>')
          : html + SCRIPT_TAG;
        return html;
      }
      return proxyResData;
    },
  }));

  // ── Start ───────────────────────────────────────────────────────────────────

  const httpServer = await new Promise((resolve, reject) => {
    const s = app.listen(port, () => resolve(s));
    s.once('error', reject);
  });

  instances.set(port, { httpServer, wss, state });

  // ── WebSocket upgrade routing ───────────────────────────────────────────────
  // Split: our /__dov__ path → notification WS server
  //        everything else   → proxied to target dev server (HMR / hot reload)

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url === OUR_WS_PATH) {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    } else {
      hmrProxy.ws(req, socket, head, { target: instances.get(port).state.currentTarget }, err => {
        if (err) socket.destroy();
      });
    }
  });
}

export function stopServer(port = DEFAULT_PORT) {
  const inst = instances.get(port);
  if (inst) { inst.httpServer.close(); instances.delete(port); }
}

export function getPort(port) { return port ?? DEFAULT_PORT; }
