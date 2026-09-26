// ============================================================
// demo-fixtures/index.ts · 种子数据桶文件（v1.5.3 第八章）
// ============================================================
// 消费方只有一个：../demo.ts。桶文件保持与 engine/audit/src/cli/index.ts
// 既有的「桶文件 re-export」惯例一致（不自造第二套导出风格）。
// ============================================================

export {
  SANDBOX_PREFIX,
  SANDBOX_PLACEHOLDER,
  DEMO_GIT_USER,
  DEMO_GIT_DATE,
  DEMO_TASK_SUBJECT,
  SEED_BASE_SUBJECT,
  SEED_GITIGNORE,
  SEED_ORDERS_JS,
  SEED_CUSTOMERS_JS,
  SEED_SYSTEM_PROMPT,
  SEED_WORKFLOW_YML,
  WORKFLOW_PATH,
  VIOLATION_ENV_FILE,
  VIOLATION_ENV_CONTENT,
  VIOLATION_ENV_SUBJECT,
  VIOLATION_SECRET_FILE,
  VIOLATION_SECRET_SUBJECT,
  VIOLATION_SCOPE_FILE,
  POLLUTION_MARKER,
  demoSandboxKey,
  violationSecretContent,
  violationScopeContent,
} from './seed';
