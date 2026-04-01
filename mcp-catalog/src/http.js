import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  createCatalogServer,
  catalog,
  smartSearch,
  generatePDF,
  formatARS,
  applyDiscount,
  resolveFullBrand,
  encodeToken,
  normalize,
  OUTPUT_PATH,
} from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DIST_DIR = path.resolve(__dirname, '../../dist');
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// ---------------------------------------------------------------------------
// MCP session management
// ---------------------------------------------------------------------------
const sessions = new Map(); // sessionId → { transport, server }

async function handleMcp(req, res) {
  const sessionId = req.headers['mcp-session-id'];

  if (req.method === 'POST') {
    const body = await readBody(req);
    const parsed = JSON.parse(body);

    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res, parsed);
    } else {
      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      const server = createCatalogServer();

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      await server.connect(transport);
      if (transport.sessionId) sessions.set(transport.sessionId, { transport, server });

      await transport.handleRequest(req, res, parsed);

      // Session might have been assigned after handling initialize
      if (transport.sessionId && !sessions.has(transport.sessionId)) {
        sessions.set(transport.sessionId, { transport, server });
      }
    }
  } else if (req.method === 'GET') {
    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No active session' }));
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId);
      await transport.handleRequest(req, res);
      sessions.delete(sessionId);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
    }
  } else {
    res.writeHead(405);
    res.end();
  }
}

// ---------------------------------------------------------------------------
// REST API handlers
// ---------------------------------------------------------------------------
function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res, pathname) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // GET /api/catalog
  if (pathname === '/api/catalog' && req.method === 'GET') {
    return json(res, catalog);
  }

  // GET /api/search?q=...&limit=...
  if (pathname === '/api/search' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const results = smartSearch(q, limit).map(({ _score, ...rest }) => rest);
    return json(res, results);
  }

  // GET /api/brands
  if (pathname === '/api/brands' && req.method === 'GET') {
    const brands = catalog.categories.map((b) => ({
      brand: b,
      product_count: catalog.products.filter((p) => p.supplier === b).length,
    }));
    return json(res, brands);
  }

  // GET /api/brands/:name
  if (pathname.startsWith('/api/brands/') && req.method === 'GET') {
    const brandName = decodeURIComponent(pathname.slice('/api/brands/'.length));
    const n = normalize(brandName);
    const products = catalog.products.filter((p) => normalize(p.supplier).includes(n));
    if (products.length === 0) return json(res, { error: 'Brand not found' }, 404);
    return json(res, { brand: products[0].supplier, total: products.length, products });
  }

  // GET /api/products/:code
  if (pathname.startsWith('/api/products/') && req.method === 'GET') {
    const code = parseInt(pathname.slice('/api/products/'.length), 10);
    const p = catalog.products.find((x) => x.code === code);
    if (!p) return json(res, { error: 'Product not found' }, 404);
    return json(res, p);
  }

  // GET /api/stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    const prices = catalog.products.map((p) => p.unit_price);
    return json(res, {
      total_products: catalog.products.length,
      total_brands: catalog.categories.length,
      price_range: {
        min: Math.min(...prices),
        max: Math.max(...prices),
        average: prices.reduce((a, b) => a + b, 0) / prices.length,
      },
    });
  }

  // POST /api/pdf/catalog — generates and streams PDF download
  if (pathname === '/api/pdf/catalog' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    let products = catalog.products;
    if (body.brands && body.brands.length > 0) {
      products = products.filter((p) =>
        body.brands.some((b) => normalize(p.supplier).includes(normalize(b))),
      );
    }
    if (products.length === 0) return json(res, { error: 'No matching products' }, 400);
    const filename = body.filename || 'catalogo.pdf';
    const file = await generatePDF(products, { title: 'Catálogo de Productos', filename });
    return streamFile(res, file, filename);
  }

  // POST /api/pdf/discounts
  if (pathname === '/api/pdf/discounts' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const resolved = {};
    for (const [input, disc] of Object.entries(body.brand_discounts || {})) {
      const full = resolveFullBrand(input);
      if (full) resolved[full] = disc;
    }
    let products = body.include_all_brands
      ? catalog.products
      : catalog.products.filter((p) => Object.keys(resolved).includes(p.supplier));
    if (products.length === 0) return json(res, { error: 'No matching products' }, 400);
    const filename = body.filename || 'catalogo_descuentos.pdf';
    const file = await generatePDF(products, { title: 'Catálogo con Descuentos', filename, brandDiscounts: resolved });
    return streamFile(res, file, filename);
  }

  // POST /api/pdf/items
  if (pathname === '/api/pdf/items' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const products = (body.item_codes || []).map((c) => catalog.products.find((p) => p.code === c)).filter(Boolean);
    if (products.length === 0) return json(res, { error: 'No products found for given codes' }, 400);
    const itemDisc = {};
    if (body.discounts) { for (const [k, v] of Object.entries(body.discounts)) itemDisc[Number(k)] = v; }
    const filename = body.filename || 'productos_seleccionados.pdf';
    const file = await generatePDF(products, { title: 'Productos Seleccionados', filename, itemDiscounts: itemDisc });
    return streamFile(res, file, filename);
  }

  // POST /api/share-url
  if (pathname === '/api/share-url' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const payload = {};

    if (body.brand_discounts) {
      const bd = {};
      for (const [input, pct] of Object.entries(body.brand_discounts)) {
        const fullBrand = resolveFullBrand(input);
        if (fullBrand && pct > 0) {
          const idx = catalog.categories.indexOf(fullBrand);
          if (idx >= 0) bd[idx] = pct;
        }
      }
      if (Object.keys(bd).length) payload.bd = bd;
    }

    if (body.item_discounts) {
      const d = {};
      for (const [code, pct] of Object.entries(body.item_discounts)) {
        if (pct > 0) d[code] = pct;
      }
      if (Object.keys(d).length) payload.d = d;
    }

    const baseUrl = body.base_url || `https://${req.headers.host}`;
    const url = new URL(baseUrl);
    if (Object.keys(payload).length) url.searchParams.set('t', encodeToken(payload));
    if (body.editor_mode) url.searchParams.set('editor', '');

    return json(res, { url: url.toString(), token: payload });
  }

  // POST /api/order/calculate
  if (pathname === '/api/order/calculate' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req));
    const resolvedBD = {};
    if (body.brand_discounts) {
      for (const [k, v] of Object.entries(body.brand_discounts)) {
        const full = resolveFullBrand(k);
        if (full) resolvedBD[full] = v;
      }
    }
    let grandTotal = 0;
    const lines = (body.items || []).map((item) => {
      const p = catalog.products.find((x) => x.code === item.code);
      if (!p) return { code: item.code, error: 'Not found' };
      const disc = resolvedBD[p.supplier] || 0;
      const up = applyDiscount(p.unit_price, disc);
      const bp = applyDiscount(p.bulk_price, disc);
      const unitTotal = (item.units || 0) * up;
      const bulkTotal = (item.bulks || 0) * bp;
      const lineTotal = unitTotal + bulkTotal;
      grandTotal += lineTotal;
      return {
        code: p.code, description: p.description, supplier: p.supplier,
        units: item.units || 0, unit_price: up, unit_subtotal: unitTotal,
        bulks: item.bulks || 0, bulk_price: bp, bulk_subtotal: bulkTotal,
        discount_pct: disc, line_total: lineTotal,
      };
    });
    return json(res, { lines, grand_total: grandTotal, formatted_total: formatARS(grandTotal) });
  }

  // Not found
  json(res, { error: 'Not found' }, 404);
}

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function streamFile(res, filePath, filename) {
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': stat.size,
    'Access-Control-Allow-Origin': '*',
  });
  fs.createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// Main HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // MCP endpoint
    if (pathname === '/mcp') {
      // CORS headers for MCP
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      return await handleMcp(req, res);
    }

    // REST API
    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname);
    }

    // Static files — try dist/ first (production build), then public/
    const distPath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
    if (serveStatic(res, distPath)) return;

    const publicPath = path.join(PUBLIC_DIR, pathname);
    if (serveStatic(res, publicPath)) return;

    // SPA fallback — serve index.html for client-side routing
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return serveStatic(res, indexPath);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    console.error('Request error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Catalog server running on http://0.0.0.0:${PORT}`);
  console.log(`  MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
  console.log(`  REST API:     http://0.0.0.0:${PORT}/api/...`);
  console.log(`  Frontend:     http://0.0.0.0:${PORT}/`);
});
