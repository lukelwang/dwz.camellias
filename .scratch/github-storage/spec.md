# GitHub-backed camellia gallery

Status: implemented and verified; deployment pending

User authorized creation of public `lukelwang/dwz.camellias.photo`, real owner-only PAT login, durable multi-photo upload, and deployment to the existing public gallery. Keep original Noir and phone-first selection. Production is independent of the preserved prototype branch; do not retain reset-to-demo or public demo authorization.

- Fixed owner login `lukelwang`, numeric GitHub ID 5496485; photo repository `dwz.camellias.photo`, branch `main`.
- New public photo store starts with empty albums and default garden settings. No reference/demo photos promoted.
- `gallery.json`: `{schemaVersion:1, settings:{brand,titleLine1,titleLine2,description,gardenCount}, albums:[...]}`.
- Token is memory-only, only sent to api.github.com over HTTPS, never in URLs, storage, source, logs, catalogue calls or image URLs. Check `/user` numeric ID plus selected repository Contents write permission. Login does not create a visible commit.
- Atomic batch: image blobs + thumbnails + gallery JSON in one tree/commit/ref update. Force=false; detect stale head, retain local pending inputs and never overwrite concurrent edits. Metadata, frames, cover, reorder and deletes persist as well.
- Image pipeline makes 2560px JPEG display copy and 640px thumbnail, preserving EXIF capture date as metadata, never substituting upload/file modification time. Original file is not archived. Unsupported HEIC is rejected rather than silently publishing a thumbnail.
- Save success shown only after GitHub confirms. Failed uploads remain pending. No production reset button. Deletes require a clear application confirmation and remain recoverable in Git history.
- Public anonymous reads; credentials only needed to manage. Initial empty state is intentional.
- Verify authentication restrictions, permission failure, concurrent save, partial failure, atomicity, metadata persistence, refresh, mobile layout, real repository integration in an isolated temporary branch, and deployed anonymous reads.

## Shared implementation contract

`window.CamelliaStore.create(config?)` returns:
- `loadPublic(): Promise<document>`
- `login(token): Promise<{document,user,commit}>` (checks owner + Contents-write via existing-document blob probe, sets private in-memory session)
- `logout(): void`, `isAuthenticated(): boolean`
- `save(document, {files:[{path,blob}], removePaths:[string], message, onProgress(message)} = {}): Promise<{document,commit}>`
- `photoURL(path): string` (fixed public raw host/owner/repo/main)

Store config defaults are fixed production owner/repo/ID/branch. Optional overrides exist only for isolated verification; production page uses defaults. Store errors have safe `.code` values such as AUTH, PERMISSION, CONFLICT, NETWORK, UNCERTAIN, VALIDATION and user-readable messages; never echo response bodies/credentials.

Photo records persisted in JSON contain src, thumbnailSrc, imagePath, thumbnailPath, id, filename, caption, takenAt, dateSource, dateOffset, width, height, size, mime, frame, kind=personal. No Blob or object URLs go into the JSON. Unique file paths: `photos/<photo-id>/image.jpg`, `photos/<photo-id>/thumbnail.jpg`.

`window.CamelliaPhotoIO.readFile(file)` returns a pending photo with src=objectURL, imageBlob, thumbnailBlob, width/height/size/mime, id/filename/caption/takenAt/dateSource/dateOffset/frame; error is a user-readable string on decode failure. `dateLabel(photo)` provides display label. Caller revokes pending src when removed/closed/reset/replaced.
