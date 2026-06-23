// model.ts — 数据模型层

export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

export interface OrderItem {
  name: string;
  price: number;
  qty: number;
}

export interface Order {
  id: number;
  userId: number;
  items: OrderItem[];
  discount: number;
  subtotal: number;
  total: number;
  createdAt: Date;
}

export function createUser(id: number, name: string, email: string): User {
  return { id, name, email, createdAt: new Date() };
}

export function createOrder(
  id: number,
  userId: number,
  items: OrderItem[],
  discount?: number
): Order {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  return {
    id,
    userId,
    items,
    discount: discount || 0,
    subtotal,
    total: subtotal - (discount || 0),
    createdAt: new Date(),
  };
}
