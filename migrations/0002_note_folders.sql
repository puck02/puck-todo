ALTER TABLE notes ADD COLUMN type TEXT NOT NULL DEFAULT 'file';
ALTER TABLE notes ADD COLUMN parent_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_notes_parent_type ON notes(parent_id, type, updated_at DESC);
