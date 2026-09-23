package main

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRecycleBinRestore(t *testing.T) {
	configDir := t.TempDir()
	docDir := t.TempDir()
	db, err := NewDB(configDir)
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()

	app := &App{
		configDir: configDir,
		db:        db,
		allowed:   make(map[string]struct{}),
	}
	app.setDocumentRoot(docDir)
	path := filepath.Join(docDir, "note.md")
	if err := os.WriteFile(path, []byte("content"), 0644); err != nil {
		t.Fatalf("write source file: %v", err)
	}

	if err := app.DeleteDocument(path); err != nil {
		t.Fatalf("DeleteDocument: %v", err)
	}
	items, err := app.ListRecycleBin(10)
	if err != nil {
		t.Fatalf("ListRecycleBin: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("recycle item count = %d; want 1", len(items))
	}
	if err := app.RestoreRecycleItem(items[0].ID); err != nil {
		t.Fatalf("RestoreRecycleItem: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("restored file read: %v", err)
	}
	if string(data) != "content" {
		t.Fatalf("restored content = %q; want content", data)
	}
}

func TestMigrateDropsRetiredTables(t *testing.T) {
	dir := t.TempDir()
	db, err := NewDB(dir)
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()

	// 模拟旧版本遗留的表与数据
	seeds := []string{
		`CREATE TABLE IF NOT EXISTS file_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, revision INTEGER NOT NULL,
			content TEXT NOT NULL, content_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(path, revision))`,
		`CREATE TABLE IF NOT EXISTS document_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, revision INTEGER NOT NULL,
			name TEXT NOT NULL, content TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(document_id, revision))`,
		`CREATE TABLE IF NOT EXISTS file_revisions (
			path TEXT PRIMARY KEY, revision INTEGER NOT NULL, content_hash TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
		`CREATE TABLE IF NOT EXISTS documents (
			id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			revision INTEGER NOT NULL DEFAULT 1, deleted_at DATETIME)`,
	}
	for _, seed := range seeds {
		if _, err := db.conn.Exec(seed); err != nil {
			t.Fatalf("seed legacy table: %v", err)
		}
	}
	if _, err := db.conn.Exec("DELETE FROM schema_migrations WHERE version IN (3, 4)"); err != nil {
		t.Fatalf("reset migrations: %v", err)
	}
	if err := db.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, table := range []string{"file_versions", "document_versions", "file_revisions", "documents"} {
		var name string
		if err := db.conn.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", table).Scan(&name); !errors.Is(err, sql.ErrNoRows) {
			t.Fatalf("retired table %s still present (err=%v)", table, err)
		}
	}
}
