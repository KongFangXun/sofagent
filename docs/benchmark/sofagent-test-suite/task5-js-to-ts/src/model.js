// model.js — 数据模型层
// Task 5: 应迁移为 model.ts，定义 User / Order interface

function createUser(id, name, email) {
  return { id, name, email, createdAt: new Date() };
}

function createOrder(id, userId, items, discount) {
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

module.exports = { createUser, createOrder };
