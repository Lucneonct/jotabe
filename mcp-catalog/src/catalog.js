import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Paths & config
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CATALOG_PATH = process.env.CATALOG_PATH || path.resolve(__dirname, '../../public/catalog.json');
const IMAGES_PATH = process.env.IMAGES_PATH || path.resolve(__dirname, '../../public/images');

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
// PDF generation — table layout matching presupuesto style
// ---------------------------------------------------------------------------

// Image cache: WebP → PNG buffer (avoids re-converting same image)
const imageCache = new Map();

async function getProductImage(product) {
  if (!product.images || product.images.length === 0) return null;
  const imgFile = product.images[0];
  const imgPath = path.join(IMAGES_PATH, imgFile);
  if (!fs.existsSync(imgPath)) return null;

  if (imageCache.has(imgPath)) return imageCache.get(imgPath);
  try {
    const png = await sharp(imgPath).resize(50, 50, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();
    imageCache.set(imgPath, png);
    return png;
  } catch { return null; }
}

// opts.cartItems: { [code]: { units, bulks } } — when present, cart mode
async function generatePDF(products, opts = {}) {
  const {
    title = 'Catálogo de Productos',
    filename = 'catalogo.pdf',
    brandDiscounts = {},
    itemDiscounts = {},
    cartItems = null, // null = catalog mode, object = cart mode
  } = opts;

  const hasAnyDiscount = Object.keys(brandDiscounts).length > 0 || Object.keys(itemDiscounts).length > 0;
  const isCart = cartItems && Object.keys(cartItems).length > 0;

  // Pre-load all product images in parallel
  const imageMap = new Map();
  await Promise.all(products.map(async (p) => {
    const img = await getProductImage(p);
    if (img) imageMap.set(p.code, img);
  }));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, autoFirstPage: false });
    doc.addPage();
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    const PAGE_W = 595.28;
    const MARGIN = 40;
    const CONTENT_W = PAGE_W - MARGIN * 2;
    const ROW_H = 65;
    const IMG_SIZE = 45;

    // Column layouts per mode
    const COL_IMG = MARGIN;
    const COL_DETAIL = MARGIN + 60;
    let COL_QTY, COL_PRICE, COL_LAST;

    if (isCart) {
      // IMAGEN | DETALLE | CANTIDAD | PRECIO UNIT. | SUBTOTAL
      COL_QTY = MARGIN + 240;
      COL_PRICE = MARGIN + 320;
      COL_LAST = MARGIN + 420;
    } else if (hasAnyDiscount) {
      // IMAGEN | DETALLE | PRECIO LISTA | PRECIO BONIFICADO
      COL_PRICE = MARGIN + 300;
      COL_LAST = MARGIN + 420;
    } else {
      // IMAGEN | DETALLE | PRECIO UNITARIO
      COL_PRICE = MARGIN + 360;
    }

    // ── Title with logo ──
    const logoPath = path.join(IMAGES_PATH, 'logo-jotabe.png');
    const logoExists = fs.existsSync(logoPath);

    // Logo is 143x63 (ratio ~2.27:1)
    const LOGO_H = 35;
    const LOGO_W = Math.round(LOGO_H * 2.27); // ~80

    function drawTitle(y) {
      if (logoExists) {
        doc.image(logoPath, MARGIN, y, { width: LOGO_W, height: LOGO_H });
      }
      const textX = logoExists ? MARGIN + LOGO_W + 10 : MARGIN;
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#111827');
      doc.text(title, textX, y, { width: CONTENT_W - (textX - MARGIN) });
      doc.fontSize(9).font('Helvetica').fillColor('#6b7280');
      doc.text(new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' }), textX, y + 26);
      doc.fillColor('black');
      return y + 50;
    }

    // ── Brand header ──
    function drawBrandHeader(supplier, brandDisc, y) {
      doc.save();
      doc.roundedRect(MARGIN, y, CONTENT_W, 24, 3).fill('#374151');
      doc.fillColor('white').fontSize(10).font('Helvetica-Bold');
      doc.text(supplier, MARGIN + 10, y + 6, { width: CONTENT_W - 80, lineBreak: false });
      if (brandDisc > 0) {
        const pillX = PAGE_W - MARGIN - 55;
        doc.roundedRect(pillX, y + 3, 45, 18, 9).fill('#059669');
        doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
        doc.text(`-${brandDisc}%`, pillX, y + 7, { width: 45, align: 'center', lineBreak: false });
      }
      doc.restore();
      doc.fillColor('black');
      return y + 30;
    }

    // ── Column headers ──
    function drawColumnHeaders(y) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor('#6b7280');
      doc.text('IMAGEN', COL_IMG, y, { width: 55, lineBreak: false });
      doc.text('DETALLE PRODUCTO', COL_DETAIL, y, { width: 170, lineBreak: false });

      if (isCart) {
        doc.text('CANTIDAD', COL_QTY, y, { width: 70, lineBreak: false });
        doc.text('PRECIO UNITARIO', COL_PRICE, y, { width: 90, lineBreak: false });
        doc.text('SUBTOTAL', COL_LAST, y, { width: 90, lineBreak: false });
      } else if (hasAnyDiscount) {
        doc.text('PRECIO UNITARIO\nLISTA', COL_PRICE, y - 2, { width: 100 });
        doc.text('PRECIO BONIFICADO', COL_LAST, y, { width: 100, lineBreak: false });
      } else {
        doc.text('PRECIO UNITARIO', COL_PRICE, y, { width: 100, lineBreak: false });
      }

      doc.fillColor('black');
      const ly = y + 14;
      doc.moveTo(MARGIN, ly).lineTo(PAGE_W - MARGIN, ly).strokeColor('#d1d5db').lineWidth(0.5).stroke();
      return ly + 4;
    }

    // ── Product row ── returns line subtotal for cart mode
    function drawProductRow(product, discount, y) {
      // Image
      if (imageMap.has(product.code)) {
        try {
          doc.image(imageMap.get(product.code), COL_IMG + 2, y + 2, {
            width: IMG_SIZE, height: IMG_SIZE, fit: [IMG_SIZE, IMG_SIZE],
          });
        } catch { /* skip */ }
      }

      // Code
      doc.fillColor('#059669').fontSize(9).font('Helvetica-Bold');
      doc.text(`#${product.code}`, COL_DETAIL, y + 2, { width: 170, lineBreak: false });

      // Description
      doc.fillColor('#111827').fontSize(9).font('Helvetica');
      doc.text(product.description, COL_DETAIL, y + 14, { width: 170, height: 22, ellipsis: true });

      // Units per bulk
      doc.fillColor('#9ca3af').fontSize(7).font('Helvetica');
      doc.text(`${product.units_per_bulk} unid/bulto`, COL_DETAIL, y + 38, { width: 170, lineBreak: false });

      let lineSubtotal = 0;

      if (isCart) {
        const cart = cartItems[product.code] || { units: 0, bulks: 0 };
        const units = cart.units || 0;
        const bulks = cart.bulks || 0;
        const up = discount > 0 ? applyDiscount(product.unit_price, discount) : product.unit_price;
        const bp = discount > 0 ? applyDiscount(product.bulk_price, discount) : product.bulk_price;

        // Quantity
        const qtyParts = [];
        if (units > 0) qtyParts.push(`${units} unid.`);
        if (bulks > 0) qtyParts.push(`${bulks} bulto${bulks > 1 ? 's' : ''}`);
        doc.fillColor('#111827').fontSize(9).font('Helvetica');
        doc.text(qtyParts.join('\n'), COL_QTY, y + 12, { width: 75 });

        // Unit price
        doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold');
        doc.text(formatARS(up), COL_PRICE, y + 12, { width: 95, lineBreak: false });
        if (discount > 0) {
          doc.fillColor('#9ca3af').fontSize(7).font('Helvetica');
          doc.text(`(-${discount}%)`, COL_PRICE, y + 24, { width: 95, lineBreak: false });
        }

        // Subtotal
        lineSubtotal = (units * up) + (bulks * bp);
        doc.fillColor('#059669').fontSize(10).font('Helvetica-Bold');
        doc.text(formatARS(lineSubtotal), COL_LAST, y + 12, { width: 95, lineBreak: false });

      } else if (hasAnyDiscount) {
        // List price
        doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold');
        doc.text(formatARS(product.unit_price), COL_PRICE, y + 18, { width: 100, lineBreak: false });

        // Bonified price
        if (discount > 0) {
          const discPrice = applyDiscount(product.unit_price, discount);
          const savings = product.unit_price - discPrice;
          doc.fillColor('#059669').fontSize(10).font('Helvetica-Bold');
          doc.text(formatARS(discPrice), COL_LAST, y + 15, { width: 100, lineBreak: false });
          doc.fillColor('#9ca3af').fontSize(7).font('Helvetica');
          doc.text(`(-${formatARS(savings)})`, COL_LAST, y + 28, { width: 100, lineBreak: false });
        }
      } else {
        // Simple price
        doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold');
        doc.text(formatARS(product.unit_price), COL_PRICE, y + 18, { width: 100, lineBreak: false });
      }

      // Row divider
      const ly = y + ROW_H - 4;
      doc.moveTo(MARGIN, ly).lineTo(PAGE_W - MARGIN, ly).strokeColor('#e5e7eb').lineWidth(0.3).stroke();
      doc.fillColor('black');
      return lineSubtotal;
    }

    // ── Render ──
    let y = drawTitle(30);
    let grandTotal = 0;
    let grandOriginal = 0;

    const grouped = new Map();
    for (const p of products) {
      if (!grouped.has(p.supplier)) grouped.set(p.supplier, []);
      grouped.get(p.supplier).push(p);
    }

    for (const [supplier, items] of grouped) {
      const brandDisc = brandDiscounts[supplier] || 0;

      if (y + 30 + 18 + ROW_H > 800) {
        doc.addPage();
        y = 40;
      }

      y = drawBrandHeader(supplier, brandDisc, y);
      y = drawColumnHeaders(y);

      for (const product of items) {
        if (y + ROW_H > 800) {
          doc.addPage();
          y = 40;
          y = drawColumnHeaders(y);
        }

        const discount = itemDiscounts[product.code] || brandDisc || 0;
        const sub = drawProductRow(product, discount, y);
        grandTotal += sub;

        // Track original total for cart summary
        if (isCart) {
          const cart = cartItems[product.code] || { units: 0, bulks: 0 };
          grandOriginal += ((cart.units || 0) * product.unit_price) + ((cart.bulks || 0) * product.bulk_price);
        }

        y += ROW_H;
      }

      y += 10;
    }

    // ── Cart summary ──
    if (isCart) {
      const SUMMARY_H = 80;
      if (y + SUMMARY_H > 800) {
        doc.addPage();
        y = 40;
      }

      y += 5;
      doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor('#374151').lineWidth(1).stroke();
      y += 10;

      const labelX = PAGE_W - MARGIN - 250;
      const valueX = PAGE_W - MARGIN - 100;

      if (grandOriginal !== grandTotal) {
        // Has discounts — show original, discount, final
        const discountAmt = grandOriginal - grandTotal;
        doc.fillColor('#6b7280').fontSize(9).font('Helvetica');
        doc.text('Subtotal sin descuento:', labelX, y, { width: 145, align: 'right', lineBreak: false });
        doc.fillColor('#111827').fontSize(9).font('Helvetica');
        doc.text(formatARS(grandOriginal), valueX, y, { width: 100, align: 'right', lineBreak: false });
        y += 16;

        doc.fillColor('#059669').fontSize(9).font('Helvetica');
        doc.text('Descuento total:', labelX, y, { width: 145, align: 'right', lineBreak: false });
        doc.fillColor('#059669').fontSize(9).font('Helvetica-Bold');
        doc.text(`-${formatARS(discountAmt)}`, valueX, y, { width: 100, align: 'right', lineBreak: false });
        y += 18;
      }

      doc.fillColor('#111827').fontSize(12).font('Helvetica-Bold');
      doc.text('TOTAL:', labelX, y, { width: 145, align: 'right', lineBreak: false });
      doc.fillColor('#059669').fontSize(12).font('Helvetica-Bold');
      doc.text(formatARS(grandTotal), valueX, y, { width: 100, align: 'right', lineBreak: false });
      y += 20;
    }

    // Footer
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af');
    if (y + 15 > 810) { doc.addPage(); y = 40; }
    doc.text('* Precios con IVA incluido', PAGE_W - MARGIN - 130, y + 10, { width: 130, align: 'right', lineBreak: false });

    // ── Page numbers (use _pageBuffer length to avoid doc.text creating pages) ──
    const pageCount = doc._pageBuffer.length;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const str = `Página ${i + 1} de ${pageCount}`;
      doc.fontSize(7).font('Helvetica').fillColor('#9ca3af');
      const strW = doc.widthOfString(str);
      doc._root.data.Pages.data.Count = pageCount; // lock page count
      doc.text(str, MARGIN + (CONTENT_W - strW) / 2, 820, { lineBreak: false });
    }

    doc.end();
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// PDF store bridge — http.js injects the store function at startup
// ---------------------------------------------------------------------------
let _storePdf = null;
function setPdfStore(fn) { _storePdf = fn; }

function pdfToolResult(buffer, filename, summary) {
  const baseUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');

  if (_storePdf) {
    const id = _storePdf(buffer, filename);
    const url = `${baseUrl}/api/pdf/download/${id}`;
    return {
      content: [{
        type: 'text',
        text: `PDF generated: **${filename}** (${summary}, ${(buffer.length / 1024).toFixed(0)} KB)\n\nDownload: ${url}\n\n_Link expires in 5 minutes._`,
      }],
    };
  }

  // Fallback for stdio mode (no http server) — return embedded resource
  return {
    content: [
      { type: 'text', text: `PDF generated: ${filename} (${summary}, ${(buffer.length / 1024).toFixed(0)} KB)` },
      { type: 'resource', resource: { uri: `pdf://${filename}`, mimeType: 'application/pdf', blob: buffer.toString('base64') } },
    ],
  };
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
    'Export the full catalog (or filtered by brands) as a PDF price list. Returns the PDF as a downloadable file. Ask the user what filename they want before calling.',
    {
      brands: z.array(z.string()).optional().describe('Filter by brands (partial match). Omit for all.'),
      filename: z.string().optional().default('catalogo.pdf').describe('Output filename — ask the user, default: catalogo.pdf'),
    },
    async ({ brands, filename }) => {
      let products = catalog.products;
      if (brands && brands.length > 0) {
        products = products.filter((p) => brands.some((b) => normalize(p.supplier).includes(normalize(b))));
      }
      if (products.length === 0) return { content: [{ type: 'text', text: 'No matching products to export.' }] };
      const buffer = await generatePDF(products, { title: 'Catálogo de Productos', filename });
      return pdfToolResult(buffer, filename, `${products.length} products`);
    },
  );

  // ── 6. export_pdf_with_discounts ─────────────────────────────────────────
  server.tool(
    'export_pdf_with_discounts',
    'Export a PDF showing original and discounted prices for specified brands. Returns the PDF as a downloadable file. Ask the user what filename they want before calling.',
    {
      brand_discounts: z.record(z.string(), z.number()).describe('Brand → discount %. E.g. {"FERRERO": 10}'),
      include_all_brands: z.boolean().optional().default(false).describe('Include brands without discounts too'),
      filename: z.string().optional().default('catalogo_descuentos.pdf').describe('Output filename — ask the user, default: catalogo_descuentos.pdf'),
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
      const buffer = await generatePDF(products, { title: 'Catálogo con Descuentos', filename, brandDiscounts: resolved });
      return pdfToolResult(buffer, filename, `${products.length} products, discounts: ${JSON.stringify(resolved)}`);
    },
  );

  // ── 7. export_items_pdf ──────────────────────────────────────────────────
  server.tool(
    'export_items_pdf',
    'Export a PDF for specific cart items with quantities. Use search_products first to find codes. Shows quantity, unit price, subtotal per item, and grand total. Returns downloadable PDF.',
    {
      items: z.array(z.object({
        code: z.number().describe('Product code'),
        units: z.number().optional().default(0).describe('Individual units ordered'),
        bulks: z.number().optional().default(0).describe('Bulk packages ordered'),
      })).describe('Cart items with quantities'),
      brand_discounts: z.record(z.string(), z.number()).optional().describe('Brand discounts: {"brand": pct}'),
      item_discounts: z.record(z.string(), z.number()).optional().describe('Per-item discounts: {"<code>": pct}'),
      filename: z.string().optional().default('presupuesto.pdf').describe('Output filename'),
    },
    async ({ items, brand_discounts, item_discounts, filename }) => {
      const codes = items.map(i => i.code);
      const products = codes.map((c) => catalog.products.find((p) => p.code === c)).filter(Boolean);
      if (products.length === 0) return { content: [{ type: 'text', text: `No products found for given codes` }] };

      const resolvedBD = {};
      if (brand_discounts) {
        for (const [k, v] of Object.entries(brand_discounts)) {
          const full = resolveFullBrand(k);
          if (full) resolvedBD[full] = v;
        }
      }
      const itemDisc = {};
      if (item_discounts) { for (const [k, v] of Object.entries(item_discounts)) itemDisc[Number(k)] = v; }

      const cartMap = {};
      for (const item of items) cartMap[item.code] = { units: item.units || 0, bulks: item.bulks || 0 };

      const buffer = await generatePDF(products, {
        title: 'Presupuesto',
        filename,
        brandDiscounts: resolvedBD,
        itemDiscounts: itemDisc,
        cartItems: cartMap,
      });
      const notFound = codes.filter((c) => !catalog.products.find((p) => p.code === c));
      let summary = `${products.length} products`;
      if (notFound.length) summary += `. Codes not found: ${notFound.join(', ')}`;
      return pdfToolResult(buffer, filename, summary);
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

export { catalog, smartSearch, generatePDF, formatARS, applyDiscount, resolveFullBrand, encodeToken, normalize, setPdfStore };
