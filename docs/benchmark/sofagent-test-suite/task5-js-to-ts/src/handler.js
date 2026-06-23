// handler.js — 处理层
// 将 service 的 Result 转换为 HTTP 风格响应

const service = require('./service');

function handleRegister(req) {
  const result = service.registerUser(req.body.name, req.body.email);
  if (!result.ok) {
    return { status: 400, body: { error: result.error } };
  }
  return { status: 201, body: result.data };
}

function handlePlaceOrder(req) {
  const result = service.placeOrder(
    req.params.userId,
    req.body.items,
    req.body.discount
  );
  if (!result.ok) {
    return { status: 400, body: { error: result.error } };
  }
  return { status: 201, body: result.data };
}

function handleGetUserOrders(req) {
  const result = service.getUserOrders(req.params.userId);
  if (!result.ok) {
    return { status: 404, body: { error: result.error } };
  }
  return { status: 200, body: result.data };
}

function handleApplyDiscount(req) {
  const result = service.applyDiscount(req.params.orderId, req.body.discount);
  if (!result.ok) {
    return { status: 400, body: { error: result.error } };
  }
  return { status: 200, body: result.data };
}

module.exports = {
  handleRegister,
  handlePlaceOrder,
  handleGetUserOrders,
  handleApplyDiscount,
};
