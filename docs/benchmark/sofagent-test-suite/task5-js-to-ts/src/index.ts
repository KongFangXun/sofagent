// index.ts — 入口

import * as handler from './handler';

function main(): void {
  console.log('=== Test Suite Task 5 ===');

  // 注册用户
  const regResult = handler.handleRegister({
    body: { name: 'Alice', email: 'alice@example.com' },
  });
  console.log('Register:', regResult);

  const regResult2 = handler.handleRegister({
    body: { name: 'Bob', email: 'bob@example.com' },
  });
  console.log('Register2:', regResult2);

  // 注册失败（名字太短）
  const badReg = handler.handleRegister({
    body: { name: 'A', email: 'a@b.com' },
  });
  console.log('Bad register:', badReg);

  // 下单
  const orderResult = handler.handlePlaceOrder({
    params: { userId: 1 },
    body: {
      items: [
        { name: 'Widget', price: 10, qty: 2 },
        { name: 'Gadget', price: 25, qty: 1 },
      ],
      discount: 5,
    },
  });
  console.log('Place order:', orderResult);

  // 下单失败（用户不存在）
  const badOrder = handler.handlePlaceOrder({
    params: { userId: 999 },
    body: { items: [{ name: 'X', price: 1, qty: 1 }] },
  });
  console.log('Bad order:', badOrder);

  // 查询用户订单
  const ordersResult = handler.handleGetUserOrders({
    params: { userId: 1 },
  });
  console.log('User orders:', ordersResult);

  // 折扣
  const discountResult = handler.handleApplyDiscount({
    params: { orderId: 1 },
    body: { discount: 10 },
  });
  console.log('Discount:', discountResult);

  // 折扣超额
  const badDiscount = handler.handleApplyDiscount({
    params: { orderId: 1 },
    body: { discount: 99999 },
  });
  console.log('Bad discount:', badDiscount);

  console.log('=== All OK ===');
}

main();
