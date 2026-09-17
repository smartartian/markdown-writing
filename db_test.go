package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDocumentRevisionsAndRestore(t *testing.T) {
	db, err := NewDB(t.TempDir())
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()

	id, err := db.CreateDoc("note.md", "version one")
	if err != nil {
		t.Fatalf("CreateDoc: %v", err)
	}
	revision, err := db.UpdateDoc(id, "note.md", "version two", 1)
	if err != nil {
		t.Fatalf("UpdateDoc: %v", err)
	}
	if revision != 2 {
		t.Fatalf("revision = %d; want 2", revision)
	}
	if _, err := db.UpdateDoc(id, "note.md", "stale write", 1); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale update error = %v; want revision conflict", err)
	}

	versions, err := db.ListDocVersions(id, 10)
	if err != nil {
		t.Fatalf("ListDocVersions: %v", err)
	}
	if len(versions) != 2 {
		t.Fatalf("version count = %d; want 2", len(versions))
	}

	restoredRevision, err := db.RestoreDocVersion(id, versions[1].ID, revision)
	if err != nil {
		t.Fatalf("RestoreDocVersion: %v", err)
	}
	_, content, currentRevision, err := db.ReadDoc(id)
	if err != nil {
		t.Fatalf("ReadDoc: %v", err)
	}
	if content != "version one" || currentRevision != restoredRevision {
		t.Fatalf("restored content/revision = %q/%d; want version one/%d", content, currentRevision, restoredRevision)
	}
}

func TestFileRevisionConflict(t *testing.T) {
	db, err := NewDB(t.TempDir())
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()

	first := FileRevision{Revision: 1, ContentHash: contentHash("one")}
	if _, err := db.EnsureFileRevision("/tmp/note.md", first.ContentHash, "one"); err != nil {
		t.Fatalf("EnsureFileRevision: %v", err)
	}
	if _, err := db.CommitFileRevision("/tmp/note.md", contentHash("two"), "two", 1, first.ContentHash); err != nil {
		t.Fatalf("CommitFileRevision: %v", err)
	}
	if _, err := db.CommitFileRevision(
		"/tmp/note.md",
		contentHash("stale"),
		"stale",
		1,
		first.ContentHash,
	); !errors.Is(err, ErrRevisionConflict) {
		t.Fatalf("stale file commit error = %v; want revision conflict", err)
	}
}

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
