# Contract: File Project Store — v1.0.0

Plugin ID: `org.decisionator.store.file`  
Interface: Implements `ProjectStore` from `@decisionator/plugin-sdk`

## Capabilities & Constraints

1. **File System Access API (`showOpenFilePicker` / `showSaveFilePicker`)**:
   - Stores project data directly in `.decisionator.json` files on the user's hard drive.
   - Retains open `FileSystemFileHandle` in memory to support live streaming auto-save.
2. **Download Fallback**:
   - If File System Access API is unavailable (Firefox, Safari iOS), exports/downloads `.decisionator.json` Blob upon save and loads files via standard `<input type="file">`.
3. **Draft Cache**:
   - Active work is simultaneously backed up into browser IndexedDB draft cache to prevent data loss on unexpected browser closure.
4. **Schema Compliance**:
   - File payload strictly validates against `ProjectExportV1Schema` from `@decisionator/core`.
