// index.js — 入口
const serviceA = require('./service-a');
const serviceB = require('./service-b');
const serviceC = require('./service-c');
const controller = require('./controller');

function main() {
  console.log('=== Test Suite Task 2 ===');

  // 成功场景
  console.log('User+Order:', serviceA.getUserWithOrder(1, 101));
  console.log('Batch Users:', serviceA.batchFetchUsers([1, 2, 999]));

  console.log('Availability:', serviceB.checkProductAvailability('p1'));
  console.log('Availability (no stock):', serviceB.checkProductAvailability('p2'));
  console.log('Product Details:', serviceB.listProductDetails(['p1', 'pX']));

  console.log('Payment:', serviceC.verifyPayment(1001));
  console.log('Refund:', serviceC.refundPayment(1001));

  // Controller 测试
  console.log('Checkout:', controller.handleFullCheckout(1, 101, 'p1', 1001));

  // 失败场景
  console.log('Bad user:', controller.handleUserOrderRequest(999, 101));
  console.log('Bad product:', controller.handleAvailabilityRequest('pX'));

  console.log('=== All OK ===');
}

main();
