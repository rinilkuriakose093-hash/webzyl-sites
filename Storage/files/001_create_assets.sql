-- Migration: 001_create_assets
-- Description: Create assets table and indexes for media storage
-- Created: 2025-01-01

-- Assets table (primary storage record)
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  tenantId TEXT NOT NULL,
  mediaType TEXT NOT NULL,
  objectPath TEXT NOT NULL,
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  contentType TEXT NOT NULL,
  contentHash TEXT,
  status TEXT DEFAULT 'pending',
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deletedAt TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenantId);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_deleted ON assets(deletedAt) WHERE deletedAt IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_tenant_type ON assets(tenantId, mediaType);
CREATE INDEX IF NOT EXISTS idx_assets_tenant_status ON assets(tenantId, status);
CREATE INDEX IF NOT EXISTS idx_assets_cleanup ON assets(deletedAt, status) WHERE deletedAt IS NOT NULL;
