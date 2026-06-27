CREATE INDEX IF NOT EXISTS idx_todos_status_due_at ON todos(status, due_at, created_at);
CREATE INDEX IF NOT EXISTS idx_notes_parent_type_updated_created ON notes(parent_id, type, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_countdowns_target_date_created ON countdowns(target_date, created_at);
