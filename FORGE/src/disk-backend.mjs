// ============================================================
// FORGE/src/disk-backend.mjs · DiskBackend for deepagents
//
// 让 deepagents 内置文件工具（ls/read_file/write_file/edit_file
// /glob/grep）直接操作真实磁盘文件，替代默认的 StateBackend（虚拟 FS）。
//
// deepagents backend 协议（adaptBackendProtocol）兼容的返回格式：
//   ls(path)       → {files: [{path, is_dir, size?, modified_at?}]}
//   readRaw(path)  → {data: {content, mimeType, created_at, modified_at}} | {error}
//   read(path,o,l) → {content: string} | {error}
//   glob(pat,path) → {files: [string, ...]}
//   write(path,ct) → {path, filesUpdate}
//   edit(...)      → {path, filesUpdate, occurrences} | {error}
//   grep(pat,p,g)  → {matches: [{path, line, content}]} | {error}
//
// 路径安全：所有操作限制在 rootDir 内，防止路径穿越攻击。
// ============================================================

import {
  readFileSync, writeFileSync, readdirSync, statSync,
  existsSync, mkdirSync,
} from 'fs';
import { join, resolve, relative, dirname, sep, isAbsolute } from 'path';
import { execSync } from 'child_process';

/**
 * 默认忽略的目录名（ls 和 glob 不列出这些目录的内容）。
 * grep 也不搜索这些目录。
 */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next', '.nuxt',
  '.turbo', '.cache', '.parcel-cache', 'coverage',
  '__pycache__', '.pytest_cache', '.venv', 'venv',
]);

/**
 * 默认忽略的文件名。
 */
const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db',
]);

/**
 * DiskBackend — 让 deepagents 内置文件工具操作真实磁盘。
 *
 * 替代默认的 StateBackend（虚拟 FS），让 agent 的 ls/read_file/write_file
 * /edit_file/glob/grep 直接读写项目文件。
 *
 * 路径安全：所有操作限制在 rootDir 内，防止路径穿越。
 */
export class DiskBackend {
  /**
   * @param {object} [config]  deepagents 传入的 runtime config
   *   - config.configurable.diskRoot: 根目录绝对路径（覆盖默认值）
   * 如果 config 不存在或未指定 diskRoot，则使用 process.cwd()。
   */
  constructor(config) {
    const configurableRoot = config?.configurable?.diskRoot;
    this.rootDir = configurableRoot
      ? resolve(configurableRoot)
      : process.cwd();
  }

  // ═══════════════════════════════════════════════════════════
  //  路径安全
  // ═══════════════════════════════════════════════════════════

  /**
   * 将相对/绝对路径解析为 rootDir 内的安全绝对路径。
   *
   * 防止路径穿越（path traversal）：
   *   - 如果输入是绝对路径且在 rootDir 内，直接使用
   *   - 如果输入是相对路径，拼接到 rootDir 下
   *   - 如果解析后路径超出 rootDir 范围，抛出错误
   *
   * @param {string} relPath  agent 传入的路径（可能相对或绝对）
   * @returns {string} 安全的绝对路径（保证在 rootDir 内）
   * @throws {Error} 如果路径越界（解析后在 rootDir 之外）
   */
  _resolveSafe(relPath) {
    if (!relPath || relPath === '/' || relPath === '.') {
      return this.rootDir;
    }

    // 如果传入的是绝对路径，且在 rootDir 内部，直接使用
    if (isAbsolute(relPath)) {
      const resolved = resolve(relPath);
      const rel = relative(this.rootDir, resolved);
      // 在 rootDir 内部（rel 不以 .. 开头）→ 直接用
      if (!rel.startsWith('..')) {
        return resolved;
      }
      // 在 rootDir 外部但以 / 开头 → 当作 rootDir 内的相对路径
      // （agent 常用虚拟根 / 表示项目根，如 /package.json）
      const stripped = relPath.replace(/^[/\\]+/, '');
      return resolve(this.rootDir, stripped);
    }

    // 相对路径 → 相对于 rootDir 解析
    const abs = resolve(this.rootDir, relPath);
    const rel = relative(this.rootDir, abs);

    // rel 以 .. 开头 = 越界；abs === rootDir（rel === ''）合法
    if (rel.startsWith('..')) {
      throw new Error(`路径越界: ${relPath} (root=${this.rootDir})`);
    }

    return abs;
  }

  /**
   * 将绝对路径转换为相对于 rootDir 的相对路径。
   * 用于返回给 agent 的结果（agent 期望看到相对路径）。
   *
   * @param {string} absPath  绝对路径
   * @returns {string} 相对于 rootDir 的路径（不以 / 开头）
   */
  _toRel(absPath) {
    return relative(this.rootDir, absPath);
  }

  // ═══════════════════════════════════════════════════════════
  //  ls — 列目录
  // ═══════════════════════════════════════════════════════════

  /**
   * 列出指定目录下的文件和子目录。
   *
   * @param {string} path  目录路径（相对或绝对，在 rootDir 内）
   * @returns {Promise<{files: Array<{path: string, is_dir: boolean, size?: number, modified_at?: string}>}>}
   *   返回 {files: [...]}，每个条目含 path（相对路径）、is_dir、可选 size 和 modified_at。
   *   忽略 node_modules, .git, dist 等目录。
   *   如果路径不存在或不是目录，返回 {files: []}。
   */
  async ls(path) {
    const abs = this._resolveSafe(path || '.');

    if (!existsSync(abs)) {
      return { files: [] };
    }

    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return { files: [] };
    }

    if (!stat.isDirectory()) {
      return { files: [] };
    }

    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return { files: [] };
    }

    const files = [];
    for (const entry of entries) {
      // 过滤忽略项
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (IGNORE_FILES.has(entry.name)) continue;

      const entryAbs = join(abs, entry.name);
      try {
        const entryStat = statSync(entryAbs);
        const isDir = entryStat.isDirectory();

        files.push({
          path: isDir ? entry.name + '/' : entry.name,
          is_dir: isDir,
          size: isDir ? 0 : entryStat.size,
          modified_at: entryStat.mtime.toISOString(),
        });
      } catch {
        // stat 失败（权限不足、symlink 断链等），跳过
      }
    }

    // 排序：目录在前，文件在后，各自按名称排序
    files.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    return { files };
  }

  // ═══════════════════════════════════════════════════════════
  //  read — 读文件（带行号 offset/limit）
  // ═══════════════════════════════════════════════════════════

  /**
   * 读取文件内容，支持行级分页。
   *
   * @param {string} filePath  文件路径（相对或绝对）
   * @param {number} [offset=0]  起始行号（0-based）
   * @param {number} [limit=500] 最大返回行数
   * @returns {Promise<{content: string} | {error: string}>}
   *   成功返回 {content}，文件不存在返回 {error}。
   */
  async read(filePath, offset = 0, limit = 500) {
    const abs = this._resolveSafe(filePath);

    if (!existsSync(abs)) {
      return { error: `File '${filePath}' not found` };
    }

    let content;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch (err) {
      return { error: `Failed to read '${filePath}': ${err.message}` };
    }

    const lines = content.split('\n');
    const start = Math.max(0, offset);
    const end = Math.min(lines.length, start + limit);
    const sliced = lines.slice(start, end).join('\n');

    return { content: sliced };
  }

  // ═══════════════════════════════════════════════════════════
  //  readRaw — 读原始内容（FileData 格式）
  // ═══════════════════════════════════════════════════════════

  /**
   * 读取文件原始内容，返回 deepagents FileData v2 格式。
   *
   * @param {string} filePath  文件路径
   * @returns {Promise<{data: {content: string, mimeType: string, created_at: string, modified_at: string}} | {error: string}>}
   */
  async readRaw(filePath) {
    const abs = this._resolveSafe(filePath);

    if (!existsSync(abs)) {
      return { error: `File '${filePath}' not found` };
    }

    let content;
    let stat;
    try {
      content = readFileSync(abs, 'utf-8');
      stat = statSync(abs);
    } catch (err) {
      return { error: `Failed to read '${filePath}': ${err.message}` };
    }

    const now = new Date().toISOString();
    const mtime = stat.mtime.toISOString();

    return {
      data: {
        content,
        mimeType: this._getMimeType(filePath),
        created_at: mtime,
        modified_at: mtime,
      },
    };
  }

  /**
   * 根据文件扩展名推断 MIME 类型。
   * @param {string} filePath
   * @returns {string}
   */
  _getMimeType(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const types = {
      js: 'text/javascript', mjs: 'text/javascript',
      ts: 'text/typescript', tsx: 'text/typescript',
      jsx: 'text/javascript',
      json: 'application/json',
      md: 'text/markdown',
      html: 'text/html', htm: 'text/html',
      css: 'text/css',
      py: 'text/x-python',
      yml: 'text/yaml', yaml: 'text/yaml',
      txt: 'text/plain',
      svg: 'image/svg+xml',
    };
    return types[ext] || 'text/plain';
  }

  // ═══════════════════════════════════════════════════════════
  //  glob — 模式匹配文件
  // ═══════════════════════════════════════════════════════════

  /**
   * 用 glob 模式匹配文件路径。
   *
   * 使用系统 find + 简单 glob 转 find pattern 实现。
   * 返回相对于 searchPath 的路径列表。
   *
   * @param {string} pattern  glob 模式（如 "∗∗/∗.mjs"、"src/∗∗/∗.ts"，用星号代替避免注释冲突）
   * @param {string} [path='.']  搜索根目录（相对或绝对）
   * @returns {Promise<{files: string[]}>}
   */
  async glob(pattern, path = '.') {
    if (!pattern || typeof pattern !== 'string') {
      return { files: [] };
    }
    const searchRoot = this._resolveSafe(path);

    if (!existsSync(searchRoot) || !statSync(searchRoot).isDirectory()) {
      return { files: [] };
    }

    // 构建 find 排除参数（忽略 node_modules 等）
    const pruneArgs = [...IGNORE_DIRS].map(d => `-name ${d} -prune`).join(' -o ');
    // find 的 -name 模式支持基本的通配符，但 glob ** 语法需要转换
    // 策略：用 find 列出所有文件，然后在 JS 中用 minimatch 风格匹配
    const findCmd = `find ${JSON.stringify(searchRoot)} \\( ${pruneArgs} \\) -o -type f -print`;

    let allFiles;
    try {
      const output = execSync(findCmd, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50MB
        timeout: 30000,
      });
      allFiles = output.split('\n').filter(Boolean);
    } catch {
      return { files: [] };
    }

    // 将 glob pattern 转为正则表达式
    const regex = this._globToRegex(pattern);

    // 匹配文件（相对于 searchRoot）
    const matched = [];
    for (const absPath of allFiles) {
      const relPath = relative(searchRoot, absPath);
      if (regex.test(relPath) || regex.test(relPath.replace(/\\/g, '/'))) {
        matched.push(relPath);
      }
    }

    matched.sort();
    return { files: matched };
  }

  /**
   * 将 glob 模式转换为正则表达式（支持 **, *, ? 基本语法）。
   * @param {string} pattern
   * @returns {RegExp}
   */
  _globToRegex(pattern) {
    let re = '';
    let i = 0;
    while (i < pattern.length) {
      const c = pattern[i];
      if (c === '*' && pattern[i + 1] === '*') {
        // ** → 匹配任意层级目录
        i += 2;
        if (pattern[i] === '/') i++; // 消费 **/ 中的 /
        re += '.*';
      } else if (c === '*') {
        re += '[^/]*';
        i++;
      } else if (c === '?') {
        re += '[^/]';
        i++;
      } else if ('.+^${}()|[]\\'.includes(c)) {
        re += '\\' + c;
        i++;
      } else {
        re += c;
        i++;
      }
    }
    return new RegExp('^' + re + '$');
  }

  // ═══════════════════════════════════════════════════════════
  //  write — 写文件
  // ═══════════════════════════════════════════════════════════

  /**
   * 写文件（覆盖写入）。自动创建父目录。
   *
   * @param {string} filePath  目标文件路径
   * @param {string} content   文件内容
   * @returns {Promise<{path: string, filesUpdate: null}>}
   * @throws {Error} 如果路径越界或写入失败
   */
  async write(filePath, content) {
    const abs = this._resolveSafe(filePath);

    // 确保父目录存在
    const dir = dirname(abs);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(abs, content, 'utf-8');

    return {
      path: filePath,
      filesUpdate: null,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  edit — 编辑文件（字符串替换）
  // ═══════════════════════════════════════════════════════════

  /**
   * 编辑文件：将 oldString 替换为 newString。
   *
   * 验证逻辑（与 deepagents performStringReplacement 一致）：
   *   - oldString 为空且文件有内容 → 报错
   *   - oldString 不存在 → 报错
   *   - 多次匹配且未设 replaceAll → 报错
   *
   * @param {string} filePath    文件路径
   * @param {string} oldString   要查找的字符串
   * @param {string} newString   替换为的字符串
   * @param {boolean} [replaceAll=false]  是否替换所有匹配
   * @returns {Promise<{path: string, filesUpdate: null, occurrences: number} | {error: string}>}
   */
  async edit(filePath, oldString, newString, replaceAll = false) {
    const abs = this._resolveSafe(filePath);

    if (!existsSync(abs)) {
      return { error: `Error: File '${filePath}' not found` };
    }

    let content;
    try {
      content = readFileSync(abs, 'utf-8');
    } catch (err) {
      return { error: `Error: ${err.message}` };
    }

    // 验证逻辑（镜像 deepagents performStringReplacement）
    if (content === '' && oldString === '') {
      // 空文件空搜索 → 写入 newString，0 次替换
      writeFileSync(abs, newString, 'utf-8');
      return { path: filePath, filesUpdate: null, occurrences: 0 };
    }

    if (oldString === '') {
      return { error: 'Error: oldString cannot be empty when file has content' };
    }

    const occurrences = content.split(oldString).length - 1;

    if (occurrences === 0) {
      return { error: `Error: String not found in file: '${oldString}'` };
    }

    if (occurrences > 1 && !replaceAll) {
      return {
        error: `Error: String '${oldString}' has multiple occurrences (appears ${occurrences} times) in file. Use replace_all=True to replace all instances, or provide a more specific string with surrounding context.`,
      };
    }

    // 执行替换
    const newContent = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);

    writeFileSync(abs, newContent, 'utf-8');

    return {
      path: filePath,
      filesUpdate: null,
      occurrences,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  grep — 搜索文件内容
  // ═══════════════════════════════════════════════════════════

  /**
   * 在文件中搜索匹配 pattern 的行。
   *
   * 使用系统 grep -rn 实现（macOS/Linux 兼容）。
   * 自动排除 IGNORE_DIRS 中的目录。
   *
   * @param {string} pattern  正则表达式模式
   * @param {string} [path='.']  搜索根目录
   * @param {string} [glob=null]  文件名 glob 过滤（如 "*.mjs"）
   * @returns {Promise<{matches: Array<{path: string, line: number, content: string}>} | {error: string}>}
   */
  async grep(pattern, path = '.', glob = null) {
    if (!pattern || typeof pattern !== 'string') {
      return { matches: [] };
    }
    const searchRoot = this._resolveSafe(path);

    if (!existsSync(searchRoot)) {
      return { matches: [] };
    }

    // 构建 grep 排除参数
    const excludeDirArgs = [...IGNORE_DIRS].flatMap(d => ['--exclude-dir', d]);
    const includeArgs = glob ? ['--include', glob] : [];

    // 使用 grep -rn（递归、显示行号、不区分大小写关闭）
    // 注意：pattern 可能含特殊字符，用 -E 扩展正则
    const args = [
      '-rn', '-E',
      ...excludeDirArgs,
      ...includeArgs,
      '--', JSON.stringify(pattern),
      JSON.stringify(searchRoot),
    ];

    let output;
    try {
      // 用数组传参避免 shell 注入
      output = execSync(`grep ${args.join(' ')}`, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30000,
      });
    } catch (err) {
      // grep 返回非 0 = 无匹配（exit code 1），不是错误
      if (err.status === 1) return { matches: [] };
      // 其他错误（如命令不存在）
      return { error: `grep failed: ${err.message}` };
    }

    const matches = [];
    for (const line of output.split('\n')) {
      if (!line) continue;
      // grep -rn 输出格式：path:lineNum:content
      const colonIdx1 = line.indexOf(':');
      const colonIdx2 = line.indexOf(':', colonIdx1 + 1);
      if (colonIdx1 === -1 || colonIdx2 === -1) continue;

      const absMatchPath = line.slice(0, colonIdx1);
      const lineNum = parseInt(line.slice(colonIdx1 + 1, colonIdx2), 10);
      const content = line.slice(colonIdx2 + 1);

      // 转为相对路径
      const relPath = relative(searchRoot, absMatchPath);

      matches.push({
        path: relPath,
        line: lineNum,
        content,
      });
    }

    return { matches };
  }
}
