-- Meshtastic mesh network tables for BDOC
-- Run in Supabase SQL Editor: Database → SQL Editor → New Query

-- Mesh nodes (latest state)
CREATE TABLE IF NOT EXISTS mesh_nodes (
  node_id TEXT PRIMARY KEY,
  long_name TEXT,
  short_name TEXT,
  hw_model TEXT,
  latitude FLOAT,
  longitude FLOAT,
  altitude INT DEFAULT 0,
  battery_level INT DEFAULT 0,
  rssi INT DEFAULT 0,
  snr FLOAT DEFAULT 0,
  last_heard TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mesh message history
CREATE TABLE IF NOT EXISTS mesh_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  text TEXT NOT NULL,
  hop_limit INT DEFAULT 0,
  rssi INT DEFAULT 0,
  snr FLOAT DEFAULT 0,
  received_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mesh position trail (history)
CREATE TABLE IF NOT EXISTS mesh_trail (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  latitude FLOAT NOT NULL,
  longitude FLOAT NOT NULL,
  altitude INT DEFAULT 0,
  rssi INT DEFAULT 0,
  recorded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mesh telemetry history
CREATE TABLE IF NOT EXISTS mesh_telemetry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id TEXT NOT NULL,
  battery_level INT DEFAULT 0,
  voltage FLOAT DEFAULT 0,
  channel_utilization FLOAT DEFAULT 0,
  air_util_tx FLOAT DEFAULT 0,
  recorded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mesh_nodes_last_heard ON mesh_nodes(last_heard DESC);
CREATE INDEX IF NOT EXISTS idx_mesh_messages_sender ON mesh_messages(sender);
CREATE INDEX IF NOT EXISTS idx_mesh_messages_received ON mesh_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mesh_trail_node ON mesh_trail(node_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_mesh_telemetry_node ON mesh_telemetry(node_id, recorded_at DESC);

-- RLS Policies (public read, authenticated write)
ALTER TABLE mesh_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Mesh nodes public read" ON mesh_nodes FOR SELECT USING (true);
CREATE POLICY "Mesh nodes authenticated write" ON mesh_nodes FOR ALL USING (auth.role() = 'authenticated');

ALTER TABLE mesh_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Mesh messages public read" ON mesh_messages FOR SELECT USING (true);
CREATE POLICY "Mesh messages authenticated insert" ON mesh_messages FOR INSERT WITH CHECK (auth.role() = 'authenticated');

ALTER TABLE mesh_trail ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Mesh trail public read" ON mesh_trail FOR SELECT USING (true);
CREATE POLICY "Mesh trail authenticated insert" ON mesh_trail FOR INSERT WITH CHECK (auth.role() = 'authenticated');

ALTER TABLE mesh_telemetry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Mesh telemetry public read" ON mesh_telemetry FOR SELECT USING (true);
CREATE POLICY "Mesh telemetry authenticated insert" ON mesh_telemetry FOR INSERT WITH CHECK (auth.role() = 'authenticated');
