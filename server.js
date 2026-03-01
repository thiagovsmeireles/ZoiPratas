const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
let DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT_DIR;

const ensureWritableDir = (dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

if (!ensureWritableDir(DATA_DIR)) {
  const fallbackDataDir = path.join(os.tmpdir(), 'zoi-data');
  ensureWritableDir(fallbackDataDir);
  DATA_DIR = fallbackDataDir;
  console.warn(`DATA_DIR sem permissão. Usando fallback: ${DATA_DIR}`);
}

const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const UPLOAD_ROOT_DIR = path.join(DATA_DIR, 'uploads');
const UPLOAD_DIR = path.join(UPLOAD_ROOT_DIR, 'produtos');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category_id INTEGER,
    price REAL NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'available',
    stock INTEGER DEFAULT 0,
    sold_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(category_id) REFERENCES categories(id)
  );

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image_path TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

const productColumns = db.prepare('PRAGMA table_info(products)').all().map((col) => col.name);
if (!productColumns.includes('is_promo')) {
  db.exec('ALTER TABLE products ADD COLUMN is_promo INTEGER NOT NULL DEFAULT 0');
}
if (!productColumns.includes('promo_price')) {
  db.exec('ALTER TABLE products ADD COLUMN promo_price REAL');
}

const defaultSettings = [
  ['whatsapp_number', '556195584009'],
  ['home_hero_text', 'Elegância em cada detalhe.'],
  ['home_subtitle_text', 'Peças em prata com acabamento premium para seu estilo.'],
  ['home_banner_image', '/img/banner-default.svg'],
  ['whatsapp_message_footer', 'Obrigado por comprar na Zói Pratas!'],
  ['instagram_url', 'https://www.instagram.com/pratas.zoi?igsh=eXl2d3QybXlzcHIx']
];

const upsertSettingStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
for (const [key, value] of defaultSettings) {
  const exists = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (!exists) upsertSettingStmt.run(key, value);
}

const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get('admin');
if (!adminExists) {
  const passwordHash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', passwordHash);
}

if (db.prepare('SELECT COUNT(*) total FROM categories').get().total === 0) {
  const insert = db.prepare('INSERT INTO categories (name) VALUES (?)');
  ['Correntes', 'Anéis', 'Pulseiras', 'Brincos'].forEach((name) => insert.run(name));
}

if (db.prepare('SELECT COUNT(*) total FROM highlights').get().total === 0) {
  const insert = db.prepare('INSERT INTO highlights (title, description, sort_order, is_active) VALUES (?, ?, ?, 1)');
  insert.run('Destaques da Semana', 'Seleção especial com acabamento impecável e estilo atemporal.', 1);
  insert.run('Novidades', 'Lançamentos em prata para compor looks sofisticados todos os dias.', 2);
  insert.run('Promoções', 'Ofertas exclusivas por tempo limitado em peças selecionadas.', 3);
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'zoio-pratas-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use('/uploads', express.static(UPLOAD_ROOT_DIR));
app.use(express.static(path.join(ROOT_DIR, 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Formato inválido'), ok);
  }
});

const requireAdmin = (req, res, next) => {
  if (!req.session || !req.session.adminId) return res.status(401).json({ error: 'Não autenticado.' });
  next();
};

const sanitizeNumber = (value = '') => String(value).replace(/\D/g, '');
const settingsMap = () => db.prepare('SELECT key, value FROM settings').all().reduce((acc, row) => ({ ...acc, [row.key]: row.value }), {});

app.get('/api/public/settings', (_req, res) => res.json(settingsMap()));
app.get('/api/public/categories', (_req, res) => res.json(db.prepare('SELECT id, name FROM categories ORDER BY name').all()));

app.get('/api/public/products', (req, res) => {
  const { category, promo, sort } = req.query;
  const whereParts = [];
  const params = [];

  if (category && category !== 'all') {
    whereParts.push('c.name = ?');
    params.push(category);
  }

  if (promo === 'promo') {
    whereParts.push('p.is_promo = 1 AND p.promo_price IS NOT NULL AND p.promo_price > 0');
  }

  const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  const effectivePriceExpr = "CASE WHEN p.is_promo = 1 AND p.promo_price IS NOT NULL AND p.promo_price > 0 THEN p.promo_price ELSE p.price END";
  let order = 'ORDER BY p.created_at DESC';
  if (sort === 'lowest') order = `ORDER BY ${effectivePriceExpr} ASC`;
  if (sort === 'highest') order = `ORDER BY ${effectivePriceExpr} DESC`;

  const rows = db.prepare(`
    SELECT p.id, p.name, p.price, p.is_promo, p.promo_price, p.description, p.status, p.stock, p.sold_count, p.created_at,
           ${effectivePriceExpr} AS final_price,
           c.name AS category,
           (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY id ASC LIMIT 1) AS image
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${where}
    ${order}
  `).all(...params);

  res.json(rows);
});

app.get('/api/public/bestsellers', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.price, p.is_promo, p.promo_price, p.status, p.sold_count,
      CASE WHEN p.is_promo = 1 AND p.promo_price IS NOT NULL AND p.promo_price > 0 THEN p.promo_price ELSE p.price END AS final_price,
           c.name AS category,
           (SELECT image_path FROM product_images WHERE product_id = p.id ORDER BY id ASC LIMIT 1) AS image
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.sold_count > 0
    ORDER BY p.sold_count DESC, p.created_at DESC
    LIMIT 8
  `).all();
  res.json(rows);
});

app.get('/api/public/highlights', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, title, description, sort_order, is_active
    FROM highlights
    WHERE is_active = 1
    ORDER BY sort_order ASC, id ASC
  `).all();
  res.json(rows);
});

app.post('/api/public/products/:id/cart-hit', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Produto inválido.' });
  db.prepare('UPDATE products SET sold_count = sold_count + 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/public/checkout', (req, res) => {
  const { customer, items } = req.body;
  if (!customer || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Pedido inválido.' });

  const required = ['fullName', 'phone', 'city', 'district', 'deliveryType'];
  for (const key of required) {
    if (!customer[key] || String(customer[key]).trim() === '') return res.status(400).json({ error: `Campo obrigatório: ${key}` });
  }
  if (customer.deliveryType === 'delivery' && (!customer.address || String(customer.address).trim() === '')) return res.status(400).json({ error: 'Endereço obrigatório.' });

  const ids = items.map((i) => Number(i.productId)).filter(Number.isFinite);
  if (!ids.length) return res.status(400).json({ error: 'Itens inválidos.' });

  const placeholders = ids.map(() => '?').join(',');
  const products = db.prepare(`
    SELECT id, name, price, is_promo, promo_price
    FROM products
    WHERE id IN (${placeholders})
  `).all(...ids);
  const byId = new Map(products.map((p) => [p.id, p]));

  let total = 0;
  const lines = [];
  for (const item of items) {
    const id = Number(item.productId);
    const qty = Number(item.quantity) || 0;
    const product = byId.get(id);
    if (!product || qty <= 0) continue;
    const unitPrice = Number(product.is_promo) === 1 && Number(product.promo_price) > 0
      ? Number(product.promo_price)
      : Number(product.price);
    const lineTotal = unitPrice * qty;
    total += lineTotal;
    const promoSuffix = Number(product.is_promo) === 1 && Number(product.promo_price) > 0 ? ' (Promoção)' : '';
    lines.push(`- ${product.name} (${qty}x) - R$ ${lineTotal.toFixed(2).replace('.', ',')}${promoSuffix}`);
  }

  if (!lines.length) return res.status(400).json({ error: 'Nenhum item válido no pedido.' });

  const settings = settingsMap();
  const delivery = customer.deliveryType === 'pickup' ? 'Retirada no local' : 'Entrega';
  const address = customer.deliveryType === 'pickup' ? 'Retirada no local' : `${customer.address} - ${customer.district} - ${customer.city}`;

  const message = [
    '🛍️ Pedido - Zói Pratas',
    '',
    `Cliente: ${customer.fullName}`,
    `Telefone: ${customer.phone}`,
    '',
    'Produtos:',
    ...lines,
    '',
    `Total: R$ ${total.toFixed(2).replace('.', ',')}`,
    '',
    `Forma: ${delivery}`,
    `Endereço: ${address}`,
    '',
    settings.whatsapp_message_footer || ''
  ].join('\n');

  const number = sanitizeNumber(settings.whatsapp_number || '556195584009');
  const whatsappUrl = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;

  res.json({ whatsappUrl, message, total });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(String(password || ''), admin.password_hash)) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });

  req.session.adminId = admin.id;
  req.session.username = admin.username;
  res.json({ success: true, username: admin.username });
});

app.get('/api/admin/me', (req, res) => {
  if (!req.session?.adminId) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/admin/categories', requireAdmin, (_req, res) => res.json(db.prepare('SELECT id, name, created_at FROM categories ORDER BY created_at DESC').all()));

app.post('/api/admin/categories', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome obrigatório.' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.json({ id: info.lastInsertRowid });
  } catch {
    res.status(400).json({ error: 'Categoria já existe.' });
  }
});

app.put('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  if (!Number.isFinite(id) || !name) return res.status(400).json({ error: 'Dados inválidos.' });
  try {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Não foi possível atualizar categoria.' });
  }
});

app.delete('/api/admin/categories/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Categoria inválida.' });
  db.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').run(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ success: true });
});

app.get('/api/admin/products', requireAdmin, (_req, res) => {
  const products = db.prepare(`
    SELECT p.id, p.name, p.price, p.is_promo, p.promo_price, p.description, p.status, p.stock, p.sold_count, p.created_at,
           c.id AS category_id, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
  `).all();

  const imagesStmt = db.prepare('SELECT id, product_id, image_path FROM product_images WHERE product_id = ? ORDER BY id ASC');
  res.json(products.map((p) => ({ ...p, images: imagesStmt.all(p.id) })));
});

app.get('/api/admin/highlights', requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT id, title, description, sort_order, is_active, created_at
    FROM highlights
    ORDER BY sort_order ASC, id ASC
  `).all();
  res.json(rows);
});

app.post('/api/admin/highlights', requireAdmin, (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const sortOrder = Number(req.body.sort_order || 0);
  const isActive = req.body.is_active === '0' || req.body.is_active === 0 ? 0 : 1;

  if (!title || !description) return res.status(400).json({ error: 'Título e descrição são obrigatórios.' });

  const info = db.prepare('INSERT INTO highlights (title, description, sort_order, is_active) VALUES (?, ?, ?, ?)').run(
    title,
    description,
    Number.isFinite(sortOrder) ? sortOrder : 0,
    isActive
  );

  res.json({ id: info.lastInsertRowid });
});

app.put('/api/admin/highlights/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const sortOrder = Number(req.body.sort_order || 0);
  const isActive = req.body.is_active === '0' || req.body.is_active === 0 ? 0 : 1;

  if (!Number.isFinite(id) || !title || !description) return res.status(400).json({ error: 'Dados inválidos.' });

  db.prepare('UPDATE highlights SET title = ?, description = ?, sort_order = ?, is_active = ? WHERE id = ?').run(
    title,
    description,
    Number.isFinite(sortOrder) ? sortOrder : 0,
    isActive,
    id
  );

  res.json({ success: true });
});

app.delete('/api/admin/highlights/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Destaque inválido.' });
  db.prepare('DELETE FROM highlights WHERE id = ?').run(id);
  res.json({ success: true });
});

app.post('/api/admin/products', requireAdmin, upload.array('images', 6), (req, res) => {
  const { name, categoryId, price, description, status, stock, isPromo, promoPrice } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nome e preço obrigatórios.' });

  const parsedPrice = Number(price);
  const promoFlag = String(isPromo || '0') === '1' ? 1 : 0;
  const parsedPromoPrice = promoFlag ? Number(promoPrice) : null;

  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return res.status(400).json({ error: 'Preço inválido.' });
  if (promoFlag && (!Number.isFinite(parsedPromoPrice) || parsedPromoPrice <= 0 || parsedPromoPrice >= parsedPrice)) {
    return res.status(400).json({ error: 'Preço promocional deve ser menor que o preço original.' });
  }

  const info = db.prepare('INSERT INTO products (name, category_id, price, is_promo, promo_price, description, status, stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    String(name).trim(),
    categoryId ? Number(categoryId) : null,
    parsedPrice,
    promoFlag,
    promoFlag ? parsedPromoPrice : null,
    String(description || '').trim(),
    status === 'unavailable' ? 'unavailable' : 'available',
    Number(stock || 0)
  );

  const productId = Number(info.lastInsertRowid);
  const insertImage = db.prepare('INSERT INTO product_images (product_id, image_path) VALUES (?, ?)');
  for (const file of req.files || []) insertImage.run(productId, `/uploads/produtos/${file.filename}`);
  res.json({ id: productId });
});

app.put('/api/admin/products/:id', requireAdmin, upload.array('images', 6), (req, res) => {
  const id = Number(req.params.id);
  const { name, categoryId, price, description, status, stock, isPromo, promoPrice } = req.body;
  if (!Number.isFinite(id) || !name || !price) return res.status(400).json({ error: 'Dados inválidos.' });

  const parsedPrice = Number(price);
  const promoFlag = String(isPromo || '0') === '1' ? 1 : 0;
  const parsedPromoPrice = promoFlag ? Number(promoPrice) : null;

  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) return res.status(400).json({ error: 'Preço inválido.' });
  if (promoFlag && (!Number.isFinite(parsedPromoPrice) || parsedPromoPrice <= 0 || parsedPromoPrice >= parsedPrice)) {
    return res.status(400).json({ error: 'Preço promocional deve ser menor que o preço original.' });
  }

  db.prepare('UPDATE products SET name = ?, category_id = ?, price = ?, is_promo = ?, promo_price = ?, description = ?, status = ?, stock = ? WHERE id = ?').run(
    String(name).trim(),
    categoryId ? Number(categoryId) : null,
    parsedPrice,
    promoFlag,
    promoFlag ? parsedPromoPrice : null,
    String(description || '').trim(),
    status === 'unavailable' ? 'unavailable' : 'available',
    Number(stock || 0),
    id
  );

  const insertImage = db.prepare('INSERT INTO product_images (product_id, image_path) VALUES (?, ?)');
  for (const file of req.files || []) insertImage.run(id, `/uploads/produtos/${file.filename}`);

  res.json({ success: true });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Produto inválido.' });

  const images = db.prepare('SELECT image_path FROM product_images WHERE product_id = ?').all(id);
  db.prepare('DELETE FROM product_images WHERE product_id = ?').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);

  for (const row of images) {
    const filePath = path.join(ROOT_DIR, row.image_path.replace(/^\//, ''));
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  res.json({ success: true });
});

app.delete('/api/admin/products/:productId/images/:imageId', requireAdmin, (req, res) => {
  const productId = Number(req.params.productId);
  const imageId = Number(req.params.imageId);
  if (!Number.isFinite(productId) || !Number.isFinite(imageId)) return res.status(400).json({ error: 'Dados inválidos.' });

  const image = db.prepare('SELECT id, image_path FROM product_images WHERE id = ? AND product_id = ?').get(imageId, productId);
  if (!image) return res.status(404).json({ error: 'Imagem não encontrada.' });

  db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);
  const filePath = path.join(ROOT_DIR, image.image_path.replace(/^\//, ''));
  if (fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }

  res.json({ success: true });
});

app.get('/api/admin/settings', requireAdmin, (_req, res) => res.json(settingsMap()));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const allowed = ['whatsapp_number', 'home_hero_text', 'home_subtitle_text', 'home_banner_image', 'whatsapp_message_footer', 'instagram_url'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      const value = key === 'whatsapp_number' ? sanitizeNumber(req.body[key]) : String(req.body[key] ?? '').trim();
      upsertSettingStmt.run(key, value);
    }
  }
  res.json({ success: true });
});

app.post('/api/admin/settings/banner', requireAdmin, upload.single('banner'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Imagem inválida.' });
  const imagePath = `/uploads/produtos/${req.file.filename}`;
  upsertSettingStmt.run('home_banner_image', imagePath);
  res.json({ success: true, imagePath });
});

app.put('/api/admin/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || String(newPassword).length < 6) return res.status(400).json({ error: 'Nova senha deve ter no mínimo 6 caracteres.' });

  const admin = db.prepare('SELECT id, password_hash FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin || !bcrypt.compareSync(String(currentPassword), admin.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta.' });

  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), admin.id);
  res.json({ success: true });
});

app.get('/api/admin/report', requireAdmin, (_req, res) => {
  const totalProducts = db.prepare('SELECT COUNT(*) total FROM products').get().total;
  const availableProducts = db.prepare("SELECT COUNT(*) total FROM products WHERE status = 'available'").get().total;
  const unavailableProducts = db.prepare("SELECT COUNT(*) total FROM products WHERE status = 'unavailable'").get().total;
  const averagePrice = db.prepare('SELECT COALESCE(AVG(price), 0) avg FROM products').get().avg;
  res.json({ totalProducts, availableProducts, unavailableProducts, averagePrice });
});

app.get('/api/admin/export/products', requireAdmin, (_req, res) => {
  const products = db.prepare(`
    SELECT p.id, p.name, p.price, p.is_promo, p.promo_price, p.description, p.status, p.stock, p.sold_count, p.created_at, c.name AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.created_at DESC
  `).all();

  const imagesStmt = db.prepare('SELECT image_path FROM product_images WHERE product_id = ? ORDER BY id ASC');
  const data = products.map((p) => ({ ...p, images: imagesStmt.all(p.id).map((i) => i.image_path) }));

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="produtos-backup-${Date.now()}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'admin', 'index.html')));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Zói Pratas rodando em http://localhost:${PORT}`);
});
