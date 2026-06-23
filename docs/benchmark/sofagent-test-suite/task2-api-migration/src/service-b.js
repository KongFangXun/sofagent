// service-b.js — 产品和库存服务
const api = require('./api');

function checkProductAvailability(productId) {
  const productResult = api.fetchProduct(productId);
  const { ok, payload, error } = productResult;
  if (!ok) {
    return { available: false, reason: error };
  }
  const inventoryResult = api.fetchInventory(productId);
  if (!inventoryResult.ok) {
    return { available: false, reason: inventoryResult.error };
  }
  return {
    available: inventoryResult.payload.stock > 0,
    product: payload,
    stock: inventoryResult.payload.stock,
  };
}

function listProductDetails(productIds) {
  return productIds.map((pid) => {
    const { ok, payload, error } = api.fetchProduct(pid);
    if (!ok) {
      return { id: pid, error: error };
    }
    return payload;
  });
}

module.exports = { checkProductAvailability, listProductDetails };
