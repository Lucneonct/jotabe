import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------------------
// Paths & config
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_PATH = process.env.CATALOG_PATH || path.resolve(__dirname, '../../public/catalog.json');
const IMAGES_PATH = process.env.IMAGES_PATH || path.resolve(__dirname, '../../public/images');
const OUTPUT_PATH = process.env.OUTPUT_PATH || path.resolve(__dirname, '../output');

if (!fs.existsSync(OUTPUT_PATH)) fs.mkdirSync(OUTPUT_PATH, { recursive: true });

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] =
        a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }
  return matrix[a.length][b.length];
}

function smartSearch(query, limit = 20) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored = [];
  for (const product of catalog.products) {
    const desc = normalize(product.description);
    const supplier = normalize(product.supplier);
    const code = String(product.code);
    let score = 0;

    for (const term of terms) {
      if (code === term) { score += 100; continue; }
      if (desc.includes(term)) score += 10;
      if (supplier.includes(term)) score += 5;

      for (const word of desc.split(/\s+/)) {
        if (word.length < 3) continue;
        const d = levenshtein(term, word);
        if (d > 0 && d <= 2) score += 5 - d;
      }
      for (const word of supplier.split(/\s+/)) {
        if (word.length < 3) continue;
        const d = levenshtein(term, word);
        if (d > 0 && d <= 2) score += 3 - d;
      }
    }

    if (score > 0) scored.push({ ...product, _score: score });
  }

  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, limit);
}

function formatARS(price) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(price);
}

function applyDiscount(price, pct) {
  return price * (1 - pct / 100);
}

function resolveFullBrand(input) {
  const n = normalize(input);
  return catalog.categories.find((c) => normalize(c).includes(n)) || null;
}

// ---------------------------------------------------------------------------
// Token encoding (mirrors frontend App.vue logic for share URLs)
// ---------------------------------------------------------------------------
const TOKEN_SALT = 'No-es-un-secret-real-al-final-yo-cargo-los-pedidos-a-mano';

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

function encodeToken(payload) {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return encoded + '.' + simpleHash(json + TOKEN_SALT);
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------
function generatePDF(products, opts = {}) {
  const {
    title = 'Catálogo de Productos',
    filename = 'catalogo.pdf',
    brandDiscounts = {},
    itemDiscounts = {},
  } = opts;

  const outputFile = path.join(OUTPUT_PATH, filename);
  const hasAnyDiscount = Object.keys(brandDiscounts).length > 0 || Object.keys(itemDiscounts).length > 0;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const stream = fs.createWriteStream(outputFile);
    doc.pipe(stream);

    const logoPath = path.join(IMAGES_PATH, 'logo-jotabe.png');
    const logoExists = fs.existsSync(logoPath);
    if (logoExists) doc.image(logoPath, 40, 25, { width: 55 });

    const hx = logoExists ? 105 : 40;
    doc.fontSize(18).font('Helvetica-Bold').text(title, hx, 30);
    doc.fontSize(9).font('Helvetica').text(
      `Generado: ${new Date().toLocaleDateString('es-AR')}`,
      hx, 52,
    );

    const cols = hasAnyDiscount
      ? [
          { label: 'Cód.',        x: 40,  w: 40  },
          { label: 'Descripción', x: 82,  w: 145 },
          { label: 'Marca',       x: 229, w: 85  },
          { label: 'P.Unit.',     x: 316, w: 55  },
          { label: 'P.Bulto',     x: 373, w: 55  },
          { label: 'Dto%',        x: 430, w: 30  },
          { label: 'P.Unit.Dto.', x: 462, w: 55  },
          { label: 'P.Bulto Dto.',x: 519, w: 55  },
        ]
      : [
          { label: 'Cód.',        x: 40,  w: 50  },
          { label: 'Descripción', x: 92,  w: 200 },
          { label: 'Marca',       x: 294, w: 110 },
          { label: 'U/Bulto',     x: 406, w: 45  },
          { label: 'P.Unitario',  x: 453, w: 65  },
          { label: 'P.Bulto',     x: 520, w: 65  },
        ];

    const tableLeft = 40;
    const tableRight = cols[cols.length - 1].x + cols[cols.length - 1].w;
    const tableW = tableRight - tableLeft;
    const ROW_H = 13;

    function drawHeader(y) {
      doc.save();
      doc.rect(tableLeft, y - 2, tableW, 15).fill('#2563eb');
      doc.fillColor('white').fontSize(7).font('Helvetica-Bold');
      for (const c of cols) doc.text(c.label, c.x + 2, y, { width: c.w - 4, ellipsis: true });
      doc.restore();
      doc.fillColor('black');
      return y + 16;
    }

    let y = drawHeader(80);
    let rowIdx = 0;

    const grouped = new Map();
    for (const p of products) {
      if (!grouped.has(p.supplier)) grouped.set(p.supplier, []);
      grouped.get(p.supplier).push(p);
    }

    for (const [supplier, items] of grouped) {
      if (y > 770) { doc.addPage(); y = drawHeader(40); }

      const brandDisc = brandDiscounts[supplier] || 0;

      doc.save();
      doc.rect(tableLeft, y - 1, tableW, 14).fill('#e0e7ff');
      doc.fillColor('#1e40af').fontSize(8).font('Helvetica-Bold');
      const brandLabel = brandDisc > 0 ? `${supplier}  (${brandDisc}% dto.)` : supplier;
      doc.text(brandLabel, tableLeft + 4, y + 1, { width: tableW - 8 });
      doc.restore();
      doc.fillColor('black');
      y += 15;

      for (const product of items) {
        if (y > 780) { doc.addPage(); y = drawHeader(40); }

        if (rowIdx % 2 === 0) {
          doc.save();
          doc.rect(tableLeft, y - 1, tableW, ROW_H).fill('#f8f9fa');
          doc.restore();
          doc.fillColor('black');
        }

        doc.fontSize(6.5).font('Helvetica');
        const discount = itemDiscounts[product.code] || brandDisc || 0;

        if (hasAnyDiscount) {
          doc.text(String(product.code),      cols[0].x + 2, y, { width: cols[0].w - 4 });
          doc.text(product.description,        cols[1].x + 2, y, { width: cols[1].w - 4, ellipsis: true });
          doc.text(product.supplier.substring(0, 18), cols[2].x + 2, y, { width: cols[2].w - 4, ellipsis: true });
          doc.text(formatARS(product.unit_price), cols[3].x + 2, y, { width: cols[3].w - 4 });
          doc.text(formatARS(product.bulk_price), cols[4].x + 2, y, { width: cols[4].w - 4 });

          if (discount > 0) {
            doc.fillColor('#b45309').text(`${discount}%`, cols[5].x + 2, y, { width: cols[5].w - 4 });
            doc.fillColor('#059669');
            doc.text(formatARS(applyDiscount(product.unit_price, discount)), cols[6].x + 2, y, { width: cols[6].w - 4 });
            doc.text(formatARS(applyDiscount(product.bulk_price, discount)), cols[7].x + 2, y, { width: cols[7].w - 4 });
            doc.fillColor('black');
          } else {
            doc.text('-',  cols[5].x + 2, y, { width: cols[5].w - 4 });
            doc.text('-',  cols[6].x + 2, y, { width: cols[6].w - 4 });
            doc.text('-',  cols[7].x + 2, y, { width: cols[7].w - 4 });
          }
        } else {
          doc.text(String(product.code),        cols[0].x + 2, y, { width: cols[0].w - 4 });
          doc.text(product.description,          cols[1].x + 2, y, { width: cols[1].w - 4, ellipsis: true });
          doc.text(product.supplier.substring(0, 22), cols[2].x + 2, y, { width: cols[2].w - 4, ellipsis: true });
          doc.text(String(product.units_per_bulk), cols[3].x + 2, y, { width: cols[3].w - 4 });
          doc.text(formatARS(product.unit_price), cols[4].x + 2, y, { width: cols[4].w - 4 });
          doc.text(formatARS(product.bulk_price), cols[5].x + 2, y, { width: cols[5].w - 4 });
        }

        y += ROW_H;
        rowIdx++;
      }
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).font('Helvetica').fillColor('#6b7280');
      doc.text(`Página ${i + 1} de ${range.count}`, 40, 820, { align: 'center', width: tableW });
    }

    doc.end();
    stream.on('finish', () => resolve(outputFile));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Server factory — creates a fresh McpServer with all tools registered
// ---------------------------------------------------------------------------
export function createCatalogServer() {
  const server = new McpServer({
    name: 'catalog-mcp',
    version: '1.0.0',
    description: 'MCP server for Marce Catálogo – B2B wholesale product catalog',
  });

  // ── 0. ping ──────────────────────────────────────────────────────────────
  server.tool(
    'ping',
    'Health-check / warm-up tool. Call this FIRST after connecting. The server has a cold start of ~30-60s — if it times out, retry. Returns server status and catalog summary.',
    {},
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'ok',
          server: 'catalog-mcp',
          version: '1.0.0',
          catalog_loaded: true,
          total_products: catalog.products.length,
          total_brands: catalog.categories.length,
          timestamp: new Date().toISOString(),
        }, null, 2),
      }],
    }),
  );

  // ── 1. search_products ───────────────────────────────────────────────────
  server.tool(
    'search_products',
    'Smart search for products by name, description, code, or supplier. Uses multi-term + fuzzy matching.',
    {
      query: z.string().describe('Search query — product name, code, description, or supplier'),
      limit: z.number().optional().default(20).describe('Max results (default 20)'),
    },
    async ({ query, limit }) => {
      const results = smartSearch(query, limit);
      if (results.length === 0) return { content: [{ type: 'text', text: `No products found for "${query}"` }] };
      const clean = results.map(({ _score, ...rest }) => rest);
      return { content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }] };
    },
  );

  // ── 2. list_brands ───────────────────────────────────────────────────────
  server.tool(
    'list_brands',
    'List every brand/supplier in the catalog with their product count.',
    {},
    async () => {
      const brands = catalog.categories.map((b) => ({
        brand: b,
        product_count: catalog.products.filter((p) => p.supplier === b).length,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(brands, null, 2) }] };
    },
  );

  // ── 3. get_brand_products ────────────────────────────────────────────────
  server.tool(
    'get_brand_products',
    'Get all products for a brand/supplier (exact or partial match).',
    { brand: z.string().describe('Brand/supplier name (partial match OK)') },
    async ({ brand }) => {
      const n = normalize(brand);
      const products = catalog.products.filter((p) => normalize(p.supplier).includes(n));
      if (products.length === 0) return { content: [{ type: 'text', text: `No products for brand "${brand}"` }] };
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ brand: products[0].supplier, total: products.length, products }, null, 2),
        }],
      };
    },
  );

  // ── 4. get_product_by_id ─────────────────────────────────────────────────
  server.tool(
    'get_product_by_id',
    'Get a single product by its numeric code/ID.',
    { code: z.number().describe('Product code') },
    async ({ code }) => {
      const p = catalog.products.find((x) => x.code === code);
      if (!p) return { content: [{ type: 'text', text: `Product ${code} not found` }] };
      return { content: [{ type: 'text', text: JSON.stringify(p, null, 2) }] };
    },
  );

  // ── 5. export_catalog_pdf ────────────────────────────────────────────────
  server.tool(
    'export_catalog_pdf',
    'Export the full catalog (or filtered by brands) as a PDF price list. Returns the local file path.',
    {
      brands: z.array(z.string()).optional().describe('Filter by brands (partial match). Omit for all.'),
      filename: z.string().optional().default('catalogo.pdf').describe('Output filename'),
    },
    async ({ brands, filename }) => {
      let products = catalog.products;
      if (brands && brands.length > 0) {
        products = products.filter((p) => brands.some((b) => normalize(p.supplier).includes(normalize(b))));
      }
      if (products.length === 0) return { content: [{ type: 'text', text: 'No matching products to export.' }] };
      const file = await generatePDF(products, { title: 'Catálogo de Productos', filename });
      return { content: [{ type: 'text', text: `PDF generated (${products.length} products).\nFile: ${file}` }] };
    },
  );

  // ── 6. export_pdf_with_discounts ─────────────────────────────────────────
  server.tool(
    'export_pdf_with_discounts',
    'Export a PDF showing original and discounted prices for specified brands.',
    {
      brand_discounts: z.record(z.string(), z.number()).describe('Brand → discount %. E.g. {"FERRERO": 10}'),
      include_all_brands: z.boolean().optional().default(false).describe('Include brands without discounts too'),
      filename: z.string().optional().default('catalogo_descuentos.pdf').describe('Output filename'),
    },
    async ({ brand_discounts, include_all_brands, filename }) => {
      const resolved = {};
      for (const [input, disc] of Object.entries(brand_discounts)) {
        const full = resolveFullBrand(input);
        if (full) resolved[full] = disc;
      }
      let products = include_all_brands
        ? catalog.products
        : catalog.products.filter((p) => Object.keys(resolved).includes(p.supplier));
      if (products.length === 0) return { content: [{ type: 'text', text: 'No products matched the specified brands.' }] };
      const file = await generatePDF(products, { title: 'Catálogo con Descuentos', filename, brandDiscounts: resolved });
      return {
        content: [{ type: 'text', text: `PDF with discounts generated (${products.length} products).\nDiscounts: ${JSON.stringify(resolved)}\nFile: ${file}` }],
      };
    },
  );

  // ── 7. export_items_pdf ──────────────────────────────────────────────────
  server.tool(
    'export_items_pdf',
    'Export a PDF containing only specific products by code/ID. Use search_products first to find codes.',
    {
      item_codes: z.array(z.number()).describe('Product codes to include'),
      discounts: z.record(z.string(), z.number()).optional().describe('Per-item discounts: {"<code>": pct}'),
      filename: z.string().optional().default('productos_seleccionados.pdf').describe('Output filename'),
    },
    async ({ item_codes, discounts, filename }) => {
      const products = item_codes.map((c) => catalog.products.find((p) => p.code === c)).filter(Boolean);
      if (products.length === 0) return { content: [{ type: 'text', text: `No products found for codes: ${item_codes.join(', ')}` }] };
      const itemDisc = {};
      if (discounts) { for (const [k, v] of Object.entries(discounts)) itemDisc[Number(k)] = v; }
      const file = await generatePDF(products, { title: 'Productos Seleccionados', filename, itemDiscounts: itemDisc });
      const notFound = item_codes.filter((c) => !catalog.products.find((p) => p.code === c));
      let msg = `PDF generated (${products.length} products).\nFile: ${file}`;
      if (notFound.length) msg += `\nCodes not found: ${notFound.join(', ')}`;
      return { content: [{ type: 'text', text: msg }] };
    },
  );

  // ── 8. get_catalog_stats ─────────────────────────────────────────────────
  server.tool(
    'get_catalog_stats',
    'Overall catalog statistics: totals, price ranges, brand breakdown.',
    {},
    async () => {
      const prices = catalog.products.map((p) => p.unit_price);
      const stats = {
        total_products: catalog.products.length,
        total_brands: catalog.categories.length,
        price_range: {
          min: formatARS(Math.min(...prices)),
          max: formatARS(Math.max(...prices)),
          average: formatARS(prices.reduce((a, b) => a + b, 0) / prices.length),
        },
        brands: catalog.categories
          .map((b) => ({ name: b, products: catalog.products.filter((p) => p.supplier === b).length }))
          .sort((a, b) => b.products - a.products),
      };
      return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
    },
  );

  // ── 9. calculate_order ───────────────────────────────────────────────────
  server.tool(
    'calculate_order',
    'Calculate order total. Supports unit + bulk quantities and optional brand discounts.',
    {
      items: z.array(z.object({
        code: z.number().describe('Product code'),
        units: z.number().optional().default(0).describe('Individual units'),
        bulks: z.number().optional().default(0).describe('Bulk packages'),
      })).describe('Items in the order'),
      brand_discounts: z.record(z.string(), z.number()).optional().describe('Brand discounts: {"brand": pct}'),
    },
    async ({ items, brand_discounts }) => {
      const resolvedBD = {};
      if (brand_discounts) {
        for (const [k, v] of Object.entries(brand_discounts)) {
          const full = resolveFullBrand(k);
          if (full) resolvedBD[full] = v;
        }
      }
      let grandTotal = 0;
      const lines = items.map((item) => {
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
      return {
        content: [{ type: 'text', text: JSON.stringify({ lines, grand_total: grandTotal, formatted_total: formatARS(grandTotal) }, null, 2) }],
      };
    },
  );

  // ── 10. generate_whatsapp_order ──────────────────────────────────────────
  server.tool(
    'generate_whatsapp_order',
    'Build a WhatsApp message with the full order detail and return the wa.me link.',
    {
      items: z.array(z.object({
        code: z.number(),
        units: z.number().optional().default(0),
        bulks: z.number().optional().default(0),
      })).describe('Items in the order'),
      brand_discounts: z.record(z.string(), z.number()).optional().describe('Brand discounts'),
      customer_name: z.string().optional().describe('Customer name'),
    },
    async ({ items, brand_discounts, customer_name }) => {
      const resolvedBD = {};
      if (brand_discounts) {
        for (const [k, v] of Object.entries(brand_discounts)) {
          const full = resolveFullBrand(k);
          if (full) resolvedBD[full] = v;
        }
      }
      let grandTotal = 0;
      const orderLines = [];
      for (const item of items) {
        const p = catalog.products.find((x) => x.code === item.code);
        if (!p) continue;
        const disc = resolvedBD[p.supplier] || 0;
        const up = applyDiscount(p.unit_price, disc);
        const bp = applyDiscount(p.bulk_price, disc);
        const unitTotal = (item.units || 0) * up;
        const bulkTotal = (item.bulks || 0) * bp;
        const lineTotal = unitTotal + bulkTotal;
        grandTotal += lineTotal;
        const parts = [];
        if (item.units) parts.push(`${item.units} un.`);
        if (item.bulks) parts.push(`${item.bulks} bulto(s)`);
        const discLabel = disc > 0 ? ` (-${disc}%)` : '';
        orderLines.push(`• [${p.code}] ${p.description} — ${parts.join(' + ')}${discLabel} → ${formatARS(lineTotal)}`);
      }
      let msg = '\u{1F6D2} *Nuevo Pedido*\n';
      if (customer_name) msg += `\u{1F464} Cliente: ${customer_name}\n`;
      msg += `\u{1F4C5} Fecha: ${new Date().toLocaleDateString('es-AR')}\n\n`;
      msg += orderLines.join('\n');
      msg += `\n\n\u{1F4B0} *Total: ${formatARS(grandTotal)}*`;
      const waUrl = `https://wa.me/5493764909072?text=${encodeURIComponent(msg)}`;
      return { content: [{ type: 'text', text: `WhatsApp message:\n\n${msg}\n\n---\nLink: ${waUrl}` }] };
    },
  );

  // ── 11. compare_products ─────────────────────────────────────────────────
  server.tool(
    'compare_products',
    'Compare two or more products side-by-side (prices, bulk info, supplier).',
    { codes: z.array(z.number()).min(2).describe('Product codes to compare') },
    async ({ codes }) => {
      const products = codes.map((c) => catalog.products.find((p) => p.code === c)).filter(Boolean);
      if (products.length < 2) return { content: [{ type: 'text', text: 'Need at least 2 valid product codes.' }] };
      const comparison = products.map((p) => ({
        code: p.code, description: p.description, supplier: p.supplier,
        unit_price: p.unit_price, unit_price_formatted: formatARS(p.unit_price),
        bulk_price: p.bulk_price, bulk_price_formatted: formatARS(p.bulk_price),
        units_per_bulk: p.units_per_bulk,
        price_per_unit_in_bulk: p.bulk_price / p.units_per_bulk,
        price_per_unit_in_bulk_formatted: formatARS(p.bulk_price / p.units_per_bulk),
        bulk_savings_pct: ((1 - p.bulk_price / p.units_per_bulk / p.unit_price) * 100).toFixed(1) + '%',
      }));
      return { content: [{ type: 'text', text: JSON.stringify(comparison, null, 2) }] };
    },
  );

  // ── 12. generate_custom_page ─────────────────────────────────────────────
  server.tool(
    'generate_custom_page',
    'Generate a custom catalog page URL with discounts pre-applied. Works like the web editor.',
    {
      brand_discounts: z.record(z.string(), z.number()).optional().describe('Brand discounts: {"brand": pct}'),
      item_discounts: z.record(z.string(), z.number()).optional().describe('Per-product discounts: {"code": pct}'),
      editor_mode: z.boolean().optional().default(false).describe('If true, recipient can edit discounts'),
      base_url: z.string().optional().default('https://jotabe.onrender.com').describe('Base URL of the catalog app'),
    },
    async ({ brand_discounts, item_discounts, editor_mode, base_url }) => {
      const payload = {};

      if (brand_discounts && Object.keys(brand_discounts).length > 0) {
        const bd = {};
        for (const [input, pct] of Object.entries(brand_discounts)) {
          const fullBrand = resolveFullBrand(input);
          if (fullBrand && pct > 0) {
            const idx = catalog.categories.indexOf(fullBrand);
            if (idx >= 0) bd[idx] = pct;
          }
        }
        if (Object.keys(bd).length) payload.bd = bd;
      }

      if (item_discounts && Object.keys(item_discounts).length > 0) {
        const d = {};
        for (const [code, pct] of Object.entries(item_discounts)) {
          if (pct > 0) d[code] = pct;
        }
        if (Object.keys(d).length) payload.d = d;
      }

      const url = new URL(base_url);
      if (Object.keys(payload).length) url.searchParams.set('t', encodeToken(payload));
      if (editor_mode) url.searchParams.set('editor', '');

      const summary = [];
      if (payload.bd) {
        for (const [idx, pct] of Object.entries(payload.bd))
          summary.push(`${catalog.categories[Number(idx)]}: ${pct}% off`);
      }
      if (payload.d) {
        for (const [code, pct] of Object.entries(payload.d)) {
          const p = catalog.products.find((x) => x.code === Number(code));
          summary.push(`[${code}] ${p ? p.description : 'unknown'}: ${pct}% off`);
        }
      }

      return {
        content: [{
          type: 'text',
          text: [
            `Custom catalog page URL:`,
            url.toString(),
            ``,
            `Mode: ${editor_mode ? 'Editor (can modify discounts)' : 'Read-only (discounts locked)'}`,
            summary.length ? `\nDiscounts encoded:\n${summary.map((s) => '  • ' + s).join('\n')}` : 'No discounts applied.',
          ].join('\n'),
        }],
      };
    },
  );

  return server;
}

export { catalog, smartSearch, generatePDF, formatARS, applyDiscount, resolveFullBrand, encodeToken, normalize, OUTPUT_PATH };
