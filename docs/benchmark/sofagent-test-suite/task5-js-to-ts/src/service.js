// service.js — 业务服务层
// 返回 Result 类型（成功/失败联合），Task 5 中需定义泛型 Result<T>

const repo = require('./repository');

function registerUser(name, email) {
  if (!name || name.length < 2) {
    return { ok: false, error: 'Name too short' };
  }
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Invalid email' };
  }
  const user = repo.saveUser(name, email);
  return { ok: true, data: user };
}

function placeOrder(userId, items, discount) {
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

function getUserOrders(userId) {
  const user = repo.findUserById(userId);
  if (!user) {
    return { ok: false, error: 'User not found' };
  }
  const orders = repo.findOrdersByUser(userId);
  return { ok: true, data: { user, orders } };
}

function applyDiscount(orderId, discount) {
  const order = repo.findOrderById(orderId);
  if (!order) {
    return { ok: false, error: 'Order not found' };
  }
  const newTotal = order.subtotal - discount;
  if (newTotal < 0) {
    return { ok: false, error: 'Discount exceeds subtotal' };
  }
  return { ok: true, data: { ...order, discount, total: newTotal } };
}

module.exports = { registerUser, placeOrder, getUserOrders, applyDiscount };
