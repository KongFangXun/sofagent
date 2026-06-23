// cache.js — 缓存层
const { logger } = require('./logger');

const memoryCache = new Map();
const TTL = 60000; // 60s

function setCached(key, value, ttl) {
  logger.info(`调用 setCached，参数: key=${key}, value=${JSON.stringify(value)}, ttl=${ttl || TTL}`);
  const expires = Date.now() + (ttl || TTL);
  memoryCache.set(key, { value, expires });
  logger.info(`完成 setCached，结果: expires=${expires}`);
}

function getCached(key) {
  logger.info(`调用 getCached，参数: key=${key}`);
  try {
    const entry = memoryCache.get(key);
    if (!entry) {
      logger.info(`完成 getCached，结果: null (not found)`);
      return null;
    }
    if (Date.now() > entry.expires) {
      memoryCache.delete(key);
      logger.info(`完成 getCached，结果: null (expired)`);
      return null;
    }
    logger.info(`完成 getCached，结果: ${JSON.stringify(entry.value)}`);
    return entry.value;
  } catch (e) {
    logger.error(`失败 getCached，原因: ${e.message}`);
    return null;
  }
}

function invalidate(key) {
  logger.info(`调用 invalidate，参数: key=${key}`);
  const result = memoryCache.delete(key);
  logger.info(`完成 invalidate，结果: ${result}`);
  return result;
}

function clearExpired() {
  logger.info(`调用 clearExpired，参数: (none)`);
  const now = Date.now();
  let cleared = 0;
  for (const [key, entry] of memoryCache) {
    if (now > entry.expires) {
      memoryCache.delete(key);
      cleared++;
    }
  }
  logger.info(`完成 clearExpired，结果: cleared=${cleared}`);
  return cleared;
}

module.exports = { setCached, getCached, invalidate, clearExpired };
