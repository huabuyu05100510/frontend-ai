export interface Order {
  id: string;
  customer: string;
  amount: number;
  status: 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled';
  createdAt: string;
  items: { name: string; qty: number; price: number }[];
}

const STORAGE_KEY = 'system-b-orders';

const seed: Order[] = [
  { id: 'O20240618001', customer: '张三', amount: 299.00, status: 'pending', createdAt: '2024-06-18 09:23',
    items: [{ name: '智能翻译耳机', qty: 1, price: 299 }] },
  { id: 'O20240618002', customer: '李四', amount: 1580.00, status: 'paid', createdAt: '2024-06-18 10:15',
    items: [{ name: '录音笔 Pro', qty: 1, price: 1580 }] },
  { id: 'O20240618003', customer: '王五', amount: 89.00, status: 'shipped', createdAt: '2024-06-17 16:42',
    items: [{ name: '翻译会员月卡', qty: 1, price: 89 }] },
  { id: 'O20240617004', customer: '赵六', amount: 4998.00, status: 'completed', createdAt: '2024-06-17 11:08',
    items: [{ name: '智能录音设备', qty: 2, price: 2499 }] },
  { id: 'O20240616005', customer: '钱七', amount: 199.00, status: 'pending', createdAt: '2024-06-16 14:30',
    items: [{ name: '语音转写套餐', qty: 1, price: 199 }] },
  { id: 'O20240616006', customer: '孙八', amount: 699.00, status: 'cancelled', createdAt: '2024-06-16 09:18',
    items: [{ name: '同声传译设备', qty: 1, price: 699 }] },
];

export function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    saveOrders(seed);
    return seed;
  } catch {
    return seed;
  }
}

export function saveOrders(orders: Order[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}

export function updateOrderStatus(id: string, status: Order['status']): boolean {
  const orders = loadOrders();
  const idx = orders.findIndex(o => o.id === id);
  if (idx < 0) return false;
  orders[idx].status = status;
  saveOrders(orders);
  return true;
}

export const STATUS_LABELS: Record<Order['status'], string> = {
  pending: '待付款',
  paid: '已付款',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
};

export const STATUS_BADGE: Record<Order['status'], string> = {
  pending: 'app-badge-warning',
  paid: 'app-badge-info',
  shipped: 'app-badge-info',
  completed: 'app-badge-success',
  cancelled: 'app-badge-error',
};