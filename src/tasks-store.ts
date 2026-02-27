import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { Task, TaskStatus, TaskPriority, TaskUpdate } from "./types.js";

function getStoreDir(): string {
  const dir = path.join(os.homedir(), ".openclaw", "workspace", "mission-control");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getStorePath(): string {
  return path.join(getStoreDir(), "tasks.json");
}

function normalizeTask(task: Task): Task {
  return {
    ...task,
    updates: Array.isArray(task.updates) ? task.updates : [],
  };
}

function readTasks(): Task[] {
  const p = getStorePath();
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Task[];
    return Array.isArray(parsed) ? parsed.map((t) => normalizeTask(t)) : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: Task[]): void {
  fs.writeFileSync(getStorePath(), JSON.stringify(tasks, null, 2), "utf8");
}

export function listTasks(filter?: { agentId?: string; status?: TaskStatus }): Task[] {
  let tasks = readTasks();
  if (filter?.agentId) tasks = tasks.filter((t) => t.agentId === filter.agentId);
  if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
  return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createTask(data: {
  title: string;
  agentId: string;
  description?: string;
  priority?: TaskPriority;
}): Task {
  const now = Date.now();
  const taskId = randomUUID();
  const task: Task = {
    id: taskId,
    title: data.title,
    description: data.description,
    agentId: data.agentId,
    status: "pending",
    priority: data.priority ?? "normal",
    taskType: "manual",
    executionMode: "agent",
    maxRetries: 2,
    retryCount: 0,
    requiresApproval: false,
    tags: [],
    contextJson: "{}",
    sortOrder: 0,
    updates: [
      {
        id: randomUUID(),
        taskId,
        createdAt: now,
        author: "system",
        note: "Task created",
        status: "pending",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  const tasks = readTasks();
  tasks.push(task);
  writeTasks(tasks);
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<
    Pick<Task, "title" | "description" | "status" | "priority" | "agentId" | "sessionKey" | "tags" | "updates">
  >,
): Task | null {
  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const before = tasks[idx];
  const next = { ...before, ...patch, updatedAt: Date.now() };

  if (before.status !== next.status) {
    const upd: TaskUpdate = {
      id: randomUUID(),
      taskId: before.id,
      createdAt: Date.now(),
      author: "system",
      note: `Status changed to ${next.status}`,
      status: next.status,
    };
    next.updates = [...(next.updates ?? before.updates ?? []), upd];
  }

  tasks[idx] = normalizeTask(next);
  writeTasks(tasks);
  return tasks[idx];
}

export function addTaskUpdate(id: string, data: {
  author?: string;
  note: string;
  status?: TaskStatus;
  link?: string;
}): Task | null {
  const tasks = readTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const task = tasks[idx];
  const update: TaskUpdate = {
    id: randomUUID(),
    taskId: id,
    createdAt: Date.now(),
    author: data.author?.trim() || "system",
    note: data.note.trim(),
    status: data.status,
    link: data.link?.trim() || undefined,
  };

  task.updates = [...(task.updates ?? []), update];
  if (data.status) task.status = data.status;
  task.updatedAt = Date.now();

  tasks[idx] = task;
  writeTasks(tasks);
  return task;
}

export function deleteTask(id: string): boolean {
  const tasks = readTasks();
  const next = tasks.filter((t) => t.id !== id);
  if (next.length === tasks.length) return false;
  writeTasks(next);
  return true;
}
