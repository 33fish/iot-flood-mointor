-- ============================================================
-- Smart Flood Sentinel — Supabase Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add new columns to readings table
ALTER TABLE readings
  ADD COLUMN IF NOT EXISTS state         TEXT,      -- 'safe' | 'warning' | 'critical' | 'sensor_error'
  ADD COLUMN IF NOT EXISTS rising        BOOLEAN DEFAULT FALSE;

-- 2. Create config table (single-row, id = 1)
CREATE TABLE IF NOT EXISTS config (
  id                      INT PRIMARY KEY DEFAULT 1,
  level_warn              FLOAT   DEFAULT 1.0,    -- cm: yellow alert threshold
  level_critical          FLOAT   DEFAULT 5.0,    -- cm: red alert threshold
  install_height          FLOAT   DEFAULT 50.0,   -- cm: written by ESP32 on boot self-test
  sensor_error_threshold  INT     DEFAULT 3,      -- consecutive failures before sensor_error
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one config row ever exists
INSERT INTO config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- 3. Trigger: auto-update updated_at on config changes
CREATE OR REPLACE FUNCTION update_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS config_updated_at ON config;
CREATE TRIGGER config_updated_at
  BEFORE UPDATE ON config
  FOR EACH ROW EXECUTE FUNCTION update_config_timestamp();

-- 4. Enable RLS on config (allow anon read, anon write)
ALTER TABLE config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_config"  ON config;
DROP POLICY IF EXISTS "anon_write_config" ON config;

CREATE POLICY "anon_read_config"
  ON config FOR SELECT USING (true);

CREATE POLICY "anon_write_config"
  ON config FOR UPDATE USING (true) WITH CHECK (true);

-- Done. Verify:
-- SELECT * FROM config;
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'readings';
