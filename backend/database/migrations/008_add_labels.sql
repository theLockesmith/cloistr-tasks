-- 008_add_labels.sql
-- User-scoped labels (tags) for task templates.
-- Each user owns their own label palette; labels attach to templates via a
-- junction table so one template can carry multiple labels.

CREATE TABLE IF NOT EXISTS labels (
  id         SERIAL PRIMARY KEY,
  user_id    VARCHAR(100) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       VARCHAR(50)  NOT NULL,
  color      VARCHAR(7)   DEFAULT '#6366f1',
  created_at TIMESTAMP    DEFAULT NOW(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_labels_user ON labels(user_id);

CREATE TABLE IF NOT EXISTS task_template_labels (
  template_id INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  label_id    INTEGER NOT NULL REFERENCES labels(id)          ON DELETE CASCADE,
  PRIMARY KEY (template_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_template_labels_template ON task_template_labels(template_id);
CREATE INDEX IF NOT EXISTS idx_template_labels_label    ON task_template_labels(label_id);

COMMENT ON TABLE labels IS 'User-defined colour-tagged labels for tasks';
COMMENT ON TABLE task_template_labels IS 'Many-to-many join between task templates and labels';
