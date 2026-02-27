import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type MemoryFileSummary = {
  name: string;
  path: string;
  size: number;
  updatedAt: number;
};

function workspaceRootDir(): string {
  return path.join(os.homedir(), ".openclaw", "workspace");
}

function memoryDir(): string {
  return path.join(workspaceRootDir(), "memory");
}

function normalizeRelative(p: string): string {
  return p.split(path.sep).join("/");
}

function collectMemoryFiles(dir: string, baseDir: string): MemoryFileSummary[] {
  if (!fs.existsSync(dir)) return [];

  const out: MemoryFileSummary[] = [];
  let entries: fs.Dirent[] = [];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMemoryFiles(full, baseDir));
      continue;
    }
    if (!entry.isFile()) continue;

    try {
      const st = fs.statSync(full);
      const rel = normalizeRelative(path.relative(baseDir, full));
      out.push({ name: rel, path: full, size: st.size, updatedAt: st.mtimeMs });
    } catch {
      // Skip unreadable or transient files.
    }
  }

  return out;
}

function rootMemoryFileSummary(): MemoryFileSummary | null {
  const full = path.join(workspaceRootDir(), "MEMORY.md");
  if (!fs.existsSync(full)) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) return null;
    return { name: "MEMORY.md", path: full, size: st.size, updatedAt: st.mtimeMs };
  } catch {
    return null;
  }
}

function resolveMemoryFilePath(name: string): string | null {
  if (!name || path.isAbsolute(name)) return null;

  const normalized = normalizeRelative(path.posix.normalize(name));
  if (normalized.startsWith("../") || normalized === "..") return null;

  if (normalized === "MEMORY.md") {
    return path.join(workspaceRootDir(), "MEMORY.md");
  }

  const memDir = memoryDir();
  const full = path.resolve(memDir, normalized);
  const rel = path.relative(memDir, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

export function listMemoryFiles(): MemoryFileSummary[] {
  const memDir = memoryDir();
  const files = collectMemoryFiles(memDir, memDir);
  const rootMemory = rootMemoryFileSummary();
  if (rootMemory) files.push(rootMemory);

  return files.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.name.localeCompare(b.name);
  });
}

export function readMemoryFile(name: string): string | null {
  const full = resolveMemoryFilePath(name);
  if (!full) return null;
  if (!fs.existsSync(full)) return null;
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

export function searchMemory(query: string): Array<{ file: string; line: number; text: string }> {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const out: Array<{ file: string; line: number; text: string }> = [];
  for (const file of listMemoryFiles()) {
    const content = readMemoryFile(file.name);
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.toLowerCase().includes(q)) {
        out.push({ file: file.name, line: idx + 1, text: line.slice(0, 280) });
      }
    });
    if (out.length > 200) break;
  }
  return out.slice(0, 200);
}
