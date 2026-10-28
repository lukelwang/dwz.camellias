# Append photos to existing cultivars; remove custom frames

Status: implemented and verified

The user wants previously entered cultivars selectable during upload search so new photo batches append to that same album. Existing data/cover/descriptions/notes must survive; no duplicate album should be created for the same canonical identity. Existing search already includes saved albums, but its affordance must clearly say Add photos and show the saved photo count. Select an existing record directly without requiring the external catalogue. Selected card and submit copy explicitly identify appending versus creating a new album. English/Chinese names and aliases stay searchable.

Canonical matching uses NFC normalization, trimmed/collapsed whitespace and lower-case canonical names (or stable ID). Do not merge by fuzzy punctuation/diacritic stripping or ambiguous shared aliases. A manual entry that exactly matches a unique saved name/display name/alias should select that existing album instead; ambiguous aliases require choosing a search result. Source results already saved should route to the existing record.

Remove all custom border/frame UI, rendering and styles from upload, album editing and photo editing. New photos/data snapshots have no frame fields. Keep legacy JSON readable; normalize legacy album/photo frame fields out in the model on ordinary saves. No forced data migration or writes to the owner's gallery just for this UI change. Plain photo previews remain in the photo editor. Persisted photos, dates, cover/order and all unrelated metadata are preserved.

Root owns controller and integration. CSS/template use plain `.photo-image` wrapper, no decorative border styles. Photo editor preview ID `photoPreview`, class `photo-edit-preview`. Root regenerates static pages after all changes.

## Verification

- All 47 Node tests passed, including canonical identity, repeated append, metadata preservation, frame-free PhotoIO, legacy JSON compatibility and atomic GitHub persistence.
- Phone browser flow against an isolated in-memory GitHub backend passed: invalid/read-only/other-owner denial; Chinese catalogue lookup; two-photo EXIF import; failed save retains drafts; first album creation; metadata edits; English/Chinese saved-album selection with the external catalogue unavailable; second two-photo append into the same album, preserving the first photos, cover, names, aliases and notes; no frame controls or rendering; cover, order and deletion. No live photo repository writes.
- Upload checked at 320px, 390px and 1440px without horizontal overflow. No page errors; token absent from browser storage.
- Generated public/owner pages verified; public page still contains no owner controls or credentials.
