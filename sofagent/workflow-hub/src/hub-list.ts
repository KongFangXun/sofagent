// ============================================================
// hub-list.ts · Workflow Hub 模板列举
// v1.1.1 新增
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

export interface WorkflowTemplate {
  name: string;
  description: string;
  path: string;
}

const DEFAULT_TEMPLATE_DIRS = [
  path.join(__dirname, '..', '..', '..', 'workflow-hub', 'templates'),
  path.join(process.env.HOME || '/tmp', '.sofagent', 'workflow-templates'),
];

export function listTemplates(templateDir?: string): WorkflowTemplate[] {
  const dirs = templateDir ? [templateDir] : DEFAULT_TEMPLATE_DIRS;
  const templates: WorkflowTemplate[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const ymlPath = path.join(dir, entry.name, 'workflow.yml');
        const readmePath = path.join(dir, entry.name, 'README.md');
        if (fs.existsSync(ymlPath)) {
          templates.push({
            name: entry.name,
            description: fs.existsSync(readmePath)
              ? fs.readFileSync(readmePath, 'utf-8').split('\n')[0]!.replace(/^# /, '')
              : '(no description)',
            path: path.join(dir, entry.name),
          });
        }
      }
    }
  }

  return templates;
}
