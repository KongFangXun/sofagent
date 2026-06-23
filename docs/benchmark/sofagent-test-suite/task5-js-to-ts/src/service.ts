// service.ts — 业务服务层

import * as repo from './repository';
import { User, Order, OrderItem } from './model';

// Result 联合类型：成功或失败
export type Result<T> =
  | { ok: true; data: T; error?: never }
  | { ok: false; error: string; data?: never };

export function registerUser(name: string, email: string): Result<User> {
  if (!name || name.length < 2) {
    return { ok: false, error: 'Name too short' };
  }
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Invalid email' };
  }
  const user = repo.saveUser(name, email);
  return { ok: true, data: user };
}

export function placeOrder(
  userId: number,
  items: OrderItem[],
  discount?: number
): Result<Order> {
  const user = repo.findUserById(userId);
  if (!user) {
    return { ok: false, error: 'User not found' };
  }
  if (!items || items.length === 0) {
    return { ok: false, error: 'No items' };
  }
  const order = repo.saveOrder(userId, items, discount);
  return { ok: true, data: order };
}

export interface UserOrders {
  user: User;
  orders: Order[];
}

export function getUserOrders(userId: number): Result<UserOrders> {
  const user = repo.findUserById(userId);
  if (!user) {
    return { ok: false, error: 'User not found' };
  }
  const orders = repo.findOrdersByUser(userId);
  return { ok: true, data: { user, orders } };
}

export function applyDiscount(
  orderId: number,
  discount: number
): Result<Order> {
  const order = repo.findOrderById(orderId);
  if (!order) {
    return { ok: false, error: 'Order not found' };
  }
  const newTotal = order.subtotal - discount;
  if (newTotal < 0) {
    return { ok: false, error: 'Discount exceeds subtotal' };
  }
  return {
    ok: true,
    data: { ...order, discount, total: newTotal },
  };
}
