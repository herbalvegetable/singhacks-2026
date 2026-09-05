import "server-only";

import { randomUUID } from "crypto";
import { getDb, withTransaction } from "../db/client";
import { ResourceNotFoundError } from "./access";

type ChatRole = "user" | "assistant";

export interface ConversationHistoryItem {
  role: ChatRole;
  content: string;
}

export async function openConversation(input: {
  conversationId?: string;
  rmId: string;
  clientId: string;
}): Promise<{
  conversationId: string;
  history: ConversationHistoryItem[];
}> {
  const conversationId = input.conversationId ?? randomUUID();
  const now = new Date().toISOString();
  return withTransaction(getDb(), async (client) => {
    if (input.conversationId) {
      const owner = await client.query(
        `SELECT 1 FROM chat_conversations
         WHERE conversation_id = $1 AND rm_id = $2 AND client_id = $3
         FOR SHARE`,
        [conversationId, input.rmId, input.clientId],
      );
      if (owner.rowCount === 0) throw new ResourceNotFoundError();
    } else {
      await client.query(
        `INSERT INTO chat_conversations
         (conversation_id, rm_id, client_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [conversationId, input.rmId, input.clientId, now, now],
      );
    }
    const rows = (
      await client.query<ConversationHistoryItem>(
      `SELECT role, content FROM (
         SELECT role, content, created_at
         FROM chat_messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT 12
       ) recent_messages
       ORDER BY created_at`,
        [conversationId],
      )
    ).rows;
    return { conversationId, history: rows };
  });
}

export async function appendConversationExchange(input: {
  conversationId: string;
  query: string;
  answer: string;
}): Promise<void> {
  const now = Date.now();
  await withTransaction(getDb(), async (client) => {
    await client.query(
      `INSERT INTO chat_messages
       (message_id, conversation_id, role, content, created_at)
       VALUES
         ($1, $2, 'user', $3, $4),
         ($5, $2, 'assistant', $6, $7)`,
      [
        randomUUID(),
        input.conversationId,
        input.query,
        new Date(now).toISOString(),
        randomUUID(),
        input.answer,
        new Date(now + 1).toISOString(),
      ],
    );
    await client.query(
      `UPDATE chat_conversations
       SET updated_at = $1
       WHERE conversation_id = $2`,
      [new Date(now + 1).toISOString(), input.conversationId],
    );
  });
}
