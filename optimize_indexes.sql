-- 📊 Performance Optimization - Database Indexes
-- Ejecutar en la base de datos tax_control para mejorar velocidad de consultas
-- Execution time: ~2-5 segundos

-- Índices para documents
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_company_id (company_id);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_created_by (created_by);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_last_edited_by (last_edited_by);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_status (status);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_created_at (created_at DESC);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_authority (authority);

-- Índices para contestations
ALTER TABLE contestations ADD INDEX IF NOT EXISTS idx_document_id (document_id);
ALTER TABLE contestations ADD INDEX IF NOT EXISTS idx_registered_by (registered_by);

-- Índices para activities
ALTER TABLE activities ADD INDEX IF NOT EXISTS idx_document_id (document_id);

-- Índices para document_attachments
ALTER TABLE document_attachments ADD INDEX IF NOT EXISTS idx_document_id (document_id);

-- Índices para contestation_files
ALTER TABLE contestation_files ADD INDEX IF NOT EXISTS idx_contestation_id (contestation_id);

-- Índices para sessions
ALTER TABLE sessions ADD INDEX IF NOT EXISTS idx_user_id (user_id);
ALTER TABLE sessions ADD INDEX IF NOT EXISTS idx_token (token);

-- Índices para users
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_email (email);

COMMIT;
