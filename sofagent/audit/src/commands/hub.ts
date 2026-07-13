// ============================================================
// commands/hub.ts · Workflow Hub CLI
// v1.0.7 新增：hub deploy / hub list 命令
// ============================================================
// 依赖方向：sofagent 主项目 → Hub（单向依赖）
// Hub 模板不执行任何 sofagent CLI 命令
// --with-hub 安装是可选 submodule clone
// ============================================================

import { existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync, type Dirent } from 'fs';
import { join, resolve, sep } from 'path';

export interface HubDeployOptions {
  interactive: boolean;
}

/**
 * 查找 Workflow Hub 目录
 * 优先级：--with-hub submodule > 本地 workflow-hub/
 */
function findHubDir(): string | null {
  const cwd = process.cwd();

  // 1. 检查 submodule 路径
  const submodulePath = join(cwd, '.sofagent', 'workflows', 'hub');
  if (existsSync(join(submodulePath, 'CATALOG.md'))) {
    return submodulePath;
  }

  // 2. 检查本地 workflow-hub/ 目录（开发模式）
  const localPath = join(cwd, 'workflow-hub');
  if (existsSync(join(localPath, 'CATALOG.md'))) {
    return localPath;
  }

  // 3. 检查项目根目录下的 workflow-hub（相对于 sofagent/audit）
  const projectPath = join(cwd, '..', '..', '..', 'workflow-hub');
  if (existsSync(join(projectPath, 'CATALOG.md'))) {
    return projectPath;
  }

  return null;
}

/**
 * 列出所有可用的 Workflow Hub 模板
 */
export function listHubTemplates(): string[] {
  const hubDir = findHubDir();
  if (!hubDir) {
    console.log('未找到 Workflow Hub 模板目录。');
    console.log('');
    console.log('安装 Workflow Hub：');
    console.log('  git submodule add https://github.com/KongFangXun/sofagent-workflow-hub .sofagent/workflows/hub');
    console.log('  或在项目根目录创建 workflow-hub/ 目录');
    return [];
  }

  const templatesDir = join(hubDir, 'templates');
  if (!existsSync(templatesDir)) {
    console.log('Workflow Hub 模板目录为空。');
    return [];
  }

  // 读取 CATALOG.md
  const catalogPath = join(hubDir, 'CATALOG.md');
  if (existsSync(catalogPath)) {
    const content = readFileSync(catalogPath, 'utf-8');
    console.log(content);
  }

  // 递归列出模板
  // TODO: v1.x 与 copyDir() 的递归遍历逻辑重复，可提取公共 walkDir() 函数
  const templates: string[] = [];
  function scanDir(dir: string, prefix: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = join(dir, entry.name);
        const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (existsSync(join(subPath, 'workflow.yml'))) {
          templates.push(subPrefix);
          console.log(`  📋 ${subPrefix}`);
        }
        scanDir(subPath, subPrefix);
      }
    }
  }
  scanDir(templatesDir, '');

  return templates;
}

/**
 * 部署 Workflow Hub 模板到 .sofagent/workflows/
 * @param templateName 模板名称（如 "制造业/应付账款审批"）
 * @param options 部署选项
 */
export async function hubDeploy(templateName: string, options: HubDeployOptions): Promise<void> {
  const hubDir = findHubDir();
  if (!hubDir) {
    console.error('❌ 未找到 Workflow Hub 模板目录。请先安装：');
    console.error('   git submodule add https://github.com/KongFangXun/sofagent-workflow-hub .sofagent/workflows/hub');
    process.exit(1);
  }

  // v1.0.5 fix: 路径穿越防护——用 resolve 归一化后校验是否仍在 templates/ 目录内
  // 比 templateName.includes('..') 更严谨：拦住绝对路径、编码绕过、Windows 反斜杠等变体
  const templatesRoot = resolve(hubDir, 'templates');
  const templatePath = resolve(templatesRoot, templateName);
  if (!templatePath.startsWith(templatesRoot + sep) && templatePath !== templatesRoot) {
    console.error(`❌ 非法模板路径（越界）: ${templateName}`);
    process.exit(1);
  }

  if (!existsSync(templatePath)) {
    console.error(`❌ 模板不存在: ${templateName}`);
    console.error('   可用模板列表: sofagent hub list');
    process.exit(1);
  }

  if (!existsSync(join(templatePath, 'workflow.yml'))) {
    console.error(`❌ 模板 ${templateName} 缺少 workflow.yml`);
    process.exit(1);
  }

  // 读取模板的 README 显示适配指南
  const readmePath = join(templatePath, 'README.md');
  if (existsSync(readmePath) && options.interactive) {
    const readme = readFileSync(readmePath, 'utf-8');
    console.log('');
    console.log('=== 适配指南 ===');
    console.log(readme);
    console.log('');
  }

  // 部署到 .sofagent/workflows/
  const cwd = process.cwd();
  const targetDir = join(cwd, '.sofagent', 'workflows', templateName);

  console.log(`部署模板: ${templateName}`);
  console.log(`  来源: ${templatePath}`);
  console.log(`  目标: ${targetDir}`);

  // 递归复制模板文件
  // TODO: v1.x 与 scanDir() 的递归遍历逻辑重复，可提取公共 walkDir() 函数
  function copyDir(src: string, dest: string): void {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true });
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(src, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  copyDir(templatePath, targetDir);

  console.log(`✅ 模板 ${templateName} 已部署到 .sofagent/workflows/${templateName}`);
  console.log('');
  console.log('下一步：');
  console.log('  1. 编辑 .sofagent/workflows/' + templateName + '/knowledge/ 下的配置文件');
  console.log('  2. 运行 sofagent-audit --doctor 验证部署');
  console.log('  3. 提交: git add .sofagent/workflows/ && git commit -m "部署工作流"');
}
