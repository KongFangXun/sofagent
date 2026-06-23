// repository.js — 数据访问层
// 返回 model 中定义的 User / Order 类型（迁移后）

const { createUser, createOrder } = require('./model');

const userStore = new Map();
const orderStore = new Map();

function saveUser(name, email) {
  const id = userStore.size + 1;
  const user = createUser(id, name, email);
  userStore.set(id, user);
  return user;
}

function findUserById(id) {
  return userStore.get(id) || null;
}

function findAllUsers() {
  return Array.from(userStore.values());
}

function saveOrder(userId, items, discount) {
  const id = orderStore.size + 1;
  const order = createOrder(id, userId, items, discount);
  orderStore.set(id, order);
  return order;
}

function findOrdersByUser(userId) {
  return Array.from(orderStore.values()).filter((o) => o.userId === userId);
}

function findOrderById(id) {
  return orderStore.get(id) || null;
}

module.exports = {
  saveUser, findUserById, findAllUsers,
  saveOrder, findOrdersByUser, findOrderById,
};
