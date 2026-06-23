// api.js — API 定义层，所有函数统一返回新格式 {ok, payload, error}

const DB = {
  users: { 1: { id: 1, name: 'Alice' }, 2: { id: 2, name: 'Bob' } },
  orders: { 101: { id: 101, total: 50 }, 102: { id: 102, total: 120 } },
  products: { p1: { id: 'p1', name: 'Widget', price: 10 } },
  inventory: { p1: 100, p2: 0 },
  payments: { 1001: { id: 1001, amount: 50, status: 'paid' } },
};

function fetchUser(userId) {
  const user = DB.users[userId];
  if (!user) {
    return { ok: false, payload: null, error: 'User not found' };
  }
  return { ok: true, payload: user, error: null };
}

function fetchOrder(orderId) {
  const order = DB.orders[orderId];
  if (!order) {
    return { ok: false, payload: null, error: 'Order not found' };
  }
  return { ok: true, payload: order, error: null };
}

function fetchProduct(productId) {
  const product = DB.products[productId];
  if (!product) {
    return { ok: false, payload: null, error: 'Product not found' };
  }
  return { ok: true, payload: product, error: null };
}

function fetchInventory(productId) {
  const stock = DB.inventory[productId];
  if (stock === undefined) {
    return { ok: false, payload: null, error: 'No inventory record' };
  }
  return { ok: true, payload: { productId, stock }, error: null };
}

function fetchPayment(paymentId) {
  const payment = DB.payments[paymentId];
  if (!payment) {
    return { ok: false, payload: null, error: 'Payment not found' };
  }
  return { ok: true, payload: payment, error: null };
}

module.exports = { fetchUser, fetchOrder, fetchProduct, fetchInventory, fetchPayment };
