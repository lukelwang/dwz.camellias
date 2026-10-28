# Mobile gallery playground

Open index.html or the GitHub Pages preview. The public demo token is `camellia-demo`.

This is a throwaway interaction prototype. Uploaded files and edits stay only in this page's memory. Refresh restores sample content and logs out. One-click reset restores sample content and keeps the current demo role. No actual GitHub writes, real token handling, or persistent storage are implemented.

The complete HTML, styles, state model, controller, sample images and EXIF reader are inline in index.html. The external cultivar catalogue is read-only; a full catalogue search requires internet access. Existing sample albums remain selectable offline.

Reference images retain their source credits. They are sample material, not the owner's photos.

Manual browser exploration covered 320/390/1440 px layouts, login, visitor restrictions, live catalogue selection, batch photos, EXIF versus missing dates, captions, frames, cover/order, edits, deletes, reset and refresh. Physical iPhone picker and HEIC behavior still await a real-device check. Unsupported native image decoding may use a smaller embedded preview, or request JPEG/PNG.

User verdict pending. No decisions have been promoted to production. Local source capture: codex/camellia-admin-prototype at 11964b58b2c4990daa966e55ea4ce69eac88477c.

EXIF reader: exifr 7.1.3, MIT license in exifr-LICENSE.txt.
