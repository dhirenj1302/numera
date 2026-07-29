PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS homeworks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  year_group TEXT NOT NULL DEFAULT 'Year 4',
  topic TEXT NOT NULL DEFAULT 'Mixed maths',
  questions_json TEXT NOT NULL,
  settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  homework_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  original_score INTEGER NOT NULL,
  mastery_score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  attempts_json TEXT NOT NULL,
  strengths_json TEXT NOT NULL,
  needs_practice_json TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (homework_id) REFERENCES homeworks(id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_homework
ON submissions(homework_id);

CREATE INDEX IF NOT EXISTS idx_submissions_student
ON submissions(student_name);
