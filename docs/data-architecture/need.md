Make consistent across database SQLite files:


#### `database_metadata`

Schema versioning.

| Column | Type | Description |
|--------|------|-------------|
| `schema_version` | INTEGER NOT NULL | Current schema version |
| `created_at` | TEXT NOT NULL | Database creation timestamp |
| `migrated_at` | TEXT | Last migration timestamp |
