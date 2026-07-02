export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  status: 'on' | 'off';
  cover: string;
  createdAt: string;
}

const STORAGE_KEY = 'system-c-products';

const seed: Product[] = [
  { id: 'P001', name: '讯飞智能录音笔 SR502', category: '智能硬件', price: 1999, stock: 156, status: 'on', cover: '🎙️', createdAt: '2024-01-10' },
  { id: 'P002', name: '讯飞翻译机 4.0', category: '智能硬件', price: 2999, stock: 89, status: 'on', cover: '🌐', createdAt: '2024-02-15' },
  { id: 'P003', name: '智能办公本 X2', category: '办公设备', price: 4999, stock: 45, status: 'on', cover: '📖', createdAt: '2024-03-08' },
  { id: 'P004', name: '讯飞输入法 Pro 年卡', category: '软件服务', price: 168, stock: 999, status: 'on', cover: '⌨️', createdAt: '2024-03-20' },
  { id: 'P005', name: '同声传译耳机', category: '智能硬件', price: 899, stock: 0, status: 'off', cover: '🎧', createdAt: '2024-04-12' },
  { id: 'P006', name: '儿童故事机', category: '智能硬件', price: 399, stock: 234, status: 'on', cover: '🐻', createdAt: '2024-05-05' },
];

export function loadProducts(): Product[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    saveProducts(seed);
    return seed;
  } catch {
    return seed;
  }
}

export function saveProducts(products: Product[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

export function addProduct(product: Omit<Product, 'id' | 'createdAt'>): Product {
  const products = loadProducts();
  const newP: Product = {
    ...product,
    id: `P${String(products.length + 1).padStart(3, '0')}`,
    createdAt: new Date().toISOString().slice(0, 10),
  };
  products.push(newP);
  saveProducts(products);
  return newP;
}

export function toggleProductStatus(id: string): boolean {
  const products = loadProducts();
  const idx = products.findIndex(p => p.id === id);
  if (idx < 0) return false;
  products[idx].status = products[idx].status === 'on' ? 'off' : 'on';
  saveProducts(products);
  return true;
}

export function deleteProduct(id: string): boolean {
  const products = loadProducts();
  const filtered = products.filter(p => p.id !== id);
  if (filtered.length === products.length) return false;
  saveProducts(filtered);
  return true;
}