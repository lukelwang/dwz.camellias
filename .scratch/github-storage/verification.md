# Verification record

## Automated checks

34 Node tests passed: 24 storage tests (identity, owner/repository write probe, credential routing, partial failures, concurrency, atomic file pairs/deletion, unknown schema, large Unicode index, rate limits, mutative request pacing, uncertain success and API/raw cache behavior); 6 photo preparation helper tests; 4 model tests (proposal isolation, owner metadata, stable session order and preservation of extra index fields). JavaScript syntax and Git whitespace checks passed.

## Real GitHub integration

Used an isolated temporary branch of the newly created photo repository. The credential was read from the existing GitHub CLI session into process memory and was never printed, passed in arguments, or saved in a file. Verified owner login/write probe, one atomic photo pair plus JSON commit, immediate anonymous JSON/image read, stale session rejection, authenticated refresh, metadata save, and deleting both photo files with index update. Main stayed at its initial empty-gallery commit. Temporary branch deleted afterward. Successful run: upload `968fd688cef90065ca607f66dc834a37ee881e65`, metadata `5bb0110bf4340376805bdff0688914dca53550f0`, cleanup `7bd2657cb38adef7e1ca87a6663822bc75c32a96`.

Live checks discovered both raw branch caching and anonymous API ref caching. Fixed by giving head reads unique cache keys and pinning JSON and displayed photos to the resolved commit. The complete real integration passed after the correction.

## Browser integration

390px browser run used the actual application/controller/photo pipeline/store with a synthetic GitHub network backend and public fake credentials. Verified invalid token, other-account token, read-only token rejection; live catalogue selection; actual two-file EXIF/undated preview and JPEG generation; failed-upload draft retention; atomic metadata/file requests; frame/caption/name/note edits; refresh persistence and logout; pinned image URLs; interactive hero after load; cover/order; delete cancellation, file removal and deleted-album modal closure; empty local/session storage; no page errors. Checks at320/390/1440px found no horizontal overflow.

Focused independent review found and corrected dropped extra top-level JSON fields and stale disabled/dialog state after saved-data rendering. Album-default frame inheritance is the batch default; individual overrides remain available.

## Remaining real-device check

Physical iPhone Photos picker and HEIC decoding still need the owner's device. Native decoding is used; unsupported images fail explicitly instead of publishing an embedded thumbnail. The owner must generate their own narrowly scoped fine-grained token through the link in the login dialog. No token was generated for them or embedded in the website.

## Deployment

GitHub Pages source switched to `main` and build succeeded for runtime commit `48fd3987cf4aace1b6a4b14f5024927cdf1ef96d`. Public HTML matched the local index byte-for-byte (18,796 bytes); browser loaded the real public empty gallery and token help over HTTPS at390px with no errors or overflow. Production no longer contains the public demo token or reset action. Photo repository has only main and its initial empty index; no test photos remain in the published gallery. Verified on 2026-10-28.

The desktop preview handoff was queued by the app; the public URL is also provided directly in the handoff message. The previous prototype remains recoverable on its separate repository branch.
