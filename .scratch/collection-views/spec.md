# Collection sorting without Favorites

Status: implemented and verified

Remove Favorites from navigation, filtering, cards, album actions and model behavior. Preserve the current immersive gallery and bookmark-tab visual style, public/owner separation, multi-photo append and every owner record.

The user corrected the initial tab interpretation: add Newly added and Registered year as Sort by dropdown options, immediately after Random order. Do not add collection tabs or year groups. Search and species/color/form filters combine with every sort. Random order keeps the per-visit shuffled order; existing A–Z/photo-count options remain. Newly added sorts cultivar albums by first addition time descending; appending photos does not make an old cultivar a new addition. Registered year sorts by recorded year descending, with unknown years last. Never infer registration years from publication, originated or capture dates.

New albums receive immutable addedAt timestamps. Add an editable registeredYear field to cultivar editing; import explicit source fields when available. Missing dates remain unknown. Existing Secchū-no-ka was first added in photo repo commit db77db0245e1c8d1e5dae355025e512267e50b80 at 2026-10-28T17:42:54Z; predecessor b178a95eef5bc49970be30c988be8e1136bba34e had zero albums. Backfill only this evidence-backed addition timestamp through a fresh SHA-checked update of gallery.json, preserving all unrelated live data. Registration year stays unknown because the source provides publication 2011/originated 2008 but no explicit registration date.

Validate metadata/order through unit tests and browser-check all sorting modes, unknown dates, search/filter combinations, responsive sorting controls, keyboard navigation, owner year editing and normal photo append using isolated synthetic storage. No fake photos or records are written to the real gallery. Publish using the existing GitHub Pages workflow.

## Square display request

User also requested portrait/landscape photos automatically fit square display areas. Cards and album stage use a 1:1 ratio and centered object-fit cover; full-screen uses contain so the complete saved photo remains available. Image files are not cropped on save.

## Backfill completed

Photo commit `48f28d5e2c617c4eb7c7d23d75daef98ae1d3b28` added only evidence-backed `addedAt` fields for Secchū-no-ka (17:42:54Z, original upload db77db0), Tinker Bell (22:20:46Z, fab10e7), and Rokukasen (22:23:29Z, e1a9a4b). The fresh SHA-checked update retained all three albums, 15 photos and all existing metadata. Registered years were left unknown.

## Verification

57 Node tests passed. Browser checks passed sorting option order, newest-first/registered-year ordering, unknown-date handling, random visit order restoration, combined search/filters and absence of all Favorites controls. Tested 320/390/768/1440px public layout and owner registered-year save/clear with isolated GitHub storage; existing photos and cover preserved. Cards and album stages verified square with cover fit at 320/390/1440px; full-screen remains contain. No fake records/photos were published.
