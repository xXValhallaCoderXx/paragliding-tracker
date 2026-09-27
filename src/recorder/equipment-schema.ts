export const EQUIPMENT_SCHEMA_SQL = `
  CREATE TABLE equipment_settings (
    id INTEGER PRIMARY KEY CHECK(id=1), active_owner TEXT NOT NULL
  );
  INSERT INTO equipment_settings(id,active_owner) SELECT 1,COALESCE(user_id,'guest') FROM cloud_link WHERE id=1;
  CREATE TABLE equipment_entities (
    owner_key TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('aircraft', 'sport', 'selection')),
    entity_id TEXT NOT NULL,
    value_json TEXT NOT NULL,
    local_generation INTEGER NOT NULL CHECK(local_generation >= 0),
    server_revision INTEGER NOT NULL DEFAULT 0 CHECK(server_revision >= 0),
    operation_id TEXT,
    conflict_json TEXT,
    last_error TEXT,
    PRIMARY KEY(owner_key, kind, entity_id)
  );
  CREATE INDEX equipment_pending_owner ON equipment_entities(owner_key, operation_id);
  ALTER TABLE flights ADD COLUMN equipment_snapshot_json TEXT;
`;
export const EQUIPMENT_COLUMNS = {
  equipment_settings: ['id', 'active_owner'],
  equipment_entities: ['owner_key', 'kind', 'entity_id', 'value_json', 'local_generation', 'server_revision', 'operation_id', 'conflict_json', 'last_error'],
  flights: ['equipment_snapshot_json'],
} as const;
export const EQUIPMENT_INDEXES = ['equipment_pending_owner'] as const;
