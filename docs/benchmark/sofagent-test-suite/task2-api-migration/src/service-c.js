// service-c.js — 支付服务
const api = require('./api');

function verifyPayment(paymentId) {
  const result = api.fetchPayment(paymentId);
  if (!result.ok) {
    return { verified: false, message: result.error };
  }
  const payment = result.payload;
  return {
    verified: payment.status === 'paid',
    amount: payment.amount,
  };
}

function refundPayment(paymentId) {
  const result = api.fetchPayment(paymentId);
  if (!result.ok) {
    return { refunded: false, error: result.error };
  }
  // 模拟退款
  return { refunded: true, originalAmount: result.payload.amount };
}

module.exports = { verifyPayment, refundPayment };
