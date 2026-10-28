# DWZ Camellias

A public, phone-first camellia gallery in the original Noir style.

- Website: https://lukelwang.github.io/dwz.camellias/
- Public photo/index repository: https://github.com/lukelwang/dwz.camellias.photo
- Catalogue: https://camellia-nomenclature.github.io/ (read-only)

Only the owner `lukelwang` (GitHub ID `5496485`) can enter management mode. The website verifies a GitHub token against the owner identity and the photo repository's Contents write permission. Visitors browse without logging in. There is no registration, application server, Cloudflare or separate database.

## Create your management token

Open the separate owner page shared directly with the owner and choose **Create an access token**. The public gallery has no sign-in entry or management link. The owner page requests `noindex, nofollow, nosnippet`; GitHub owner verification and token permissions remain required. In GitHub:

1. Resource owner: `lukelwang`.
2. Repository access: **Only select repositories**, then select **dwz.camellias.photo**.
3. Repository permissions: **Contents → Read and write**; Metadata read is automatic.
4. Generate the token and paste it directly into the gallery login. Do not commit it or send it in chat.

The token remains only in current-page memory. Refresh/close/logout clears the site's session, so the next management session needs the token again. GitHub still controls token expiry/revocation. The website never stores the token in localStorage, sessionStorage, IndexedDB, URLs or repository files. Authenticated requests go only to `https://api.github.com`; public photos and JSON are read from `raw.githubusercontent.com`. No remote scripts, analytics, or remote fonts are loaded.

## Browsing and sorting

Favorites have been removed. The **Sort by** menu lists Random order, Newly added, Registered year, Cultivar A–Z and Photo count. Random order is shuffled once per visit. Newly added uses the cultivar album’s first addition timestamp; adding more photos preserves it. Registered year sorts newest first, with unknown years last. Explicit registration years from the source catalogue are imported, and the owner can add or clear the year in Edit cultivar. Publication and origin dates are not treated as registration years.

Gallery cards and album stages show centered square crops for portrait and landscape photos. Fullscreen viewing shows the complete image; saved photo files are unchanged.

## Photos and durable changes

Select one cultivar from the live catalogue or your saved albums, choose multiple images, check captions and dates, then save. Saved cultivars are marked **In your garden · Add photos**; selecting one appends the batch to the same album, preserving its cover and details. The browser generates a display JPEG (up to 2560 pixels on its longest edge) and a thumbnail (up to 640 pixels). The original files stay in your photo library; this is a gallery rather than an original-photo archive. Capture time comes from EXIF DateTimeOriginal, is shown in the camera's local time, and can be edited. Missing capture dates stay blank. Generated JPEGs do not retain embedded EXIF/GPS; capture time and its source remain in the album index.

A batch's images, thumbnails, and `gallery.json` are saved in one Git commit. Only a confirmed GitHub branch update counts as success. Interrupted/failed saves keep the pending selection. Concurrent changes are rejected; use the explicit reload control before retrying. Album details, page settings, cover/order and deletions use the same durable save path. Deletions remove current files; older Git commits retain recovery history.

Public loading resolves the current commit through the GitHub API, then reads immutable JSON and image URLs from that same commit. This avoids stale branch URLs at the raw CDN. Newly saved content appears in the owner's current page after confirmed save; other browsers reload the current public snapshot. No service worker or application cache is used.

Modern Safari can decode iPhone HEIC files directly. If the current browser cannot decode a file, the upload reports it and asks for JPEG/compatible format; it does not publish an embedded low-resolution preview as the photo. Physical iPhone Photos picker behavior still needs a real-device check.

## Language

The interface is English. Cultivar search accepts English, Chinese and Japanese names and aliases. Original catalogue names, user captions, notes and Chinese text input remain intact.

## Development

Buildless HTML/CSS/JavaScript, served directly by GitHub Pages from `main`. The shared source is `templates/gallery.html.template`; regenerate the two documents after editing markup with `python3 scripts/build-pages.py --manager-output <existing-owner-page-filename>`. The owner filename is intentionally not linked here or in the public page.

Run locally and check the application:

```sh
python3 -m http.server 8770 --bind 127.0.0.1
node --test tests/*.test.js
```

Scripts and the EXIF reader are local files. exifr 7.1.3 uses the MIT license in `vendor/exifr-LICENSE.txt`.

The earlier public-token, memory-only prototype is preserved on `codex/camellia-admin-prototype`. Production contains no demo-token login or reset-to-demo action. The real photo repository starts empty; no reference photos from other photographers are promoted into it.
