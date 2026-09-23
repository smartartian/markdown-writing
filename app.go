package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx       context.Context
	configDir string
	db        *DB
	mu        sync.RWMutex
	docDir    string
	allowed   map[string]struct{}
	closeMu   sync.Mutex
	pending   int
	pendingID string
}

type Document struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Size     int64      `json:"size"`
	ModTime  string     `json:"modTime"`
	IsDir    bool       `json:"isDir"`
	Children []Document `json:"children,omitempty"`
}

type AppState struct {
	DocumentDir string   `json:"documentDir"`
	OpenDocs    []string `json:"openDocs"`
}

func NewApp() *App {
	configDir, _ := os.UserConfigDir()
	configDir = filepath.Join(configDir, "md-editor-desktop")
	os.MkdirAll(configDir, 0755)
	db, err := NewDB(configDir)
	if err != nil {
		println("DB init error:", err.Error())
	}
	return &App{
		configDir: configDir,
		db:        db,
		allowed:   make(map[string]struct{}),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.db == nil {
		return
	}
	if dir, err := a.db.GetState("documentDir"); err == nil && dir != "" {
		a.setDocumentRoot(dir)
	}
	if recent, err := a.db.ListRecentFiles(200); err == nil {
		for _, doc := range recent {
			a.allowFile(doc.Path)
		}
	}
}

func (a *App) shutdown(ctx context.Context) {
	if a.db != nil {
		a.db.Close()
	}
}

func canonicalPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return filepath.Clean(resolved), nil
	}
	parent := filepath.Dir(abs)
	if resolvedParent, err := filepath.EvalSymlinks(parent); err == nil {
		return filepath.Clean(filepath.Join(resolvedParent, filepath.Base(abs))), nil
	}
	return filepath.Clean(abs), nil
}

func pathWithin(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func (a *App) setDocumentRoot(dir string) {
	if dir == "" {
		return
	}
	root, err := canonicalPath(dir)
	if err != nil {
		return
	}
	a.mu.Lock()
	a.docDir = root
	a.mu.Unlock()
}

func (a *App) allowFile(path string) {
	if path == "" {
		return
	}
	canonical, err := canonicalPath(path)
	if err != nil {
		return
	}
	a.mu.Lock()
	a.allowed[canonical] = struct{}{}
	a.mu.Unlock()
}

func (a *App) pathAllowed(path string) bool {
	if path == "" {
		return false
	}
	canonical, err := canonicalPath(path)
	if err != nil {
		return false
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	if _, ok := a.allowed[canonical]; ok {
		return true
	}
	return a.docDir != "" && pathWithin(a.docDir, canonical)
}

func (a *App) requireAllowedPath(path string) error {
	if !a.pathAllowed(path) {
		return fmt.Errorf("path is outside the authorized document scope")
	}
	return nil
}

func safeDocumentName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("invalid document name")
	}
	return name, nil
}

func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// SelectDocumentDir opens a folder picker dialog and saves the selection
func (a *App) SelectDocumentDir() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择文档目录",
	})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", fmt.Errorf("canceled")
	}
	a.setDocumentRoot(dir)
	a.saveState(AppState{DocumentDir: dir})
	return dir, nil
}

// OpenDocumentFile opens a single file picker and returns its path
func (a *App) OpenDocumentFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "打开 Markdown 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md)", Pattern: "*.md;*.markdown"},
			{DisplayName: "文本文件 (*.txt)", Pattern: "*.txt"},
			{DisplayName: "所有文件 (*)", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", fmt.Errorf("canceled")
	}
	canonical, err := canonicalPath(path)
	if err != nil {
		return "", err
	}
	a.setDocumentRoot(filepath.Dir(canonical))
	a.allowFile(canonical)
	a.saveState(AppState{DocumentDir: filepath.Dir(canonical)})
	return canonical, nil
}

// AcceptDroppedDocument registers a dragged Markdown file and returns its document metadata.
func (a *App) AcceptDroppedDocument(path string) (Document, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".md" && ext != ".markdown" {
		return Document{}, fmt.Errorf("only Markdown files can be opened")
	}
	info, err := os.Stat(path)
	if err != nil {
		return Document{}, err
	}
	if info.IsDir() {
		return Document{}, fmt.Errorf("expected a Markdown file")
	}
	canonical, err := canonicalPath(path)
	if err != nil {
		return Document{}, err
	}
	dir := filepath.Dir(canonical)
	a.setDocumentRoot(dir)
	a.allowFile(canonical)
	a.saveState(AppState{DocumentDir: dir})
	return Document{
		Name:    filepath.Base(canonical),
		Path:    canonical,
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// ListDocuments lists all files/dirs under the given directory, sorted by mod time desc
func (a *App) ListDocuments(dir string) ([]Document, error) {
	if err := a.requireAllowedPath(dir); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var docs []Document
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			return nil, err
		}
		docs = append(docs, Document{
			Name:    e.Name(),
			Path:    filepath.Join(dir, e.Name()),
			Size:    info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
			IsDir:   e.IsDir(),
		})
	}
	sort.Slice(docs, func(i, j int) bool {
		return docs[i].ModTime > docs[j].ModTime
	})
	return docs, nil
}

// ListDocumentTree recursively lists files/dirs as a tree.
// Only .md files and directories are included; hidden files (starting with .) are skipped.
func (a *App) ListDocumentTree(dir string) ([]Document, error) {
	if err := a.requireAllowedPath(dir); err != nil {
		return nil, err
	}
	return a.readTree(dir)
}

func (a *App) readTree(dir string) ([]Document, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var docs []Document
	for _, e := range entries {
		name := e.Name()
		if len(name) > 0 && name[0] == '.' {
			continue
		}
		info, err := e.Info()
		if err != nil {
			return nil, err
		}
		full := filepath.Join(dir, name)
		doc := Document{
			Name:    name,
			Path:    full,
			Size:    info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
			IsDir:   e.IsDir(),
		}
		if e.IsDir() {
			children, _ := a.readTree(full)
			doc.Children = children
			docs = append(docs, doc)
		} else if filepath.Ext(name) == ".md" {
			docs = append(docs, doc)
		}
	}
	sort.Slice(docs, func(i, j int) bool {
		if docs[i].IsDir != docs[j].IsDir {
			return docs[i].IsDir
		}
		return docs[i].Name < docs[j].Name
	})
	return docs, nil
}

// ReadDocument reads the full content of a file
func (a *App) ReadDocument(path string) (string, error) {
	if err := a.requireAllowedPath(path); err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteDocument writes content to a file
func (a *App) WriteDocument(path, content string) error {
	if err := a.requireAllowedPath(path); err != nil {
		return err
	}
	return atomicWriteFile(path, []byte(content), 0644)
}

// WriteImageAsset writes an image below the active document root and returns
// a Markdown-friendly path relative to the document file.
func (a *App) WriteImageAsset(documentPath, imageDir, fileName, encoded string) (string, error) {
	if err := a.requireAllowedPath(documentPath); err != nil {
		return "", err
	}
	canonicalDocument, err := canonicalPath(documentPath)
	if err != nil {
		return "", err
	}

	documentDir := filepath.Dir(canonicalDocument)
	root := documentDir

	cleanDir := filepath.Clean(filepath.FromSlash(strings.TrimSpace(imageDir)))
	if cleanDir == "" || cleanDir == "." {
		cleanDir = "assets"
	}
	if filepath.IsAbs(cleanDir) || cleanDir == ".." ||
		strings.HasPrefix(cleanDir, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("image directory must stay inside the document root")
	}

	targetDir := filepath.Join(documentDir, cleanDir)
	canonicalDir, err := canonicalPath(targetDir)
	if err != nil {
		return "", err
	}
	if !pathWithin(root, canonicalDir) {
		return "", fmt.Errorf("image directory is outside the document root")
	}
	if err := os.MkdirAll(canonicalDir, 0755); err != nil {
		return "", err
	}

	ext := strings.ToLower(filepath.Ext(fileName))
	if imageMimeType(ext) == "" {
		return "", fmt.Errorf("unsupported image type: %s", ext)
	}

	if strings.HasPrefix(encoded, "data:") {
		if comma := strings.IndexByte(encoded, ','); comma >= 0 {
			encoded = encoded[comma+1:]
		}
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("decode image: %w", err)
	}
	if len(data) == 0 {
		return "", fmt.Errorf("image is empty")
	}
	if len(data) > 20*1024*1024 {
		return "", fmt.Errorf("image exceeds 20 MB")
	}

	baseName := sanitizeAssetName(strings.TrimSuffix(filepath.Base(fileName), filepath.Ext(fileName)))
	if baseName == "" {
		baseName = "image"
	}
	targetPath := filepath.Join(canonicalDir, baseName+ext)
	for index := 1; ; index++ {
		if _, statErr := os.Stat(targetPath); os.IsNotExist(statErr) {
			break
		}
		targetPath = filepath.Join(canonicalDir, fmt.Sprintf("%s-%d%s", baseName, index, ext))
	}
	if err := atomicWriteFile(targetPath, data, 0644); err != nil {
		return "", err
	}

	relative, err := filepath.Rel(filepath.Dir(canonicalDocument), targetPath)
	if err != nil {
		return "", err
	}
	relative = filepath.ToSlash(relative)
	if !strings.HasPrefix(relative, ".") {
		relative = "./" + relative
	}
	return relative, nil
}

// ReadImageAsset resolves a Markdown image source relative to the active
// document and the configured image directory, then returns a data URL that
// can be rendered safely inside the WebView.
func (a *App) ReadImageAsset(documentPath, imageDir, source string) (string, error) {
	if err := a.requireAllowedPath(documentPath); err != nil {
		return "", err
	}
	canonicalDocument, err := canonicalPath(documentPath)
	if err != nil {
		return "", err
	}

	cleanDir := filepath.Clean(filepath.FromSlash(strings.TrimSpace(imageDir)))
	if cleanDir == "" || cleanDir == "." {
		cleanDir = "assets"
	}
	if filepath.IsAbs(cleanDir) || cleanDir == ".." ||
		strings.HasPrefix(cleanDir, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("image directory must stay inside the document root")
	}

	cleanSource := filepath.Clean(filepath.FromSlash(strings.TrimSpace(source)))
	if cleanSource == "" || cleanSource == "." {
		return "", fmt.Errorf("image source is empty")
	}

	a.mu.RLock()
	root := a.docDir
	a.mu.RUnlock()
	documentDir := filepath.Dir(canonicalDocument)
	if root == "" {
		root = documentDir
	}

	candidates := make([]string, 0, 2)
	if filepath.IsAbs(cleanSource) {
		candidates = append(candidates, cleanSource)
	} else {
		sourceSlash := filepath.ToSlash(cleanSource)
		imageDirSlash := filepath.ToSlash(cleanDir)
		isExplicitImageDir := sourceSlash == imageDirSlash ||
			strings.HasPrefix(sourceSlash, imageDirSlash+"/")
		if isExplicitImageDir {
			candidates = append(candidates, filepath.Join(documentDir, cleanSource))
		} else {
			candidates = append(candidates,
				filepath.Join(documentDir, cleanDir, cleanSource),
				filepath.Join(documentDir, cleanSource),
			)
		}
	}

	for _, candidate := range candidates {
		canonicalCandidate, err := canonicalPath(candidate)
		if err != nil || !pathWithin(root, canonicalCandidate) {
			continue
		}
		info, err := os.Stat(canonicalCandidate)
		if err != nil || info.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(canonicalCandidate))
		mimeType := imageMimeType(ext)
		if mimeType == "" {
			continue
		}
		if info.Size() > 20*1024*1024 {
			return "", fmt.Errorf("image exceeds 20 MB")
		}
		data, err := os.ReadFile(canonicalCandidate)
		if err != nil {
			continue
		}
		return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
	}

	return "", fmt.Errorf("image asset not found: %s", source)
}

func imageMimeType(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	default:
		return ""
	}
}

func sanitizeAssetName(name string) string {
	var builder strings.Builder
	previousDash := false
	for _, char := range strings.TrimSpace(name) {
		valid := unicode.IsLetter(char) || unicode.IsDigit(char) || char == '-' || char == '_'
		if valid {
			builder.WriteRune(char)
			previousDash = false
			continue
		}
		if !previousDash {
			builder.WriteByte('-')
			previousDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

// CreateDocument creates a new .md file with initial content
func (a *App) CreateDocument(dir, title string) (Document, error) {
	if err := a.requireAllowedPath(dir); err != nil {
		return Document{}, err
	}
	title, err := safeDocumentName(title)
	if err != nil {
		return Document{}, err
	}
	path := filepath.Join(dir, title+".md")
	if _, err := os.Stat(path); err == nil {
		path = filepath.Join(dir, title+"_"+time.Now().Format("20060102_150405")+".md")
	}
	if err := atomicWriteFile(path, []byte("# "+title+"\n\n"), 0644); err != nil {
		return Document{}, err
	}
	a.allowFile(path)
	info, err := os.Stat(path)
	if err != nil {
		return Document{}, err
	}
	return Document{
		Name:    filepath.Base(path),
		Path:    path,
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

func (a *App) recycleDir() string {
	return filepath.Join(a.configDir, "recycle-bin")
}

func copyPath(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("directory recycle is not supported")
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	if err := atomicWriteFile(destination, data, info.Mode().Perm()); err != nil {
		return err
	}
	return os.Remove(source)
}

func moveToRecycle(source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	if err := os.Rename(source, destination); err == nil {
		return nil
	}
	return copyPath(source, destination)
}

// DeleteDocument moves a file into the app recycle bin
func (a *App) DeleteDocument(path string) error {
	if err := a.requireAllowedPath(path); err != nil {
		return err
	}
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	storedName := time.Now().Format("20060102_150405") + "_" + filepath.Base(path)
	storedPath := filepath.Join(a.recycleDir(), storedName)
	if err := moveToRecycle(path, storedPath); err != nil {
		return err
	}
	if _, err := a.db.AddRecycleItem(path, storedPath, filepath.Base(path)); err != nil {
		_ = moveToRecycle(storedPath, path)
		return err
	}
	return nil
}

// ListRecycleBin returns files that were moved to the recycle bin
func (a *App) ListRecycleBin(limit int) ([]RecycleItem, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not available")
	}
	return a.db.ListRecycleBin(limit)
}

// RestoreRecycleItem restores a recycled file to its original path
func (a *App) RestoreRecycleItem(id int64) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	item, err := a.db.GetRecycleItem(id)
	if err == sql.ErrNoRows {
		return fmt.Errorf("recycle item not found")
	}
	if err != nil {
		return err
	}
	if err := a.requireAllowedPath(filepath.Dir(item.OriginalPath)); err != nil {
		return err
	}
	if _, err := os.Stat(item.OriginalPath); err == nil {
		return fmt.Errorf("original path already exists")
	}
	if err := moveToRecycle(item.StoredPath, item.OriginalPath); err != nil {
		return err
	}
	a.allowFile(item.OriginalPath)
	return a.db.RemoveRecycleItem(id)
}

// PurgeRecycleItem permanently removes a recycled file
func (a *App) PurgeRecycleItem(id int64) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	item, err := a.db.GetRecycleItem(id)
	if err == sql.ErrNoRows {
		return fmt.Errorf("recycle item not found")
	}
	if err != nil {
		return err
	}
	if err := os.Remove(item.StoredPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return a.db.RemoveRecycleItem(id)
}

// RenameDocument renames a file
func (a *App) RenameDocument(oldPath, newName string) (Document, error) {
	if err := a.requireAllowedPath(oldPath); err != nil {
		return Document{}, err
	}
	newName, err := safeDocumentName(newName)
	if err != nil {
		return Document{}, err
	}
	dir := filepath.Dir(oldPath)
	ext := filepath.Ext(newName)
	if ext == "" {
		newName += ".md"
	}
	newPath := filepath.Join(dir, newName)
	if err := a.requireAllowedPath(newPath); err != nil {
		return Document{}, err
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return Document{}, err
	}
	a.allowFile(newPath)
	info, err := os.Stat(newPath)
	if err != nil {
		return Document{}, err
	}
	return Document{
		Name:    newName,
		Path:    newPath,
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// frontendPackageJSON 是前端 package.json，作为版本号的唯一权威来源。
//
//go:embed frontend/package.json
var frontendPackageJSON []byte

// GetAppVersion returns the current application version
func (a *App) GetAppVersion() string {
	var pkg struct {
		Version string `json:"version"`
	}
	_ = json.Unmarshal(frontendPackageJSON, &pkg)
	return pkg.Version
}

// SetPendingChanges records whether the frontend still has unsaved content
func (a *App) SetPendingChanges(count int, summary string) {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()
	a.pending = count
	a.pendingID = summary
}

// ConfirmClose allows the application to close after a save attempt
func (a *App) ConfirmClose() {
	a.closeMu.Lock()
	a.pending = 0
	a.pendingID = ""
	a.closeMu.Unlock()
	if a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	a.closeMu.Lock()
	hasPending := a.pending > 0
	summary := a.pendingID
	a.closeMu.Unlock()
	if !hasPending {
		return false
	}
	if ctx != nil {
		runtime.EventsEmit(ctx, "app:before-close", map[string]interface{}{
			"pending": 1,
			"summary": summary,
		})
	}
	return true
}

// SaveRecoveryState stores unsaved content for crash recovery
func (a *App) SaveRecoveryState(payload string) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	return a.db.SetState("recovery", payload)
}

// LoadRecoveryState returns the last crash-recovery snapshot
func (a *App) LoadRecoveryState() (string, error) {
	if a.db == nil {
		return "", nil
	}
	return a.db.GetState("recovery")
}

// ClearRecoveryState removes a recovery snapshot after it is handled
func (a *App) ClearRecoveryState() error {
	if a.db == nil {
		return nil
	}
	return a.db.DeleteState("recovery")
}

// MenuSave emits a save event to the frontend (triggered by menu bar)
func (a *App) MenuSave() {
	runtime.EventsEmit(a.ctx, "menu:save")
}

// MenuSaveAs emits a save-as event to the frontend
func (a *App) MenuSaveAs() {
	runtime.EventsEmit(a.ctx, "menu:saveas")
}

// SaveDocumentAs opens a save dialog and writes content to the chosen path
func (a *App) SaveDocumentAs(content string) (Document, error) {
	runtime.LogPrint(a.ctx, "SaveDocumentAs: opening save dialog, content length="+fmt.Sprint(len(content)))
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存 Markdown 文件",
		DefaultFilename: "未命名.md",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md)", Pattern: "*.md"},
		},
	})
	if err != nil {
		runtime.LogPrint(a.ctx, "SaveDocumentAs: dialog error: "+err.Error())
		return Document{}, err
	}
	if path == "" {
		runtime.LogPrint(a.ctx, "SaveDocumentAs: user cancelled (empty path)")
		return Document{}, fmt.Errorf("canceled")
	}
	// 确保 .md 扩展名
	if filepath.Ext(path) != ".md" {
		path = path + ".md"
	}
	runtime.LogPrint(a.ctx, "SaveDocumentAs: writing to: "+path)
	if err := atomicWriteFile(path, []byte(content), 0644); err != nil {
		runtime.LogPrint(a.ctx, "SaveDocumentAs: write error: "+err.Error())
		return Document{}, err
	}
	a.allowFile(path)
	runtime.LogPrint(a.ctx, "SaveDocumentAs: success, file written")
	info, err := os.Stat(path)
	if err != nil {
		return Document{}, err
	}
	return Document{
		Name:    filepath.Base(path),
		Path:    path,
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// SaveExportFile saves exported content through a native save dialog.
func (a *App) SaveExportFile(defaultName, content, encoding string) (string, error) {
	ext := strings.TrimPrefix(filepath.Ext(defaultName), ".")
	filters := []runtime.FileFilter{}
	if ext != "" {
		filters = append(filters, runtime.FileFilter{
			DisplayName: strings.ToUpper(ext) + " file",
			Pattern:     "*." + ext,
		})
	}

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出文件",
		DefaultFilename: defaultName,
		Filters:         filters,
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", fmt.Errorf("canceled")
	}
	if filepath.Ext(path) == "" && ext != "" {
		path += "." + ext
	}

	var data []byte
	if encoding == "base64" {
		data, err = base64.StdEncoding.DecodeString(content)
		if err != nil {
			return "", err
		}
	} else {
		data = []byte(content)
	}
	if err := atomicWriteFile(path, data, 0644); err != nil {
		return "", err
	}
	a.allowFile(path)
	return path, nil
}

// RevealDocument opens the containing folder and selects the document in the platform file manager.
func (a *App) RevealDocument(path string) error {
	if err := a.requireAllowedPath(path); err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	var command *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		command = exec.Command("open", "-R", path)
	case "windows":
		command = exec.Command("explorer", "/select,", path)
	default:
		command = exec.Command("xdg-open", filepath.Dir(path))
	}
	return command.Start()
}

// GetAppState returns the saved app state from SQLite
func (a *App) GetAppState() AppState {
	if a.db == nil {
		return AppState{}
	}
	dir, _ := a.db.GetState("documentDir")
	docsRaw, _ := a.db.GetState("openDocs")
	var openDocs []string
	if docsRaw != "" {
		json.Unmarshal([]byte(docsRaw), &openDocs)
	}
	return AppState{DocumentDir: dir, OpenDocs: openDocs}
}

func (a *App) saveState(state AppState) {
	if a.db == nil {
		return
	}
	a.db.SetState("documentDir", state.DocumentDir)
	// migrate old json file if exists
	oldPath := filepath.Join(a.configDir, "state.json")
	if _, err := os.Stat(oldPath); err == nil {
		os.Rename(oldPath, oldPath+".bak")
	}
	if len(state.OpenDocs) > 0 {
		data, _ := json.Marshal(state.OpenDocs)
		a.db.SetState("openDocs", string(data))
	}
}

// SaveAppSetting saves a key/value setting to SQLite
func (a *App) SaveAppSetting(key, value string) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	return a.db.SetSetting(key, value)
}

// LoadAppSettings returns all settings from SQLite
func (a *App) LoadAppSettings() (map[string]string, error) {
	if a.db == nil {
		return map[string]string{}, nil
	}
	return a.db.GetAllSettings()
}

func safeThemeID(id string) (string, error) {
	value := strings.TrimSpace(strings.ToLower(id))
	if len(value) < 2 || len(value) > 64 {
		return "", fmt.Errorf("theme id length must be between 2 and 64")
	}
	for index, char := range value {
		valid := (char >= 'a' && char <= 'z') ||
			(char >= '0' && char <= '9') ||
			char == '-' || char == '_'
		if !valid || (index == 0 && !((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9'))) {
			return "", fmt.Errorf("invalid theme id")
		}
	}
	return value, nil
}

func (a *App) themesDir() (string, error) {
	base := a.configDir
	if base == "" {
		var err error
		base, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(base, "md-editor-desktop")
	}
	dir := filepath.Join(base, "themes")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// GetThemesDirectory returns the directory used for user theme JSON files.
func (a *App) GetThemesDirectory() (string, error) {
	return a.themesDir()
}

// ListUserThemes returns theme files keyed by id.
func (a *App) ListUserThemes() (map[string]string, error) {
	dir, err := a.themesDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	themes := make(map[string]string)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		themes[id] = string(content)
	}
	return themes, nil
}

// SaveUserTheme validates and stores one user theme JSON file.
func (a *App) SaveUserTheme(id, content string) error {
	themeID, err := safeThemeID(id)
	if err != nil {
		return err
	}
	if !json.Valid([]byte(content)) {
		return fmt.Errorf("theme content must be valid JSON")
	}
	dir, err := a.themesDir()
	if err != nil {
		return err
	}
	return atomicWriteFile(filepath.Join(dir, themeID+".json"), []byte(content), 0644)
}

// DeleteUserTheme removes a user theme JSON file.
func (a *App) DeleteUserTheme(id string) error {
	themeID, err := safeThemeID(id)
	if err != nil {
		return err
	}
	dir, err := a.themesDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, themeID+".json"))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// RevealThemesDirectory opens the user theme directory in the platform file manager.
func (a *App) RevealThemesDirectory() error {
	dir, err := a.themesDir()
	if err != nil {
		return err
	}
	var command *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		command = exec.Command("open", dir)
	case "windows":
		command = exec.Command("explorer", dir)
	default:
		command = exec.Command("xdg-open", dir)
	}
	return command.Start()
}

func (a *App) pluginsDir() (string, error) {
	base := a.configDir
	if base == "" {
		var err error
		base, err = os.UserConfigDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(base, "md-editor-desktop")
	}
	dir := filepath.Join(base, "plugins")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// GetUserPluginsDirectory returns the directory used for user plugin JSON files.
func (a *App) GetUserPluginsDirectory() (string, error) {
	return a.pluginsDir()
}

// ListUserPlugins returns plugin package files keyed by id.
func (a *App) ListUserPlugins() (map[string]string, error) {
	dir, err := a.pluginsDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	plugins := make(map[string]string)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		plugins[id] = string(content)
	}
	return plugins, nil
}

// SaveUserPlugin validates and stores one user plugin JSON file.
func (a *App) SaveUserPlugin(id, content string) error {
	pluginID, err := safeThemeID(id)
	if err != nil {
		return err
	}
	if !json.Valid([]byte(content)) {
		return fmt.Errorf("plugin content must be valid JSON")
	}
	dir, err := a.pluginsDir()
	if err != nil {
		return err
	}
	return atomicWriteFile(filepath.Join(dir, pluginID+".json"), []byte(content), 0644)
}

// DeleteUserPlugin removes a user plugin JSON file.
func (a *App) DeleteUserPlugin(id string) error {
	pluginID, err := safeThemeID(id)
	if err != nil {
		return err
	}
	dir, err := a.pluginsDir()
	if err != nil {
		return err
	}
	err = os.Remove(filepath.Join(dir, pluginID+".json"))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// RevealUserPluginsDirectory opens the user plugin directory in the platform file manager.
func (a *App) RevealUserPluginsDirectory() error {
	dir, err := a.pluginsDir()
	if err != nil {
		return err
	}
	var command *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		command = exec.Command("open", dir)
	case "windows":
		command = exec.Command("explorer", dir)
	default:
		command = exec.Command("xdg-open", dir)
	}
	return command.Start()
}

// AddRecentFile adds a file to the recent list
func (a *App) AddRecentFile(path, name string) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	return a.db.AddRecentFile(path, name)
}

// ListRecentFiles returns recently opened files
func (a *App) ListRecentFiles(limit int) ([]Document, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not available")
	}
	return a.db.ListRecentFiles(limit)
}
