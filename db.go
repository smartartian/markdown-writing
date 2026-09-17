package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

const maxStoredVersions = 50

var ErrRevisionConflict = errors.New("revision conflict")

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
		CREATE TABLE IF NOT EXISTS documents (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			name       TEXT NOT NULL,
			content    TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);
		CREATE INDEX IF NOT EXISTS idx_docs_updated ON documents(updated_at DESC);
	`)
	return err
}

func migrateV2(tx *sql.Tx) error {
	_, err := tx.Exec(`
		ALTER TABLE documents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
		ALTER TABLE documents ADD COLUMN deleted_at DATETIME;

		CREATE TABLE IF NOT EXISTS document_versions (
			id          INTEGER PRIMARY KEY AUTOINCREMENT,
			document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
			revision    INTEGER NOT NULL,
			name        TEXT NOT NULL,
			content     TEXT NOT NULL,
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(document_id, revision)
		);
		CREATE INDEX IF NOT EXISTS idx_document_versions_doc
			ON document_versions(document_id, revision DESC);

		CREATE TABLE IF NOT EXISTS file_revisions (
			path         TEXT PRIMARY KEY,
			revision     INTEGER NOT NULL,
			content_hash TEXT NOT NULL,
			updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS file_versions (
			id             INTEGER PRIMARY KEY AUTOINCREMENT,
			path           TEXT NOT NULL,
			revision       INTEGER NOT NULL,
			content        TEXT NOT NULL,
			content_hash   TEXT NOT NULL,
			created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(path, revision)
		);
		CREATE INDEX IF NOT EXISTS idx_file_versions_path
			ON file_versions(path, revision DESC);

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

// ---- Database Documents ----

type DBDocument struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Content   string `json:"-"`
	Size      int64  `json:"size"`
	ModTime   string `json:"modTime"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	Revision  int64  `json:"revision"`
}

type DocumentVersion struct {
	ID         int64  `json:"id"`
	DocumentID int64  `json:"documentId"`
	Revision   int64  `json:"revision"`
	Name       string `json:"name"`
	Content    string `json:"content"`
	Size       int64  `json:"size"`
	CreatedAt  string `json:"createdAt"`
}

func (d *DB) CreateDoc(name, content string) (int64, error) {
	tx, err := d.conn.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(
		"INSERT INTO documents(name, content, revision, created_at, updated_at) VALUES(?,?,1,datetime('now'),datetime('now'))",
		name, content,
	)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		"INSERT INTO document_versions(document_id, revision, name, content) VALUES(?,1,?,?)",
		id, name, content,
	); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

func (d *DB) ReadDoc(id int64) (string, string, int64, error) {
	var name, content string
	var revision int64
	err := d.conn.QueryRow(
		"SELECT name, content, revision FROM documents WHERE id = ? AND deleted_at IS NULL",
		id,
	).Scan(&name, &content, &revision)
	return name, content, revision, err
}

func (d *DB) UpdateDoc(id int64, name, content string, expectedRevision int64) (int64, error) {
	tx, err := d.conn.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var currentRevision int64
	var currentContent string
	if err := tx.QueryRow(
		"SELECT revision, content FROM documents WHERE id = ? AND deleted_at IS NULL",
		id,
	).Scan(&currentRevision, &currentContent); err != nil {
		return 0, err
	}
	if expectedRevision > 0 && currentRevision != expectedRevision {
		return 0, ErrRevisionConflict
	}
	if currentContent == content {
		if _, err := tx.Exec("UPDATE documents SET name = ? WHERE id = ?", name, id); err != nil {
			return 0, err
		}
		return currentRevision, tx.Commit()
	}

	nextRevision := currentRevision + 1
	if _, err := tx.Exec(
		"UPDATE documents SET name=?, content=?, revision=?, updated_at=datetime('now') WHERE id=?",
		name, content, nextRevision, id,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		"INSERT INTO document_versions(document_id, revision, name, content) VALUES(?,?,?,?)",
		id, nextRevision, name, content,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`
		DELETE FROM document_versions
		WHERE document_id = ?
		  AND id NOT IN (
			SELECT id FROM document_versions
			WHERE document_id = ?
			ORDER BY revision DESC
			LIMIT ?
		  )
	`, id, id, maxStoredVersions); err != nil {
		return 0, err
	}
	return nextRevision, tx.Commit()
}

func (d *DB) DeleteDoc(id int64) error {
	_, err := d.conn.Exec("UPDATE documents SET deleted_at=datetime('now') WHERE id = ?", id)
	return err
}

func (d *DB) RestoreDoc(id int64) error {
	_, err := d.conn.Exec("UPDATE documents SET deleted_at=NULL WHERE id = ?", id)
	return err
}

func (d *DB) PurgeDoc(id int64) error {
	_, err := d.conn.Exec("DELETE FROM documents WHERE id = ? AND deleted_at IS NOT NULL", id)
	return err
}

func (d *DB) ListDeletedDocs(limit int) ([]DBDocument, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := d.conn.Query(`
		SELECT id, name, length(content), deleted_at
		FROM documents
		WHERE deleted_at IS NOT NULL
		ORDER BY deleted_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var docs []DBDocument
	for rows.Next() {
		var doc DBDocument
		if err := rows.Scan(&doc.ID, &doc.Name, &doc.Size, &doc.UpdatedAt); err != nil {
			return nil, err
		}
		doc.ModTime = doc.UpdatedAt
		docs = append(docs, doc)
	}
	return docs, rows.Err()
}

func (d *DB) ListDocs() ([]DBDocument, error) {
	rows, err := d.conn.Query(
		"SELECT id, name, length(content), updated_at, revision FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var docs []DBDocument
	for rows.Next() {
		var doc DBDocument
		if err := rows.Scan(&doc.ID, &doc.Name, &doc.Size, &doc.UpdatedAt, &doc.Revision); err != nil {
			return nil, err
		}
		doc.ModTime = doc.UpdatedAt
		docs = append(docs, doc)
	}
	return docs, rows.Err()
}

func (d *DB) ListDocVersions(documentID int64, limit int) ([]DocumentVersion, error) {
	if limit <= 0 || limit > maxStoredVersions {
		limit = maxStoredVersions
	}
	rows, err := d.conn.Query(`
		SELECT id, document_id, revision, name, content, length(content), created_at
		FROM document_versions
		WHERE document_id = ?
		ORDER BY revision DESC
		LIMIT ?
	`, documentID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var versions []DocumentVersion
	for rows.Next() {
		var version DocumentVersion
		if err := rows.Scan(
			&version.ID,
			&version.DocumentID,
			&version.Revision,
			&version.Name,
			&version.Content,
			&version.Size,
			&version.CreatedAt,
		); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
}

func (d *DB) RestoreDocVersion(documentID, versionID, expectedRevision int64) (int64, error) {
	var name, content string
	if err := d.conn.QueryRow(
		"SELECT name, content FROM document_versions WHERE id = ? AND document_id = ?",
		versionID, documentID,
	).Scan(&name, &content); err != nil {
		return 0, err
	}
	return d.UpdateDoc(documentID, name, content, expectedRevision)
}

// ---- File Revisions ----

type FileRevision struct {
	Path        string `json:"path"`
	Revision    int64  `json:"revision"`
	ContentHash string `json:"contentHash"`
	UpdatedAt   string `json:"updatedAt"`
}

type FileVersion struct {
	ID          int64  `json:"id"`
	Path        string `json:"path"`
	Revision    int64  `json:"revision"`
	Content     string `json:"content"`
	ContentHash string `json:"contentHash"`
	Size        int64  `json:"size"`
	CreatedAt   string `json:"createdAt"`
}

func (d *DB) EnsureFileRevision(path, contentHash, content string) (FileRevision, error) {
	tx, err := d.conn.Begin()
	if err != nil {
		return FileRevision{}, err
	}
	defer tx.Rollback()

	var revision FileRevision
	err = tx.QueryRow(
		"SELECT path, revision, content_hash, updated_at FROM file_revisions WHERE path = ?",
		path,
	).Scan(&revision.Path, &revision.Revision, &revision.ContentHash, &revision.UpdatedAt)
	if err == nil {
		return revision, tx.Commit()
	}
	if err != sql.ErrNoRows {
		return FileRevision{}, err
	}

	revision = FileRevision{
		Path:        path,
		Revision:    1,
		ContentHash: contentHash,
	}
	if _, err := tx.Exec(
		"INSERT INTO file_revisions(path, revision, content_hash, updated_at) VALUES(?,?,?,datetime('now'))",
		path, revision.Revision, contentHash,
	); err != nil {
		return FileRevision{}, err
	}
	if _, err := tx.Exec(
		"INSERT INTO file_versions(path, revision, content, content_hash) VALUES(?,?,?,?)",
		path, revision.Revision, content, contentHash,
	); err != nil {
		return FileRevision{}, err
	}
	if err := tx.QueryRow(
		"SELECT updated_at FROM file_revisions WHERE path = ?", path,
	).Scan(&revision.UpdatedAt); err != nil {
		return FileRevision{}, err
	}
	return revision, tx.Commit()
}

func (d *DB) CommitFileRevision(path, contentHash, content string, expectedRevision int64, expectedHash string) (int64, error) {
	tx, err := d.conn.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	var currentRevision int64
	var currentHash string
	if err := tx.QueryRow(
		"SELECT revision, content_hash FROM file_revisions WHERE path = ?",
		path,
	).Scan(&currentRevision, &currentHash); err != nil {
		return 0, err
	}
	if expectedRevision != currentRevision || expectedHash != currentHash {
		return 0, ErrRevisionConflict
	}
	if contentHash == currentHash {
		return currentRevision, tx.Commit()
	}

	nextRevision := currentRevision + 1
	if _, err := tx.Exec(
		"UPDATE file_revisions SET revision=?, content_hash=?, updated_at=datetime('now') WHERE path=?",
		nextRevision, contentHash, path,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		"INSERT INTO file_versions(path, revision, content, content_hash) VALUES(?,?,?,?)",
		path, nextRevision, content, contentHash,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`
		DELETE FROM file_versions
		WHERE path = ?
		  AND id NOT IN (
			SELECT id FROM file_versions
			WHERE path = ?
			ORDER BY revision DESC
			LIMIT ?
		  )
	`, path, path, maxStoredVersions); err != nil {
		return 0, err
	}
	return nextRevision, tx.Commit()
}

func (d *DB) ListFileVersions(path string, limit int) ([]FileVersion, error) {
	if limit <= 0 || limit > maxStoredVersions {
		limit = maxStoredVersions
	}
	rows, err := d.conn.Query(`
		SELECT id, path, revision, content, content_hash, length(content), created_at
		FROM file_versions
		WHERE path = ?
		ORDER BY revision DESC
		LIMIT ?
	`, path, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var versions []FileVersion
	for rows.Next() {
		var version FileVersion
		if err := rows.Scan(
			&version.ID,
			&version.Path,
			&version.Revision,
			&version.Content,
			&version.ContentHash,
			&version.Size,
			&version.CreatedAt,
		); err != nil {
			return nil, err
		}
		versions = append(versions, version)
	}
	return versions, rows.Err()
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
