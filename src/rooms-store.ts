import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { Room } from "./types.js";

function getStorePath(): string {
  const dir = path.join(os.homedir(), ".openclaw", "workspace", "mission-control");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "rooms.json");
}

function readRooms(): Room[] {
  const p = getStorePath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Room[];
  } catch {
    return [];
  }
}

function writeRooms(rooms: Room[]): void {
  fs.writeFileSync(getStorePath(), JSON.stringify(rooms, null, 2), "utf8");
}

export function listRooms(): Room[] {
  return readRooms();
}

export function createRoom(data: { name: string; agentIds?: string[] }): Room {
  const room: Room = {
    id: randomUUID(),
    name: data.name,
    agentIds: data.agentIds ?? [],
    sessionKeys: {},
    createdAt: Date.now(),
  };
  const rooms = readRooms();
  rooms.push(room);
  writeRooms(rooms);
  return room;
}

export function updateRoom(
  id: string,
  patch: Partial<Pick<Room, "name" | "agentIds" | "sessionKeys">>,
): Room | null {
  const rooms = readRooms();
  const idx = rooms.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  rooms[idx] = { ...rooms[idx], ...patch };
  writeRooms(rooms);
  return rooms[idx];
}
