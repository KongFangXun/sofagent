declare module '@sofagent/daemon' {
  export function restoreSnapshot(projectDir: string, sha: string): string[];
  export function listAllSnapshots(projectDir: string): Array<{
    timestamp: string;
    shortSha: string;
    fileCount: number;
  }>;
}
