// ============================================================
// hub-deploy.ts · Workflow Hub 模板部署
// v1.1.1 新增
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { listTemplates } from './hub-list';

export function deployTemplate(
  templateName: string,
  projectDir: string,
): { success: boolean; output?: string; error?: string } {
  const templates = listTemplates();
  const template = templates.find(t => t.name === templateName);

  if (!template) {
    return { success: false, error: `Template not found: ${templateName}` };
  }

  const workflowPath = path.join(template.path, 'workflow.yml');
  if (!fs.existsSync(workflowPath)) {
    return { success: false, error: `workflow.yml not found in ${template.path}` };
  }

  const targetDir = path.join(projectDir, '.sofagent', 'workflows', templateName);
  fs.mkdirSync(targetDir, { recursive: true });

  // 复制模板文件到工作目录
  const ymlContent = fs.readFileSync(workflowPath, 'utf-8');
  fs.writeFileSync(path.join(targetDir, 'workflow.yml'), ymlContent, 'utf-8');

  return {
    success: true,
    output: `Deployed ${templateName} to ${targetDir}`,
  };
}
