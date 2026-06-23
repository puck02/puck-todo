ALTER TABLE countdowns ADD COLUMN event_type TEXT NOT NULL DEFAULT 'once';
ALTER TABLE countdowns ADD COLUMN repeat_month INTEGER;
ALTER TABLE countdowns ADD COLUMN repeat_day INTEGER;
