import "server-only";

import { randomUUID } from "crypto";
import { getDb } from "../db/client";
import { ResourceNotFoundError } from "./access";

type ChatRole = "user" | "assistant";

export interface ConversationHistoryItem {
  role: ChatRole;
  content: string;
}

function ensureTables(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      conversation_id TEXT PRIMARY KEY,
      rm_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES chat_conversations(conversation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
      ON chat_messages(conversation_id, created_at);
  `);
}

export function openConversation(input: {
  conversationId?: string;
  rmId: string;
  clientId: string;
}): { conversationId: string; history: ConversationHistoryItem[] } {
  ensureTables();
  const conversationId = input.conversationId ?? randomUUID();
  const now = new Date().toISOString();
  if (input.conversationId) {
    const owner = getDb()
      .prepare(
        `SELECT 1 FROM chat_conversations
         WHERE conversation_id = ? AND rm_id = ? AND client_id = ?`,
      )
      .get(conversationId, input.rmId, input.clientId);
    if (!owner) throw new ResourceNotFoundError();
  } else {
    getDb()
      .prepare(
        `INSERT INTO chat_conversations
         (conversation_id, rm_id, client_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(conversationId, input.rmId, input.clientId, now, now);
  }
  const rows = getDb()
    .prepare(
      `SELECT role, content FROM (
         SELECT role, content, created_at
         FROM chat_messages
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT 12
       ) ORDER BY created_at`,
    )
    .all(conversationId) as ConversationHistoryItem[];
  return { conversationId, history: rows };
}

export function appendConversationExchange(input: {
  conversationId: string;
  query: string;
  answer: string;
}): void {
  ensureTables();
  const db = getDb();
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO chat_messages
     (message_id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const append = db.transaction(() => {
    insert.run(
      randomUUID(),
      input.conversationId,
      "user",
      input.query,
      new Date(now).toISOString(),
    );
    insert.run(
      randomUUID(),
      input.conversationId,
      "assistant",
      input.answer,
      new Date(now + 1).toISOString(),
    );
    db.prepare(
      "UPDATE chat_conversations SET updated_at = ? WHERE conversation_id = ?",
    ).run(new Date(now + 1).toISOString(), input.conversationId);
  });
  append.immediate();
}
