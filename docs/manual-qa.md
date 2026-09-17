# Manual GUI QA Checklist

This checklist covers the behavior that cannot be reliably automated in the current macOS environment because System Events accessibility permission is unavailable.

## Native IME

- [ ] Open a document in the native Wails window.
- [ ] Enter Chinese text with Pinyin candidate selection.
- [ ] Switch candidate words during composition.
- [ ] Cancel composition with Escape.
- [ ] Confirm no duplicated characters, cursor jumps, or lost text.
- [ ] Repeat with Japanese, Korean, emoji, and combining characters.

Expected result:

- `textarea` and block source caret remain stable.
- `data-composition-committed` appears only after `compositionend`.
- Model revision increments once per committed composition.

## Undo and Redo

- [ ] Type several characters, then press `Cmd/Ctrl + Z`.
- [ ] Press `Cmd/Ctrl + Shift + Z` and `Ctrl + Y`.
- [ ] Split a paragraph with Enter.
- [ ] Delete an empty block with Backspace.
- [ ] Move a block with `Alt + ArrowUp/Down`.

Expected result:

- Document content, active block, and caret position are restored.
- Undo and redo do not rebuild unrelated blocks.
- Model revision changes are reflected in `data-editor-revision`.

## Unsaved Close

- [ ] Create unsaved content in the native window.
- [ ] Attempt to close the window.
- [ ] Confirm the app attempts to save before closing.
- [ ] Force a save failure if possible, then close again.

Expected result:

- Close is prevented while dirty content remains.
- A visible warning is shown when saving fails.
- Successful save clears dirty state and allows close.

## Save Failure and Recovery

- [ ] Make the document directory read-only or disconnect the target volume.
- [ ] Edit and trigger autosave.
- [ ] Restart the app.

Expected result:

- Dirty state remains after save failure.
- Recovery snapshot remains available.
- Restart offers recovery or discard.

## External File Changes

- [ ] Open a local Markdown file.
- [ ] Modify it in another editor.
- [ ] Delete or rename it externally.
- [ ] Trigger conflict handling.

Expected result:

- Watcher detects revision or hash changes.
- The app offers reload, keep local, or save copy.
- No silent overwrite occurs.

## Table and Code Block

- [ ] Insert a table with `Cmd/Ctrl + Alt + T`.
- [ ] Navigate and edit table Markdown source.
- [ ] Insert a code block and press Enter.
- [ ] Press Tab and Shift+Tab inside the code block.

Expected result:

- Table insertion is undoable.
- Enter inside code block inserts a newline.
- Tab inserts spaces without leaving the editor.

## Drag and Drop

- [ ] Drop plain text into the editor.
- [ ] Drop a Markdown file.
- [ ] Drop a small image.

Expected result:

- Text and Markdown are inserted through a transaction.
- Image insertion does not execute HTML.
- Large attachments still require the future backend attachment API.

## Large Document

- [ ] Open a document with at least 100,000 characters.
- [ ] Type continuously for 30 seconds.
- [ ] Scroll quickly.
- [ ] Trigger undo and redo.

Expected result:

- No full-document DOM rebuild occurs.
- Typing remains responsive.
- Memory growth stabilizes after history compaction.
