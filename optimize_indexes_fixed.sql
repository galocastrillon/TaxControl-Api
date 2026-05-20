-- 📊 CRITICAL Performance Optimization - Database Indexes (FIXED)
-- Execute in tax_control database to dramatically improve query speed
-- Focus: Indexes for WHERE, ORDER BY, and JOIN clauses - using ONLY EXISTING COLUMNS
-- Expected improvement: 10-100x faster for GET /api/documents

-- ⚡ CRITICAL INDEXES for documents table
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_created_at_desc (created_at DESC);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_status (status);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_company_id (company_id);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_authority (authority);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_due_date (due_date);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_created_by (created_by);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_last_edited_by (last_edited_by);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_notification_date (notification_date);

-- Composite indexes for common filter combinations
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_company_created (company_id, created_at DESC);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_authority_created (authority, created_at DESC);
ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_status_due (status, due_date);

-- ⚡ CRITICAL INDEXES for contestations
ALTER TABLE contestations ADD INDEX IF NOT EXISTS idx_document_id (document_id);
ALTER TABLE contestations ADD INDEX IF NOT EXISTS idx_registered_by (registered_by);
ALTER TABLE contestations ADD INDEX IF NOT EXISTS idx_presentation_date (presentation_date);

-- ⚡ CRITICAL INDEXES for activities (using EXISTING columns only!)
ALTER TABLE activities ADD INDEX IF NOT EXISTS idx_document_id (document_id);
ALTER TABLE activities ADD INDEX IF NOT EXISTS idx_status (status);
ALTER TABLE activities ADD INDEX IF NOT EXISTS idx_due_date (due_date);
ALTER TABLE activities ADD INDEX IF NOT EXISTS idx_completed_by (completed_by);

-- ⚡ CRITICAL INDEXES for document_attachments
ALTER TABLE document_attachments ADD INDEX IF NOT EXISTS idx_document_id (document_id);

-- ⚡ CRITICAL INDEXES for contestation_files
ALTER TABLE contestation_files ADD INDEX IF NOT EXISTS idx_contestation_id (contestation_id);

-- ⚡ CRITICAL INDEXES for sessions
ALTER TABLE sessions ADD INDEX IF NOT EXISTS idx_user_id (user_id);
ALTER TABLE sessions ADD INDEX IF NOT EXISTS idx_token (token);
ALTER TABLE sessions ADD INDEX IF NOT EXISTS idx_expires_at (expires_at);

-- ⚡ CRITICAL INDEXES for users
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_email (email);
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_role (role);

-- ⚡ CRITICAL INDEXES for companies
ALTER TABLE companies ADD INDEX IF NOT EXISTS idx_name (name);

-- ⚡ CRITICAL INDEXES for notifications
ALTER TABLE notifications ADD INDEX IF NOT EXISTS idx_user_sent (user_id, email_sent);
ALTER TABLE notifications ADD INDEX IF NOT EXISTS idx_document (document_id);
ALTER TABLE notifications ADD INDEX IF NOT EXISTS idx_created_at (created_at DESC);

-- ⚡ CRITICAL INDEXES for email_preferences
ALTER TABLE email_preferences ADD INDEX IF NOT EXISTS idx_user_id (user_id);

-- Verify indexes were created
SHOW INDEX FROM documents;

COMMIT;
