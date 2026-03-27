<script setup>
import { ref, computed, onMounted, watch } from 'vue'

const TOKEN_SALT = 'No-es-un-secret-real-al-final-yo-cargo-los-pedidos-a-mano'

function simpleHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

function encodeToken(payload) {
  const json = JSON.stringify(payload)
  const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return encoded + '.' + simpleHash(json + TOKEN_SALT)
}

function decodeToken(token) {
  try {
    const [encoded, hash] = token.split('.')
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - encoded.length % 4) % 4)
    const json = atob(padded)
    if (simpleHash(json + TOKEN_SALT) !== hash) return null
    return JSON.parse(json)
  } catch (e) { return null }
}

const catalog = ref({ categories: [], products: [] })
const search = ref('')
const selectedCategory = ref('')
const selectedProduct = ref(null)
const loading = ref(true)
const base = import.meta.env.BASE_URL

// ── Cart ──
const cart = ref({}) // { [code]: { product, units: number, bulks: number } }
const showCart = ref(false)
const showDiscountPanel = ref(false)
const discounts = ref({}) // { [code]: percentage }
const expandedModalImg = ref(false)
const brandDiscounts = ref({})
const isEditor = ref(false)
const editorBrandSelect = ref('')
const editorBrandPct = ref(10)
const shareTooltip = ref(false)
let handlingPopstate = false
const CART_KEY = 'catalogo-cart'

const cartItemCount = computed(() => {
  return Object.values(cart.value).reduce((sum, item) => sum + item.units + item.bulks, 0)
})

const cartItems = computed(() => Object.values(cart.value))

const cartOriginal = computed(() => {
  return cartItems.value.reduce((sum, item) => {
    return sum + (item.product.unit_price || 0) * item.units + (item.product.bulk_price || 0) * item.bulks
  }, 0)
})

const cartTotal = computed(() => {
  return cartItems.value.reduce((sum, item) => {
    const subtotal = (item.product.unit_price || 0) * item.units + (item.product.bulk_price || 0) * item.bulks
    const disc = discounts.value[item.product.code] || 0
    return sum + subtotal * (1 - disc / 100)
  }, 0)
})

const cartSavings = computed(() => cartOriginal.value - cartTotal.value)

function addUnit(product) {
  if (!cart.value[product.code]) {
    cart.value[product.code] = { product, units: 0, bulks: 0 }
  }
  cart.value[product.code].units++
}

function removeUnit(product) {
  const item = cart.value[product.code]
  if (!item) return
  item.units--
  if (item.units <= 0 && item.bulks <= 0) delete cart.value[product.code]
}

function addBulk(product) {
  if (!cart.value[product.code]) {
    cart.value[product.code] = { product, units: 0, bulks: 0 }
  }
  cart.value[product.code].bulks++
}

function removeBulk(product) {
  const item = cart.value[product.code]
  if (!item) return
  item.bulks--
  if (item.units <= 0 && item.bulks <= 0) delete cart.value[product.code]
}

function removeFromCart(code) {
  delete cart.value[code]
  delete discounts.value[code]
}

function clearCart() {
  cart.value = {}
  discounts.value = {}
}

function getCartItem(code) {
  return cart.value[code] || null
}

function setDiscount(code, pct) {
  const val = Math.max(0, Math.min(100, pct || 0))
  if (val > 0) {
    discounts.value[code] = val
  } else {
    delete discounts.value[code]
  }
}

function getDiscount(code) {
  if (discounts.value[code]) return discounts.value[code]
  const product = productByCode.value[code]
  if (product && brandDiscounts.value[product.supplier]) {
    return brandDiscounts.value[product.supplier]
  }
  return 0
}

function handleDiscountInput(code, event) {
  let val = Math.round(+event.target.value || 0)
  val = Math.max(0, Math.min(100, val))
  setDiscount(code, val)
  if (+event.target.value !== val) event.target.value = val || ''
}

// ── Brand discounts ──
function setBrandDiscount(supplier, pct) {
  const val = Math.max(0, Math.min(100, pct || 0))
  if (val > 0) {
    brandDiscounts.value[supplier] = val
  } else {
    delete brandDiscounts.value[supplier]
  }
}

function addEditorBrandDiscount() {
  if (editorBrandSelect.value && editorBrandPct.value > 0) {
    setBrandDiscount(editorBrandSelect.value, editorBrandPct.value)
  }
}

// ── URL discount params (encoded token) ──
function parseUrlDiscounts() {
  const params = new URLSearchParams(window.location.search)
  isEditor.value = params.has('editor')

  const token = params.get('t')
  if (!token) return

  const payload = decodeToken(token)
  if (!payload) return

  const cats = catalog.value.categories

  if (payload.bd) {
    for (const [idx, pct] of Object.entries(payload.bd)) {
      const supplier = cats[Number(idx)]
      if (supplier && pct > 0) brandDiscounts.value[supplier] = pct
    }
  }

  if (payload.d) {
    for (const [code, pct] of Object.entries(payload.d)) {
      if (pct > 0) discounts.value[code] = pct
    }
  }
}

function generateShareUrl() {
  const pageUrl = window.location.href.split('?')[0]
  const url = new URL(pageUrl)

  const payload = {}

  const cats = catalog.value.categories
  const bd = {}
  for (const [supplier, pct] of Object.entries(brandDiscounts.value)) {
    const catIndex = cats.indexOf(supplier)
    if (pct > 0 && catIndex >= 0) bd[catIndex] = pct
  }
  if (Object.keys(bd).length) payload.bd = bd

  const d = {}
  for (const [code, pct] of Object.entries(discounts.value)) {
    if (pct > 0) d[code] = pct
  }
  if (Object.keys(d).length) payload.d = d

  if (Object.keys(payload).length) {
    url.searchParams.set('t', encodeToken(payload))
  }

  return url.toString()
}

function copyShareUrl() {
  const url = generateShareUrl()
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
  } else {
    const ta = document.createElement('textarea')
    ta.value = url
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  shareTooltip.value = true
  setTimeout(() => shareTooltip.value = false, 2000)
}

function clearDiscountConfig() {
  brandDiscounts.value = {}
  discounts.value = {}
}

// ── Cart persistence ──
function saveCart() {
  const data = {}
  for (const [code, item] of Object.entries(cart.value)) {
    data[code] = { units: item.units, bulks: item.bulks }
  }
  localStorage.setItem(CART_KEY, JSON.stringify(data))
  localStorage.setItem(CART_KEY + ':discounts', JSON.stringify(discounts.value))
}

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY)
    if (raw) {
      const data = JSON.parse(raw)
      for (const [code, qty] of Object.entries(data)) {
        const product = catalog.value.products.find(p => String(p.code) === String(code))
        if (product && (qty.units > 0 || qty.bulks > 0)) {
          cart.value[code] = { product, units: qty.units || 0, bulks: qty.bulks || 0 }
        }
      }
    }
    const rawDisc = localStorage.getItem(CART_KEY + ':discounts')
    if (rawDisc) discounts.value = JSON.parse(rawDisc)
  } catch (e) { /* ignore corrupt data */ }
}

watch(cart, saveCart, { deep: true })
watch(discounts, saveCart, { deep: true })

function formatBulkEquiv(item) {
  const p = item.product
  if (!p.units_per_bulk) return ''
  const totalUnits = item.units + item.bulks * p.units_per_bulk
  const bulkEquiv = totalUnits / p.units_per_bulk
  return Number.isInteger(bulkEquiv) ? String(bulkEquiv) : bulkEquiv.toFixed(3).replace('.', ',')
}

function openCart() {
  showCart.value = true
  document.body.style.overflow = 'hidden'
  history.pushState({ modal: 'cart' }, '')
}

function closeCart() {
  showCart.value = false
  document.body.style.overflow = ''
  if (!handlingPopstate) history.back()
}

function sendToWhatsApp() {
  const lines = ['*Pedido:*', '']
  for (const item of cartItems.value) {
    const p = item.product
    if (item.units > 0) {
      const subtotal = (p.unit_price || 0) * item.units
      lines.push(`- ${item.units}x unid. #${p.code} ${p.description} (${formatPrice(subtotal)})`)
    }
    if (item.bulks > 0) {
      const subtotal = (p.bulk_price || 0) * item.bulks
      lines.push(`- ${item.bulks}x bulto #${p.code} ${p.description} (${formatPrice(subtotal)})`)
    }
    // Bulk equivalent info
    if (p.units_per_bulk && item.units > 0) {
      const equivStr = formatBulkEquiv(item)
      if (item.bulks > 0) {
        lines.push(`  (${item.bulks} bulto${item.bulks > 1 ? 's' : ''} + ${item.units} unid. = ${equivStr} bultos)`)
      } else {
        lines.push(`  (${item.units} unid. = ${equivStr} bultos)`)
      }
    }
    // Discount info
    const disc = discounts.value[p.code] || 0
    if (disc > 0) {
      const itemSubtotal = (p.unit_price || 0) * item.units + (p.bulk_price || 0) * item.bulks
      const discounted = itemSubtotal * (1 - disc / 100)
      lines.push(`  *-${disc}% desc.* → ${formatPrice(discounted)}`)
    }
  }
  lines.push('')
  if (cartSavings.value > 0) {
    lines.push(`Original: ${formatPrice(cartOriginal.value)}`)
    lines.push(`Descuento: -${formatPrice(cartSavings.value)}`)
  }
  lines.push(`*Total: ${formatPrice(cartTotal.value)}*`)

  const text = encodeURIComponent(lines.join('\n'))
  window.open(
    `https://api.whatsapp.com/send/?phone=5493764909072&text=${text}&type=phone_number&app_absent=0`,
    '_blank'
  )
}

// ── Catalog ──
onMounted(async () => {
  const res = await fetch(`${base}catalog.json`)
  catalog.value = await res.json()
  loading.value = false

  const params = new URLSearchParams(window.location.search)
  const hasUrlParams = params.has('t') || params.has('editor')

  loadCart()

  if (hasUrlParams) {
    discounts.value = {}
    parseUrlDiscounts()
  }
})

const productsWithImages = computed(() =>
  catalog.value.products.filter(p => p.images && p.images.length > 0)
)

const filteredProducts = computed(() => {
  let list = productsWithImages.value
  if (selectedCategory.value) {
    list = list.filter(p => p.supplier === selectedCategory.value)
  }
  if (search.value.trim()) {
    const terms = search.value.toLowerCase().trim().split(/\s+/)
    list = list.filter(p => {
      const text = `${p.code} ${p.description} ${p.supplier}`.toLowerCase()
      return terms.every(t => text.includes(t))
    })
  }
  return list
})

const productByCode = computed(() => {
  const map = {}
  for (const p of catalog.value.products) {
    map[p.code] = p
  }
  return map
})

const groupedBySupplier = computed(() => {
  const groups = {}
  for (const p of filteredProducts.value) {
    const key = p.supplier || 'Sin categoría'
    if (!groups[key]) groups[key] = []
    groups[key].push(p)
  }
  return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))
})

const offersProducts = computed(() => {
  return productsWithImages.value.filter(p => getDiscount(p.code) > 0)
})

const hasAnyDiscount = computed(() => {
  return Object.keys(brandDiscounts.value).length > 0 || Object.keys(discounts.value).length > 0
})

function formatPrice(n) {
  if (n == null) return '-'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

function openProduct(product) {
  selectedProduct.value = product
  showDiscountPanel.value = getDiscount(product.code) > 0
  expandedModalImg.value = false
  document.body.style.overflow = 'hidden'
  history.pushState({ modal: 'product' }, '')
}

function openProductFromCart(product) {
  showCart.value = false
  selectedProduct.value = product
  showDiscountPanel.value = getDiscount(product.code) > 0
  expandedModalImg.value = false
  history.replaceState({ modal: 'product' }, '')
}

function closeProduct() {
  if (!selectedProduct.value) return
  selectedProduct.value = null
  document.body.style.overflow = ''
  if (!handlingPopstate) history.back()
}

function selectCategory(cat) {
  selectedCategory.value = cat
}

function clearFilters() {
  search.value = ''
  selectedCategory.value = ''
}

onMounted(() => {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (showCart.value) closeCart()
      else if (selectedProduct.value) closeProduct()
    }
  })
  window.addEventListener('popstate', () => {
    handlingPopstate = true
    if (selectedProduct.value) closeProduct()
    else if (showCart.value) closeCart()
    handlingPopstate = false
  })
})
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-top">
        <h1 class="logo">Catálogo</h1>
        <div class="header-right">
          <span class="product-count" v-if="!loading">
            {{ filteredProducts.length }} productos
          </span>
          <button class="cart-btn" @click="openCart">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            <span class="cart-badge" v-if="cartItemCount > 0">{{ cartItemCount }}</span>
          </button>
        </div>
      </div>

      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          v-model="search"
          type="text"
          placeholder="Buscar por código o nombre..."
          class="search-input"
        />
        <button v-if="search" class="clear-btn" @click="search = ''">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div class="category-bar">
        <button class="cat-chip" :class="{ active: !selectedCategory }" @click="selectCategory('')">Todos</button>
        <button
          class="cat-chip"
          :class="{ active: selectedCategory === cat }"
          v-for="cat in catalog.categories"
          :key="cat"
          @click="selectCategory(cat)"
        >{{ cat }}</button>
      </div>
    </header>

    <!-- Editor panel -->
    <div v-if="isEditor" class="editor-panel">
      <div class="editor-header">
        <h3 class="editor-title">Editor de descuentos</h3>
        <div class="editor-actions">
          <button class="share-btn" @click="copyShareUrl" :disabled="!hasAnyDiscount">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            <span v-if="shareTooltip">Copiado!</span>
            <span v-else>Compartir URL</span>
          </button>
          <button class="clear-config-btn" @click="clearDiscountConfig" v-if="hasAnyDiscount">
            Limpiar todo
          </button>
        </div>
      </div>

      <div class="editor-brand-section">
        <label class="editor-label">Descuento por marca</label>
        <div class="editor-brand-form">
          <select v-model="editorBrandSelect" class="editor-select">
            <option value="">Seleccionar marca...</option>
            <option v-for="cat in catalog.categories" :key="cat" :value="cat">{{ cat }}</option>
          </select>
          <div class="editor-pct-input">
            <input type="number" v-model.number="editorBrandPct" min="1" max="100" class="editor-pct" />
            <span class="editor-pct-symbol">%</span>
          </div>
          <button class="editor-add-btn" @click="addEditorBrandDiscount" :disabled="!editorBrandSelect">+</button>
        </div>

        <div class="editor-brand-list" v-if="Object.keys(brandDiscounts).length > 0">
          <div class="editor-brand-item" v-for="(pct, supplier) in brandDiscounts" :key="supplier">
            <span class="editor-brand-name">{{ supplier }}</span>
            <span class="editor-brand-pct">-{{ pct }}%</span>
            <button class="editor-brand-remove" @click="setBrandDiscount(supplier, 0)">&times;</button>
          </div>
        </div>
      </div>

      <p class="editor-hint">Tocá un producto para agregar descuento individual</p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading">
      <div class="spinner"></div>
      <p>Cargando catálogo...</p>
    </div>

    <!-- Product grid -->
    <main v-else class="main">
      <div v-if="filteredProducts.length === 0" class="empty">
        <p>No se encontraron productos</p>
        <button class="clear-filters-btn" @click="clearFilters">Limpiar filtros</button>
      </div>

      <!-- Offers section -->
      <template v-if="hasAnyDiscount && offersProducts.length > 0">
        <h2 class="supplier-title offers-title">Ofertas</h2>
        <div class="product-grid">
          <div
            class="product-card offer-card"
            v-for="product in offersProducts"
            :key="'offer-' + product.code"
            @click="openProduct(product)"
          >
            <div class="card-image">
              <img
                :src="`${base}images/` + product.images[0]"
                :alt="product.description"
                loading="lazy"
              />
            </div>
            <div class="card-info">
              <span class="card-code">#{{ product.code }}</span>
              <p class="card-name">{{ product.description }}</p>
              <p class="card-price" v-if="product.unit_price">
                <span class="card-price-old">{{ formatPrice(product.unit_price) }}</span>
                {{ formatPrice(product.unit_price * (1 - getDiscount(product.code) / 100)) }}
                <span class="price-label">/ unidad</span>
              </p>
              <p class="card-price no-price" v-else>Consultar precio</p>
            </div>
            <div class="card-cart-badge" v-if="getCartItem(product.code)">
              {{ getCartItem(product.code).units + getCartItem(product.code).bulks }}
            </div>
            <div class="card-discount-badge">
              -{{ getDiscount(product.code) }}%
            </div>
          </div>
        </div>
      </template>

      <template v-for="[supplier, products] in groupedBySupplier" :key="supplier">
        <h2 class="supplier-title">
          {{ supplier }}
          <span class="supplier-discount-badge" v-if="brandDiscounts[supplier]">-{{ brandDiscounts[supplier] }}%</span>
        </h2>
        <div class="product-grid">
          <div
            class="product-card"
            v-for="product in products"
            :key="product.code"
            @click="openProduct(product)"
          >
            <div class="card-image">
              <img
                :src="`${base}images/` + product.images[0]"
                :alt="product.description"
                loading="lazy"
              />
            </div>
            <div class="card-info">
              <span class="card-code">#{{ product.code }}</span>
              <p class="card-name">{{ product.description }}</p>
              <p class="card-price" v-if="product.unit_price && getDiscount(product.code) > 0">
                <span class="card-price-old">{{ formatPrice(product.unit_price) }}</span>
                {{ formatPrice(product.unit_price * (1 - getDiscount(product.code) / 100)) }}
                <span class="price-label">/ unidad</span>
              </p>
              <p class="card-price" v-else-if="product.unit_price">
                {{ formatPrice(product.unit_price) }}
                <span class="price-label">/ unidad</span>
              </p>
              <p class="card-price no-price" v-else>Consultar precio</p>
            </div>
            <!-- Mini cart indicator on card -->
            <div class="card-cart-badge" v-if="getCartItem(product.code)">
              {{ getCartItem(product.code).units + getCartItem(product.code).bulks }}
            </div>
            <div class="card-discount-badge" v-if="getDiscount(product.code) > 0">
              -{{ getDiscount(product.code) }}%
            </div>
          </div>
        </div>
      </template>

      <!-- Bottom spacer for floating cart button -->
      <div style="height: 80px"></div>
    </main>

    <!-- Floating cart button (mobile) -->
    <button v-if="cartItemCount > 0 && !showCart && !selectedProduct" class="floating-cart" @click="openCart">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
      <span>{{ cartItemCount }} items - {{ formatPrice(cartTotal) }}</span>
    </button>

    <!-- Product detail modal -->
    <Teleport to="body">
      <div v-if="selectedProduct" class="modal-overlay" @click.self="closeProduct">
        <div class="modal">
          <button class="modal-close" @click="closeProduct">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>

          <div class="modal-info">
            <div class="modal-header-row">
              <img
                :src="`${base}images/` + selectedProduct.images[0]"
                :alt="selectedProduct.description"
                class="modal-thumb"
                @click="expandedModalImg = !expandedModalImg"
              />
              <div class="modal-header-text">
                <span class="modal-code">Código #{{ selectedProduct.code }}</span>
                <h2 class="modal-name">{{ selectedProduct.description }}</h2>
                <p class="modal-supplier" v-if="selectedProduct.supplier">
                  {{ selectedProduct.supplier }}
                </p>
              </div>
            </div>

            <!-- Expanded image carousel -->
            <div class="modal-image-container" v-if="expandedModalImg">
              <img
                v-for="(img, idx) in selectedProduct.images"
                :key="idx"
                :src="`${base}images/` + img"
                :alt="selectedProduct.description"
                class="modal-image"
                @click="expandedModalImg = false"
              />
            </div>

            <div class="price-table" v-if="selectedProduct.unit_price || selectedProduct.bulk_price">
              <div class="price-row" v-if="selectedProduct.unit_price">
                <span class="price-label-big">Precio por unidad</span>
                <div class="price-values">
                  <span class="price-value-big" :class="{ 'price-old': getDiscount(selectedProduct.code) > 0 }">{{ formatPrice(selectedProduct.unit_price) }}</span>
                  <span class="price-value-big price-new" v-if="getDiscount(selectedProduct.code) > 0">{{ formatPrice(selectedProduct.unit_price * (1 - getDiscount(selectedProduct.code) / 100)) }}</span>
                </div>
              </div>
              <div class="price-row" v-if="selectedProduct.bulk_price">
                <span class="price-label-big">Precio por bulto</span>
                <div class="price-values">
                  <span class="price-value-big bulk" :class="{ 'price-old': getDiscount(selectedProduct.code) > 0 }">{{ formatPrice(selectedProduct.bulk_price) }}</span>
                  <span class="price-value-big price-new" v-if="getDiscount(selectedProduct.code) > 0">{{ formatPrice(selectedProduct.bulk_price * (1 - getDiscount(selectedProduct.code) / 100)) }}</span>
                </div>
              </div>
              <div class="price-row units" v-if="selectedProduct.units_per_bulk">
                <span class="price-label-big">Unidades por bulto</span>
                <span class="price-value-big">{{ selectedProduct.units_per_bulk }}</span>
              </div>
            </div>
            <div class="price-table no-price-box" v-else>
              <div class="price-row">
                <span class="price-label-big">Consultar precio</span>
              </div>
            </div>

            <p class="iva-note" v-if="selectedProduct.unit_price">* Precios con IVA incluido</p>

            <!-- Add to cart controls -->
            <div class="add-to-cart">
              <!-- Discount section (editor mode) -->
              <div class="cart-row" v-if="isEditor && !showDiscountPanel && getDiscount(selectedProduct.code) <= 0">
                <span class="cart-row-label">Descuento</span>
                <button class="discount-toggle-btn" @click="showDiscountPanel = true">Agregar</button>
              </div>
              <div class="discount-panel" v-if="isEditor && (showDiscountPanel || getDiscount(selectedProduct.code) > 0)">
                <div class="discount-panel-header">
                  <span class="cart-row-label">Descuento</span>
                  <button class="discount-clear-btn" v-if="discounts[selectedProduct.code] > 0"
                    @click="setDiscount(selectedProduct.code, 0)">Quitar</button>
                </div>
                <p class="discount-brand-note" v-if="!discounts[selectedProduct.code] && brandDiscounts[selectedProduct.supplier]">
                  Aplicado por marca ({{ brandDiscounts[selectedProduct.supplier] }}%)
                </p>
                <div class="discount-quick-btns">
                  <button v-for="pct in [5, 10, 15, 20, 25]" :key="pct"
                    class="discount-chip" :class="{ active: getDiscount(selectedProduct.code) === pct }"
                    @click="setDiscount(selectedProduct.code, getDiscount(selectedProduct.code) === pct ? 0 : pct)">
                    {{ pct }}%
                  </button>
                </div>
                <input type="number" class="discount-input" placeholder="Otro %" min="0" max="100"
                  :value="[5, 10, 15, 20, 25].includes(getDiscount(selectedProduct.code)) ? '' : (getDiscount(selectedProduct.code) || '')"
                  @input="handleDiscountInput(selectedProduct.code, $event)" />
              </div>
              <!-- Discount display (view mode) -->
              <div class="cart-row" v-if="!isEditor && getDiscount(selectedProduct.code) > 0">
                <span class="cart-row-label">Descuento</span>
                <span class="discount-badge">-{{ getDiscount(selectedProduct.code) }}%</span>
              </div>

              <!-- Unit row -->
              <div class="cart-row" v-if="selectedProduct.unit_price">
                <span class="cart-row-label">Unidades</span>
                <div class="qty-controls">
                  <button
                    class="qty-btn minus"
                    @click="removeUnit(selectedProduct)"
                    :disabled="!getCartItem(selectedProduct.code) || getCartItem(selectedProduct.code).units <= 0"
                  >-</button>
                  <span class="qty-value">{{ getCartItem(selectedProduct.code)?.units || 0 }}</span>
                  <button class="qty-btn plus" @click="addUnit(selectedProduct)">+</button>
                </div>
              </div>

              <!-- Bulk row -->
              <div class="cart-row" v-if="selectedProduct.bulk_price">
                <div class="cart-row-label">
                  Bultos
                  <span class="cart-row-hint" v-if="selectedProduct.units_per_bulk">
                    ({{ selectedProduct.units_per_bulk }} unid.)
                  </span>
                </div>
                <div class="qty-controls">
                  <button
                    class="qty-btn minus"
                    @click="removeBulk(selectedProduct)"
                    :disabled="!getCartItem(selectedProduct.code) || getCartItem(selectedProduct.code).bulks <= 0"
                  >-</button>
                  <span class="qty-value">{{ getCartItem(selectedProduct.code)?.bulks || 0 }}</span>
                  <button class="qty-btn plus" @click="addBulk(selectedProduct)">+</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Cart modal -->
    <Teleport to="body">
      <div v-if="showCart" class="modal-overlay" @click.self="closeCart">
        <div class="modal cart-modal">
          <div class="cart-header">
            <h2 class="cart-title">Tu pedido</h2>
            <div class="cart-header-actions">
              <button class="cart-trash-btn" @click="clearCart" v-if="cartItems.length > 0" title="Vaciar pedido">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                </svg>
              </button>
              <button class="modal-close" @click="closeCart" style="position:static;box-shadow:none;background:transparent;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>

          <div v-if="cartItems.length === 0" class="cart-empty">
            <p>Tu pedido está vacío</p>
            <p class="cart-empty-hint">Tocá un producto y agregá unidades o bultos</p>
          </div>

          <div v-else class="cart-body">
            <div class="cart-item" v-for="item in cartItems" :key="item.product.code">
              <img :src="`${base}images/` + item.product.images[0]" class="cart-item-img" @click="openProductFromCart(item.product)" />
              <div class="cart-item-info">
                <span class="cart-item-code">#{{ item.product.code }}</span>
                <p class="cart-item-name">{{ item.product.description }}</p>

                <!-- Unit line -->
                <div class="cart-item-line" v-if="item.units > 0">
                  <div class="qty-controls small">
                    <button class="qty-btn minus" @click="removeUnit(item.product)">-</button>
                    <span class="qty-value">{{ item.units }}</span>
                    <button class="qty-btn plus" @click="addUnit(item.product)">+</button>
                  </div>
                  <span class="cart-item-type">unid.</span>
                  <span class="cart-item-subtotal" :class="{ 'has-discount': getDiscount(item.product.code) > 0 }">{{ formatPrice(item.product.unit_price * item.units) }}</span>
                  <span class="cart-item-discounted-price" v-if="getDiscount(item.product.code) > 0">{{ formatPrice(item.product.unit_price * item.units * (1 - getDiscount(item.product.code) / 100)) }}</span>
                </div>

                <!-- Bulk line -->
                <div class="cart-item-line" v-if="item.bulks > 0">
                  <div class="qty-controls small">
                    <button class="qty-btn minus" @click="removeBulk(item.product)">-</button>
                    <span class="qty-value">{{ item.bulks }}</span>
                    <button class="qty-btn plus" @click="addBulk(item.product)">+</button>
                  </div>
                  <span class="cart-item-type">bulto{{ item.bulks > 1 ? 's' : '' }}</span>
                  <span class="cart-item-subtotal" :class="{ 'has-discount': getDiscount(item.product.code) > 0 }">{{ formatPrice(item.product.bulk_price * item.bulks) }}</span>
                  <span class="cart-item-discounted-price" v-if="getDiscount(item.product.code) > 0">{{ formatPrice(item.product.bulk_price * item.bulks * (1 - getDiscount(item.product.code) / 100)) }}</span>
                </div>

                <!-- Combined total when both unit and bulk -->
                <div class="cart-item-line cart-item-combined" v-if="item.units > 0 && item.bulks > 0">
                  <span class="cart-item-type">total</span>
                  <span class="cart-item-subtotal" :class="{ 'has-discount': getDiscount(item.product.code) > 0 }">{{ formatPrice(item.product.unit_price * item.units + item.product.bulk_price * item.bulks) }}</span>
                  <span class="cart-item-discounted-price" v-if="getDiscount(item.product.code) > 0">{{ formatPrice((item.product.unit_price * item.units + item.product.bulk_price * item.bulks) * (1 - getDiscount(item.product.code) / 100)) }}</span>
                </div>

                <!-- Discount badge -->
                <div class="cart-item-discount" v-if="getDiscount(item.product.code) > 0">
                  <span class="discount-badge">-{{ getDiscount(item.product.code) }}%</span>
                </div>

                <!-- Bulk equivalent -->
                <div class="cart-item-bulk-info" v-if="item.product.units_per_bulk && item.units > 0">
                  {{ item.bulks > 0 ? `${item.bulks} bulto${item.bulks > 1 ? 's' : ''} + ${item.units} unid.` : `${item.units} unid.` }} = {{ formatBulkEquiv(item) }} bultos
                </div>
              </div>
              <button class="cart-item-remove" @click="removeFromCart(item.product.code)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14"/>
                </svg>
              </button>
            </div>

          </div>

          <div class="cart-footer" v-if="cartItems.length > 0">
            <table class="cart-total-table">
              <tr v-if="cartSavings > 0">
                <td class="cart-total-label">Original</td>
                <td class="cart-total-num cart-subtotal-value">{{ formatPrice(cartOriginal) }}</td>
              </tr>
              <tr v-if="cartSavings > 0">
                <td class="cart-total-label">Descuento</td>
                <td class="cart-total-num cart-discount-value">-{{ formatPrice(cartSavings) }}</td>
              </tr>
              <tr class="cart-total-main">
                <td class="cart-total-label">Total</td>
                <td class="cart-total-num cart-total-value">{{ formatPrice(cartTotal) }}</td>
              </tr>
            </table>

            <button class="whatsapp-btn" @click="sendToWhatsApp">
              <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Enviar pedido por WhatsApp
            </button>

            <button class="clear-cart-btn" @click="clearCart">Vaciar pedido</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style>
/* ── Reset & Base ── */
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #f0f2f5;
  color: #1a1a2e;
  -webkit-font-smoothing: antialiased;
}

/* ── App Layout ── */
.app {
  min-height: 100vh;
  max-width: 1400px;
  margin: 0 auto;
}

/* ── Header ── */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #ffffff;
  padding: 12px 16px;
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.08);
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  font-size: 22px;
  font-weight: 700;
  color: #2563eb;
}

.product-count {
  font-size: 13px;
  color: #6b7280;
  font-weight: 500;
}

/* ── Cart button in header ── */
.cart-btn {
  position: relative;
  background: none;
  border: none;
  color: #374151;
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
}

.cart-badge {
  position: absolute;
  top: -2px;
  right: -6px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

/* ── Search ── */
.search-bar {
  position: relative;
  margin-bottom: 10px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 18px;
  height: 18px;
  color: #9ca3af;
}

.search-input {
  width: 100%;
  padding: 10px 40px 10px 38px;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  font-size: 15px;
  font-family: inherit;
  background: #f9fafb;
  transition: border-color 0.2s, box-shadow 0.2s;
  outline: none;
}

.search-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  background: #fff;
}

.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

/* ── Category chips ── */
.category-bar {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.category-bar::-webkit-scrollbar {
  display: none;
}

.cat-chip {
  flex-shrink: 0;
  padding: 6px 14px;
  border: 1.5px solid #e5e7eb;
  border-radius: 20px;
  background: #fff;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.cat-chip:hover {
  border-color: #2563eb;
  color: #2563eb;
}

.cat-chip.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

/* ── Loading ── */
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 60vh;
  color: #6b7280;
  gap: 12px;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ── Main content ── */
.main {
  padding: 16px;
}

.empty {
  text-align: center;
  padding: 60px 20px;
  color: #6b7280;
}

.clear-filters-btn {
  margin-top: 12px;
  padding: 8px 20px;
  border: 1.5px solid #2563eb;
  border-radius: 8px;
  background: transparent;
  color: #2563eb;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}

.supplier-title {
  font-size: 16px;
  font-weight: 600;
  color: #374151;
  margin: 20px 0 12px;
  padding-bottom: 6px;
  border-bottom: 2px solid #e5e7eb;
}

.supplier-title:first-child {
  margin-top: 0;
}

/* ── Product Grid ── */
.product-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

@media (min-width: 600px) {
  .product-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }
}

@media (min-width: 900px) {
  .product-grid {
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
}

@media (min-width: 1200px) {
  .product-grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

/* ── Product Card ── */
.product-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  position: relative;
}

.product-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.product-card:active {
  transform: scale(0.98);
}

.card-image {
  width: 100%;
  aspect-ratio: 1;
  background: #f9fafb;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

.card-image img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.card-info {
  padding: 8px 10px 10px;
}

.card-code {
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
}

.card-name {
  font-size: 11px;
  color: #4b5563;
  margin-top: 2px;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-price {
  font-size: 14px;
  font-weight: 700;
  color: #059669;
  margin-top: 4px;
}

.price-label {
  font-size: 10px;
  font-weight: 400;
  color: #6b7280;
}

.card-price.no-price {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 500;
  font-style: italic;
}

.card-cart-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: #2563eb;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  min-width: 22px;
  height: 22px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}

.no-price-box {
  border-color: #fbbf24;
  background: #fffbeb;
}

.no-price-box .price-label-big {
  color: #b45309;
  font-weight: 600;
}

/* ── Floating cart button ── */
.floating-cart {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  background: #25d366;
  color: #fff;
  border: none;
  border-radius: 28px;
  padding: 14px 24px;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 4px 20px rgba(37, 211, 102, 0.4);
  animation: floatIn 0.3s ease;
}

.floating-cart:active {
  transform: translateX(-50%) scale(0.96);
}

@keyframes floatIn {
  from { transform: translateX(-50%) translateY(60px); opacity: 0; }
  to { transform: translateX(-50%) translateY(0); opacity: 1; }
}

/* ── Modal ── */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

@media (min-width: 600px) {
  .modal-overlay {
    align-items: center;
    padding: 20px;
  }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  background: #fff;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  border-radius: 20px 20px 0 0;
  overflow-y: auto;
  animation: slideUp 0.25s ease;
  position: relative;
}

@media (min-width: 600px) {
  .modal {
    border-radius: 16px;
    max-height: 85vh;
  }
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@media (min-width: 600px) {
  @keyframes slideUp {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.9);
  border: none;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #374151;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

.modal-header-row {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.modal-thumb {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 10px;
  background: #f9fafb;
  flex-shrink: 0;
  padding: 4px;
  cursor: pointer;
}

.modal-header-text {
  min-width: 0;
  flex: 1;
}

.modal-image-container {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  background: #f9fafb;
  border-radius: 10px;
  margin-bottom: 12px;
  cursor: pointer;
}

.modal-image {
  min-width: 100%;
  max-height: 260px;
  object-fit: contain;
  scroll-snap-align: start;
  padding: 12px;
}

.modal-info {
  padding: 16px 20px 24px;
}

.modal-code {
  font-size: 13px;
  font-weight: 600;
  color: #2563eb;
}

.modal-name {
  font-size: 18px;
  font-weight: 700;
  color: #1a1a2e;
  margin-top: 4px;
  line-height: 1.3;
}

.modal-supplier {
  font-size: 13px;
  color: #6b7280;
  margin-top: 4px;
}

.price-table {
  margin-top: 16px;
  border: 1.5px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}

.price-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}

.price-row + .price-row {
  border-top: 1px solid #f3f4f6;
}

.price-row.units {
  background: #f9fafb;
}

.price-label-big {
  font-size: 14px;
  color: #4b5563;
}

.price-value-big {
  font-size: 18px;
  font-weight: 700;
  color: #059669;
}

.price-value-big.bulk {
  color: #2563eb;
}

.iva-note {
  font-size: 11px;
  color: #9ca3af;
  margin-top: 8px;
  text-align: right;
}

/* ── Add to cart controls (product modal) ── */
.add-to-cart {
  margin-top: 16px;
  border: 1.5px solid #e5e7eb;
  border-radius: 12px;
  overflow: hidden;
}

.cart-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}

.cart-row + .cart-row {
  border-top: 1px solid #f3f4f6;
}

.cart-row-label {
  font-size: 14px;
  font-weight: 500;
  color: #374151;
}

.cart-row-hint {
  font-size: 12px;
  font-weight: 400;
  color: #9ca3af;
}

/* ── Quantity controls ── */
.qty-controls {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
}

.qty-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: #f9fafb;
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  transition: background 0.1s;
}

.qty-btn:active {
  background: #e5e7eb;
}

.qty-btn:disabled {
  color: #d1d5db;
  cursor: default;
}

.qty-btn.plus {
  color: #2563eb;
}

.qty-value {
  min-width: 36px;
  text-align: center;
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
}

.qty-controls.small {
  border-radius: 8px;
}

.qty-controls.small .qty-btn {
  width: 28px;
  height: 28px;
  font-size: 15px;
}

.qty-controls.small .qty-value {
  min-width: 28px;
  font-size: 14px;
}

/* ── Cart modal ── */
.cart-modal {
  display: flex;
  flex-direction: column;
}

.cart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
}

.cart-title {
  font-size: 20px;
  font-weight: 700;
  color: #1a1a2e;
}

.cart-empty {
  padding: 48px 20px;
  text-align: center;
  color: #6b7280;
}

.cart-empty-hint {
  font-size: 13px;
  margin-top: 6px;
  color: #9ca3af;
}

.cart-body {
  padding: 12px 16px 12px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.cart-footer {
  position: sticky;
  bottom: 0;
  background: #fff;
  padding: 12px 16px 24px;
  border-top: 2px solid #1a1a2e;
  flex-shrink: 0;
}

/* ── Cart items ── */
.cart-item {
  display: flex;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f3f4f6;
  align-items: flex-start;
}

.cart-item:last-of-type {
  border-bottom: none;
}

.cart-item-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 8px;
  background: #f9fafb;
  flex-shrink: 0;
  padding: 4px;
  cursor: pointer;
}

.cart-item-info {
  flex: 1;
  min-width: 0;
}

.cart-item-code {
  font-size: 11px;
  font-weight: 600;
  color: #2563eb;
}

.cart-item-name {
  font-size: 12px;
  color: #4b5563;
  line-height: 1.3;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cart-item-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.cart-item-type {
  font-size: 12px;
  color: #6b7280;
}

.cart-item-subtotal {
  font-size: 13px;
  font-weight: 700;
  color: #059669;
  margin-left: auto;
}

.cart-item-remove {
  background: none;
  border: none;
  color: #d1d5db;
  cursor: pointer;
  padding: 4px;
  flex-shrink: 0;
  transition: color 0.15s;
}

.cart-item-remove:hover {
  color: #ef4444;
}

/* ── Cart total table ── */
.cart-total-table {
  width: 100%;
  border-collapse: collapse;
}

.cart-total-table td {
  border: none;
  padding: 2px 0;
}

.cart-total-label {
  font-size: 13px;
  color: #6b7280;
  text-align: left;
}

.cart-total-num {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', 'Liberation Mono', monospace;
  text-align: right;
  white-space: nowrap;
}

.cart-subtotal-value {
  font-size: 14px;
  font-weight: 600;
  color: #6b7280;
}

.cart-discount-value {
  font-size: 14px;
  font-weight: 600;
  color: #f59e0b;
}

.cart-total-main .cart-total-label {
  font-size: 16px;
  font-weight: 700;
  color: #1a1a2e;
  padding-top: 6px;
}

.cart-total-value {
  font-size: 22px;
  font-weight: 700;
  color: #059669;
  padding-top: 6px;
}

/* ── WhatsApp button ── */
.whatsapp-btn {
  width: 100%;
  margin-top: 16px;
  padding: 14px;
  border: none;
  border-radius: 12px;
  background: #25d366;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: background 0.15s;
}

.whatsapp-btn:hover {
  background: #20bd5a;
}

.whatsapp-btn:active {
  transform: scale(0.98);
}

.clear-cart-btn {
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #9ca3af;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
}

.clear-cart-btn:hover {
  color: #ef4444;
}

.cart-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cart-trash-btn {
  background: none;
  border: none;
  color: #d1d5db;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s;
}

.cart-trash-btn:hover {
  color: #ef4444;
}

.cart-item-bulk-info {
  font-size: 11px;
  color: #6b7280;
  margin-top: 4px;
  font-style: italic;
}

/* ── Discount controls ── */
.discount-toggle-btn {
  padding: 6px 14px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s;
}

.discount-toggle-btn:hover {
  border-color: #f59e0b;
  color: #f59e0b;
}

.discount-panel {
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
}

.discount-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.discount-clear-btn {
  background: none;
  border: none;
  font-size: 12px;
  font-family: inherit;
  color: #ef4444;
  cursor: pointer;
  font-weight: 500;
}

.discount-quick-btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.discount-chip {
  padding: 6px 12px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  color: #374151;
  cursor: pointer;
  transition: all 0.15s;
}

.discount-chip:hover {
  border-color: #f59e0b;
  color: #f59e0b;
}

.discount-chip.active {
  background: #f59e0b;
  border-color: #f59e0b;
  color: #fff;
}

.discount-input {
  width: 100%;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  background: #f9fafb;
  outline: none;
  transition: border-color 0.2s;
}

.discount-input:focus {
  border-color: #f59e0b;
  background: #fff;
}

.cart-item-discount {
  margin-top: 4px;
}

.discount-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: #fef3c7;
  color: #b45309;
  font-size: 11px;
  font-weight: 600;
}

.card-discount-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: #f59e0b;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}


.cart-item-subtotal.has-discount {
  text-decoration: line-through;
  color: #9ca3af;
  font-weight: 500;
}

.cart-item-discounted-price {
  font-size: 13px;
  font-weight: 700;
  color: #059669;
  margin-left: 4px;
}

.cart-item-combined {
  padding-top: 4px;
  border-top: 1px dashed #e5e7eb;
}

.cart-item-combined .cart-item-type {
  font-weight: 600;
  color: #374151;
}

.price-values {
  display: flex;
  align-items: center;
  gap: 8px;
}

.price-old {
  text-decoration: line-through;
  color: #9ca3af !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

.price-new {
  color: #059669 !important;
}

/* ── Editor panel ── */
.editor-panel {
  background: #fffbeb;
  border-bottom: 2px solid #f59e0b;
  padding: 14px 16px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.editor-title {
  font-size: 15px;
  font-weight: 700;
  color: #92400e;
}

.editor-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.share-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: none;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.share-btn:hover {
  background: #1d4ed8;
}

.share-btn:disabled {
  background: #93c5fd;
  cursor: default;
}

.clear-config-btn {
  padding: 7px 14px;
  border: 1.5px solid #fca5a5;
  border-radius: 8px;
  background: #fff;
  color: #ef4444;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
}

.clear-config-btn:hover {
  background: #fef2f2;
}

.editor-brand-section {
  margin-bottom: 8px;
}

.editor-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #78350f;
  margin-bottom: 8px;
}

.editor-brand-form {
  display: flex;
  gap: 6px;
  align-items: center;
}

.editor-select {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  background: #fff;
  color: #374151;
  outline: none;
}

.editor-select:focus {
  border-color: #f59e0b;
}

.editor-pct-input {
  display: flex;
  align-items: center;
  gap: 2px;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  padding: 0 8px 0 0;
  overflow: hidden;
}

.editor-pct {
  width: 48px;
  padding: 8px 6px;
  border: none;
  font-size: 13px;
  font-family: inherit;
  text-align: center;
  outline: none;
  background: transparent;
}

.editor-pct-symbol {
  font-size: 13px;
  color: #6b7280;
  font-weight: 600;
}

.editor-add-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: #f59e0b;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}

.editor-add-btn:hover {
  background: #d97706;
}

.editor-add-btn:disabled {
  background: #fde68a;
  cursor: default;
}

.editor-brand-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.editor-brand-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #fde68a;
}

.editor-brand-name {
  flex: 1;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-brand-pct {
  font-size: 13px;
  font-weight: 700;
  color: #f59e0b;
  flex-shrink: 0;
}

.editor-brand-remove {
  background: none;
  border: none;
  color: #d1d5db;
  font-size: 18px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  transition: color 0.15s;
}

.editor-brand-remove:hover {
  color: #ef4444;
}

.editor-hint {
  font-size: 12px;
  color: #92400e;
  font-style: italic;
}

/* ── Offers section ── */
.offers-title {
  color: #b45309 !important;
  border-bottom-color: #f59e0b !important;
}

.offers-title::before {
  content: '\2605 ';
}

.offer-card {
  border: 2px solid #fde68a;
}

.card-price-old {
  text-decoration: line-through;
  color: #9ca3af;
  font-weight: 400;
  font-size: 11px;
  margin-right: 4px;
}

/* ── Supplier discount badge ── */
.supplier-discount-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f59e0b;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  margin-left: 8px;
  vertical-align: middle;
}

/* ── Brand discount note in product modal ── */
.discount-brand-note {
  font-size: 12px;
  color: #92400e;
  font-style: italic;
  margin-bottom: 8px;
  padding: 4px 8px;
  background: #fef3c7;
  border-radius: 6px;
}
</style>
