// handler.ts — 处理层

import * as service from './service';
import { UserOrders } from './service';
import { User, Order } from './model';

export interface Request {
  params?: Record<string, string | number>;
  body?: Record<string, unknown>;
}

export interface Response<T> {
  status: number;
  body: T | { error: string };
}

export function handleRegister(req: Request): Response<User> {
  const name = req.body?.name as string;
  const email = req.body?.email as string;
  const result = service.registerUser(name, email);
  if (!result.ok) {
    return { status: 400, body: { error: result.error } };
  }
  return { status: 201, body: result.data };
}

export function handlePlaceOrder(req: Request): Response<Order> {
  const userId = Number(req.params?.userId);
  const items = req.body?.items as Array<{ name: string; price: number; qty: number }>;
  const discount = req.body?.discount as number | undefined;
  const result = service.placeOrder(userId, items, discount);
  if (!result.ok) {
    return { status: 400, body: { error: result.error } };
  }
  return { status: 201, body: result.data };
}

export function handleGetUserOrders(req: Request): Response<UserOrders> {
  const userId = Number(req.params?.userId);
  const result = service.getUserOrders(userId);
  if (!result.ok) {
    return { status: 404, body: { error: result.error } };
  }
  return { status: 200, body: result.data };
}

export function handleApplyDiscount(req: Request): Response<Order> {
  const orderId = Number(req.params?.orderId);
  const discount = req.body?.discount as number;
  const result = service.applyDiscount(orderId, discount);
  if (!result.ok) {
    return { status: 400, body: { error: result.error } };
  }
  return { status: 200, body: result.data };
}
