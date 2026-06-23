// repository.ts — 数据访问层

import { createUser, createOrder, User, Order, OrderItem } from './model';

const userStore = new Map<number, User>();
const orderStore = new Map<number, Order>();

export function saveUser(name: string, email: string): User {
  const id = userStore.size + 1;
  const user = createUser(id, name, email);
  userStore.set(id, user);
  return user;
}

export function findUserById(id: number): User | null {
  return userStore.get(id) || null;
}

export function findAllUsers(): User[] {
  return Array.from(userStore.values());
}

export function saveOrder(
  userId: number,
  items: OrderItem[],
  discount?: number
): Order {
  const id = orderStore.size + 1;
  const order = createOrder(id, userId, items, discount);
  orderStore.set(id, order);
  return order;
}

export function findOrdersByUser(userId: number): Order[] {
  return Array.from(orderStore.values()).filter((o) => o.userId === userId);
}

export function findOrderById(id: number): Order | null {
  return orderStore.get(id) || null;
}
