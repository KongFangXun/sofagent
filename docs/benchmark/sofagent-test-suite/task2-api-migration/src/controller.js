// controller.js — 聚合三个 service
// 陷阱：这里有 result.errorMsg || 'unknown' 这种表达式
const serviceA = require('./service-a');
const serviceB = require('./service-b');
const serviceC = require('./service-c');

function handleUserOrderRequest(userId, orderId) {
  const result = serviceA.getUserWithOrder(userId, orderId);
  if (result.error) {
    return { status: 400, message: result.error };
  }
  return { status: 200, body: result };
}

function handleAvailabilityRequest(productId) {
  const result = serviceB.checkProductAvailability(productId);
  if (!result.available) {
    return { status: 404, message: result.reason || 'unknown' };
  }
  return { status: 200, body: result };
}

function handlePaymentVerification(paymentId) {
  const result = serviceC.verifyPayment(paymentId);
  if (!result.verified) {
    return { status: 402, message: result.message || 'Payment verification failed' };
  }
  return { status: 200, body: result };
}

function handleFullCheckout(userId, orderId, productId, paymentId) {
  const userOrder = handleUserOrderRequest(userId, orderId);
  const availability = handleAvailabilityRequest(productId);
  const payment = handlePaymentVerification(paymentId);

  if (userOrder.status !== 200) return userOrder;
  if (availability.status !== 200) return availability;
  if (payment.status !== 200) return payment;

  return { status: 200, body: { userOrder: userOrder.body, availability: availability.body, payment: payment.body } };
}

module.exports = {
  handleUserOrderRequest,
  handleAvailabilityRequest,
  handlePaymentVerification,
  handleFullCheckout,
};
