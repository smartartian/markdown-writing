package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

type DB struct {
	conn *sql.DB
}

type migration struct {
	version int
	apply   func(*sql.Tx) error
}

// NewDB opens or creates the SQLite database in the config directory
func NewDB(configDir string) (*DB, error) {
	os.MkdirAll(configDir, 0755)
	dbPath := filepath.Join(configDir, "markdown-writing.db")
	conn, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	conn.SetMaxOpenConns(1)
	d := &DB{conn: conn}
	if err := d.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

func (d *DB) migrate() error {
	if _, err := d.conn.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return err
	}

	var current int
	if err := d.conn.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&current); err != nil {
		return err
	}

	migrations := []migration{
		{version: 1, apply: migrateV1},
		{version: 2, apply: migrateV2},
		{version: 3, apply: migrateV3},
		{version: 4, apply: migrateV4},
	}
	for _, item := range migrations {
		if item.version <= current {
			continue
		}
		tx, err := d.conn.Begin()
		if err != nil {
			return err
		}
		if err := item.apply(tx); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", item.version, err)
		}
		if _, err := tx.Exec("INSERT INTO schema_migrations(version) VALUES(?)", item.version); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func migrateV1(tx *sql.Tx) error {
	_, err := tx.Exec(`
		CREATE TABLE IF NOT EXISTS app_state (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS recent_files (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			path       TEXT NOT NULL UNIQUE,
			name       TEXT NOT NULL,
			opened_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_recent_opened ON recent_files(opened_at DESC);
	`)
	return err
}

func migrateV2(tx *sql.Tx) error {
	_, err := tx.Exec(`
		CREATE TABLE IF NOT EXISTS recycle_bin (
			id            INTEGER PRIMARY KEY AUTOINCREMENT,
			original_path TEXT NOT NULL,
			stored_path   TEXT NOT NULL UNIQUE,
			name          TEXT NOT NULL,
			deleted_at    DATETIME DEFAULT CURRENT_TIMESTAMP
		);
	`)
	return err
}

// migrateV3 drops the snapshot tables that backed the retired version-history feature.
func migrateV3(tx *sql.Tx) error {
	_, err := tx.Exec(`
		DROP TABLE IF EXISTS file_versions;
		DROP TABLE IF EXISTS document_versions;
	`)
	return err
}

// migrateV4 drops the tables that backed the retired revision-conflict checks
// and the retired in-database document library.
func migrateV4(tx *sql.Tx) error {
	_, err := tx.Exec(`
		DROP TABLE IF EXISTS file_revisions;
		DROP TABLE IF EXISTS documents;
	`)
	return err
}

// ---- App State ----

func (d *DB) GetState(key string) (string, error) {
	var val string
	err := d.conn.QueryRow("SELECT value FROM app_state WHERE key = ?", key).Scan(&val)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return val, err
}

func (d *DB) SetState(key, value string) error {
	_, err := d.conn.Exec(
		"INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		key, value,
	)
	return err
}

func (d *DB) DeleteState(key string) error {
	_, err := d.conn.Exec("DELETE FROM app_state WHERE key = ?", key)
	return err
}

// ---- Settings ----

func (d *DB) GetSetting(key string) (string, error) {
	var val string
	err := d.conn.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&val)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return val, err
}

func (d *DB) SetSetting(key, value string) error {
	_, err := d.conn.Exec(
		"INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
		key, value,
	)
	return err
}

func (d *DB) GetAllSettings() (map[string]string, error) {
	rows, err := d.conn.Query("SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		result[key] = value
	}
	return result, nil
}

// ---- Recent Files ----

func (d *DB) AddRecentFile(path, name string) error {
	_, err := d.conn.Exec(
		`INSERT INTO recent_files(path,name,opened_at) VALUES(?,?,datetime('now'))
		 ON CONFLICT(path) DO UPDATE SET opened_at=datetime('now')`,
		path, name,
	)
	return err
}

func (d *DB) ListRecentFiles(limit int) ([]Document, error) {
	if limit <= 0 {
		limit = 20
	}
	rows, err := d.conn.Query(
		"SELECT path, name FROM recent_files ORDER BY opened_at DESC LIMIT ?", limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var docs []Document
	for rows.Next() {
		var path, name string
		if err := rows.Scan(&path, &name); err != nil {
			return nil, err
		}
		info, err := os.Stat(path)
		var size int64
		var modTime string
		if err == nil {
			size = info.Size()
			modTime = info.ModTime().Format("2006-01-02 15:04")
		}
		docs = append(docs, Document{
			Name:    name,
			Path:    path,
			Size:    size,
			ModTime: modTime,
		})
	}
	return docs, rows.Err()
}

type RecycleItem struct {
	ID           int64  `json:"id"`
	OriginalPath string `json:"originalPath"`
	StoredPath   string `json:"storedPath"`
	Name         string `json:"name"`
	DeletedAt    string `json:"deletedAt"`
}

func (d *DB) AddRecycleItem(originalPath, storedPath, name string) (int64, error) {
	result, err := d.conn.Exec(
		"INSERT INTO recycle_bin(original_path, stored_path, name) VALUES(?,?,?)",
		originalPath, storedPath, name,
	)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func (d *DB) ListRecycleBin(limit int) ([]RecycleItem, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := d.conn.Query(`
		SELECT id, original_path, stored_path, name, deleted_at
		FROM recycle_bin
		ORDER BY deleted_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []RecycleItem
	for rows.Next() {
		var item RecycleItem
		if err := rows.Scan(
			&item.ID,
			&item.OriginalPath,
			&item.StoredPath,
			&item.Name,
			&item.DeletedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (d *DB) GetRecycleItem(id int64) (RecycleItem, error) {
	var item RecycleItem
	err := d.conn.QueryRow(`
		SELECT id, original_path, stored_path, name, deleted_at
		FROM recycle_bin WHERE id = ?
	`, id).Scan(&item.ID, &item.OriginalPath, &item.StoredPath, &item.Name, &item.DeletedAt)
	return item, err
}

func (d *DB) RemoveRecycleItem(id int64) error {
	_, err := d.conn.Exec("DELETE FROM recycle_bin WHERE id = ?", id)
	return err
}

func (d *DB) Close() error {
	return d.conn.Close()
}
