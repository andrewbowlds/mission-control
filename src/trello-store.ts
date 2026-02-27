import { randomUUID } from "node:crypto";
import { getMcDb } from "./mc-db.js";
import type {
  TrelloBoard,
  TrelloList,
  TrelloCard,
  TrelloComment,
  TrelloLabel,
  TrelloChecklistItem,
} from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonArray<T>(json: string | null | undefined, fallback: T[] = []): T[] {
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ── Boards ───────────────────────────────────────────────────────────────────

export function listBoards(): TrelloBoard[] {
  const db = getMcDb();
  const rows = db.prepare("SELECT * FROM trello_boards ORDER BY created_at DESC").all() as any[];
  return rows.map(rowToBoard);
}

export function getBoard(id: string): TrelloBoard | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM trello_boards WHERE id = ?").get(id) as any;
  return row ? rowToBoard(row) : undefined;
}

export function createBoard(data: { name: string; description?: string }): TrelloBoard {
  const db = getMcDb();
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO trello_boards (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, data.name, data.description ?? null, now, now);
  return getBoard(id)!;
}

export function updateBoard(id: string, patch: { name?: string; description?: string }): TrelloBoard | undefined {
  const db = getMcDb();
  const existing = getBoard(id);
  if (!existing) return undefined;
  const name = patch.name ?? existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  db.prepare(
    "UPDATE trello_boards SET name = ?, description = ?, updated_at = ? WHERE id = ?",
  ).run(name, description ?? null, Date.now(), id);
  return getBoard(id);
}

export function deleteBoard(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM trello_boards WHERE id = ?").run(id);
  return result.changes > 0;
}

function rowToBoard(row: any): TrelloBoard {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Lists ────────────────────────────────────────────────────────────────────

export function listLists(boardId: string): TrelloList[] {
  const db = getMcDb();
  const rows = db
    .prepare("SELECT * FROM trello_lists WHERE board_id = ? ORDER BY position ASC, created_at ASC")
    .all(boardId) as any[];
  return rows.map(rowToList);
}

export function getList(id: string): TrelloList | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM trello_lists WHERE id = ?").get(id) as any;
  return row ? rowToList(row) : undefined;
}

export function createList(data: { boardId: string; name: string }): TrelloList {
  const db = getMcDb();
  const id = randomUUID();
  // Position after the last list in this board
  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as mp FROM trello_lists WHERE board_id = ?")
    .get(data.boardId) as any;
  const position = (maxPos?.mp ?? -1) + 1;
  db.prepare(
    "INSERT INTO trello_lists (id, board_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, data.boardId, data.name, position, Date.now());
  return getList(id)!;
}

export function updateList(id: string, patch: { name?: string; position?: number }): TrelloList | undefined {
  const db = getMcDb();
  const existing = getList(id);
  if (!existing) return undefined;
  const name = patch.name ?? existing.name;
  const position = patch.position ?? existing.position;
  db.prepare("UPDATE trello_lists SET name = ?, position = ? WHERE id = ?").run(name, position, id);
  return getList(id);
}

export function deleteList(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM trello_lists WHERE id = ?").run(id);
  return result.changes > 0;
}

function rowToList(row: any): TrelloList {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
  };
}

// ── Cards ────────────────────────────────────────────────────────────────────

export function listCards(boardId: string): TrelloCard[] {
  const db = getMcDb();
  const rows = db
    .prepare("SELECT * FROM trello_cards WHERE board_id = ? ORDER BY position ASC, created_at ASC")
    .all(boardId) as any[];
  return rows.map(rowToCard);
}

export function getCard(id: string): TrelloCard | undefined {
  const db = getMcDb();
  const row = db.prepare("SELECT * FROM trello_cards WHERE id = ?").get(id) as any;
  return row ? rowToCard(row) : undefined;
}

export function createCard(data: {
  listId: string;
  boardId: string;
  title: string;
  description?: string;
  labels?: TrelloLabel[];
  dueAt?: number;
  assignee?: string;
  checklist?: TrelloChecklistItem[];
  coverColor?: string;
}): TrelloCard {
  const db = getMcDb();
  const id = randomUUID();
  const now = Date.now();
  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as mp FROM trello_cards WHERE list_id = ?")
    .get(data.listId) as any;
  const position = (maxPos?.mp ?? -1) + 1;
  db.prepare(`
    INSERT INTO trello_cards (id, list_id, board_id, title, description, position, labels_json, due_at, assignee, checklist_json, cover_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.listId,
    data.boardId,
    data.title,
    data.description ?? null,
    position,
    JSON.stringify(data.labels ?? []),
    data.dueAt ?? null,
    data.assignee ?? null,
    JSON.stringify(data.checklist ?? []),
    data.coverColor ?? null,
    now,
    now,
  );
  return getCard(id)!;
}

export function updateCard(
  id: string,
  patch: {
    title?: string;
    description?: string;
    labels?: TrelloLabel[];
    dueAt?: number | null;
    assignee?: string | null;
    checklist?: TrelloChecklistItem[];
    coverColor?: string | null;
    position?: number;
    listId?: string;
  },
): TrelloCard | undefined {
  const db = getMcDb();
  const existing = getCard(id);
  if (!existing) return undefined;

  const title = patch.title ?? existing.title;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const labels = patch.labels ?? existing.labels;
  const dueAt = patch.dueAt !== undefined ? patch.dueAt : existing.dueAt;
  const assignee = patch.assignee !== undefined ? patch.assignee : existing.assignee;
  const checklist = patch.checklist ?? existing.checklist;
  const coverColor = patch.coverColor !== undefined ? patch.coverColor : existing.coverColor;
  const position = patch.position ?? existing.position;
  const listId = patch.listId ?? existing.listId;

  db.prepare(`
    UPDATE trello_cards SET title = ?, description = ?, labels_json = ?, due_at = ?, assignee = ?,
      checklist_json = ?, cover_color = ?, position = ?, list_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    title,
    description ?? null,
    JSON.stringify(labels),
    dueAt ?? null,
    assignee ?? null,
    JSON.stringify(checklist),
    coverColor ?? null,
    position,
    listId,
    Date.now(),
    id,
  );
  return getCard(id);
}

export function moveCard(cardId: string, newListId: string, position: number): TrelloCard | undefined {
  return updateCard(cardId, { listId: newListId, position });
}

export function deleteCard(id: string): boolean {
  const db = getMcDb();
  const result = db.prepare("DELETE FROM trello_cards WHERE id = ?").run(id);
  return result.changes > 0;
}

function rowToCard(row: any): TrelloCard {
  return {
    id: row.id,
    listId: row.list_id,
    boardId: row.board_id,
    title: row.title,
    description: row.description ?? undefined,
    position: row.position,
    labels: parseJsonArray<TrelloLabel>(row.labels_json),
    dueAt: row.due_at ?? undefined,
    assignee: row.assignee ?? undefined,
    checklist: parseJsonArray<TrelloChecklistItem>(row.checklist_json),
    coverColor: row.cover_color ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Comments ─────────────────────────────────────────────────────────────────

export function listComments(cardId: string): TrelloComment[] {
  const db = getMcDb();
  const rows = db
    .prepare("SELECT * FROM trello_comments WHERE card_id = ? ORDER BY created_at ASC")
    .all(cardId) as any[];
  return rows.map(rowToComment);
}

export function addComment(data: { cardId: string; author?: string; text: string }): TrelloComment {
  const db = getMcDb();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO trello_comments (id, card_id, author, text, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, data.cardId, data.author ?? "operator", data.text, Date.now());
  return rowToComment(db.prepare("SELECT * FROM trello_comments WHERE id = ?").get(id) as any);
}

function rowToComment(row: any): TrelloComment {
  return {
    id: row.id,
    cardId: row.card_id,
    author: row.author,
    text: row.text,
    createdAt: row.created_at,
  };
}
