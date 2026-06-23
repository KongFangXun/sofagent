// http.js — HTTP 请求封装层
const { logger } = require('./logger');

const ENDPOINTS = {
  auth: 'https://api.example.com/auth',
  data: 'https://api.example.com/data',
};

function request(method, url, body) {
  logger.info(`调用 request，参数: method=${method}, url=${url}, body=${JSON.stringify(body)}`);
  if (!method || !url) {
    logger.error(`失败 request，原因: Missing method or url`);
    throw new Error('Missing method or url');
  }
  const result = { status: 200, body: { ok: true, echoed: body || null } };
  logger.info(`完成 request，结果: ${JSON.stringify(result)}`);
  return result;
}

function get(url) {
  logger.info(`调用 get，参数: url=${url}`);
  const result = request('GET', url);
  logger.info(`完成 get，结果: ${JSON.stringify(result)}`);
  return result;
}

function post(url, body) {
  logger.info(`调用 post，参数: url=${url}, body=${JSON.stringify(body)}`);
  const result = request('POST', url, body);
  logger.info(`完成 post，结果: ${JSON.stringify(result)}`);
  return result;
}

function requestWithRetry(method, url, body, maxRetries) {
  logger.info(`调用 requestWithRetry，参数: method=${method}, url=${url}, maxRetries=${maxRetries}`);
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = request(method, url, body);
      if (result.status >= 500 && attempt < maxRetries) {
        continue;
      }
      logger.info(`完成 requestWithRetry，结果: ${JSON.stringify(result)}`);
      return result;
    } catch (e) {
      lastError = e;
      if (attempt >= maxRetries) break;
    }
  }
  logger.error(`失败 requestWithRetry，原因: ${lastError?.message || 'Max retries exceeded'}`);
  throw lastError || new Error('Max retries exceeded');
}

module.exports = { request, get, post, requestWithRetry, ENDPOINTS };
