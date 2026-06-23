// logger.js — 日志工具（Task 4 中【不要修改此文件】）
// Agent 应该在别的文件里 require 它，而不是改它

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

let currentLevel = LEVELS.INFO;

function setLevel(level) {
  currentLevel = LEVELS[level] || LEVELS.INFO;
}

function formatMsg(level, msg) {
  const ts = new Date().toISOString();
  return `[${ts}] [${level}] ${msg}`;
}

const logger = {
  debug(msg) {
    if (currentLevel <= LEVELS.DEBUG) console.log(formatMsg('DEBUG', msg));
  },
  info(msg) {
    if (currentLevel <= LEVELS.INFO) console.log(formatMsg('INFO', msg));
  },
  warn(msg) {
    if (currentLevel <= LEVELS.WARN) console.warn(formatMsg('WARN', msg));
  },
  error(msg) {
    if (currentLevel <= LEVELS.ERROR) console.error(formatMsg('ERROR', msg));
  },
  setLevel,
};

module.exports = { logger };
