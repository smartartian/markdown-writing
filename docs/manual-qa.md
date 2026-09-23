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

## Settings

- [ ] Open Settings from the editor sidebar.
- [ ] Switch between System Settings and Shortcuts several times.
- [ ] Change theme, editor font, font size, line height, content width, and reduced motion.
- [ ] Close and reopen Settings, then restart the app.
- [ ] Record a shortcut, cancel with Escape, then record and restore the original value.
- [ ] Trigger Check for Updates after switching categories.
- [ ] Select a document directory from Settings.

Expected result:

- Appearance values apply immediately and persist after restart.
- Font size, line height, and content width visibly affect both rendered and source modes.
- Check for Updates remains functional after switching settings categories.
- Shortcut recording does not accidentally close the settings page.
- Directory selection persists in the last application state.

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


## Source Peek

- [ ] Put the caret in a paragraph, heading, quote, list, table, or divider and press `F5`.
- [ ] Edit only the displayed block Markdown and apply with `Cmd/Ctrl+Enter`.
- [ ] Change a table column count and verify the rendered block updates immediately.
- [ ] Change list indentation from 2 to 4 spaces and verify the raw Markdown is preserved exactly.
- [ ] Type Chinese with an IME and verify composition does not submit the Peek.
- [ ] Press `Esc` after editing and verify the block is unchanged.
- [ ] Press `F5` on a code block or raw HTML block and verify it does not open Source Peek.
- [ ] Open Source Peek twice in succession and verify only one overlay exists.
- [ ] Apply one Peek change and press `Cmd/Ctrl+Z`; verify one undo restores the previous block.

Expected result:

- Source Peek edits one block through an `EditorSession` replace transaction.
- Applying no changes does not create an undo step or mark the document dirty.
- The overlay uses the active theme and remains usable on narrow windows.
