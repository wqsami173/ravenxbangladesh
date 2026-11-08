CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_session_hash TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  visitor_name TEXT,
  visitor_email TEXT,
  status TEXT NOT NULL DEFAULT 'ADMIN_REQUESTED'
    CHECK (status IN ('AI_ACTIVE', 'ADMIN_REQUESTED', 'ADMIN_ACCEPTED', 'CLOSED')),
  requested_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_conversation_owner_idx
  ON chat_conversations (owner_session_hash, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversation_user_idx
  ON chat_conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversation_status_idx
  ON chat_conversations (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('VISITOR', 'AI', 'ADMIN', 'SYSTEM')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  feedback TEXT CHECK (feedback IN ('HELPFUL', 'NOT_HELPFUL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_message_conversation_idx
  ON chat_messages (conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS chat_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL CHECK (length(question) BETWEEN 3 AND 1000),
  answer TEXT NOT NULL CHECK (length(answer) BETWEEN 3 AND 3000),
  source_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  approved_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_knowledge_active_idx
  ON chat_knowledge (is_active, updated_at DESC);
