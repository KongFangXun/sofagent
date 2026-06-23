// service-a.js — 用户和订单服务
const api = require('./api');

function getUserWithOrder(userId, orderId) {
  const userResult = api.fetchUser(userId);
  if (!userResult.ok) {
    return { error: userResult.error };
  }
  const orderResult = api.fetchOrder(orderId);
  if (!orderResult.ok) {
    return { error: orderResult.error };
  }
  return {
    user: userResult.payload,
    order: orderResult.payload,
  };
}

function batchFetchUsers(userIds) {
  return userIds.map((id) => {
    const result = api.fetchUser(id);
    return result.ok ? result.payload : null;
  });
}

module.exports = { getUserWithOrder, batchFetchUsers };
