# Catalogue names as default album titles

Status: implemented and verified

Reported symptom: the user selected `Secchū-no-ka`, but the uploaded album and hero showed the Chinese alias `雪中花` as the primary title.

Reproduced before editing with `node --test tests/catalog.test.js`: expected `Secchū-no-ka`, actual `雪中花`. The deterministic `toCultivar` mapping explicitly preferred the first Chinese alias; the source canonical name was already preserved correctly in `name`. This direct reproduction identifies the cause without speculative hypotheses or instrumentation.

Removed the alias preference. New imports use the exact catalogue canonical name as their default display name and retain original Chinese/Japanese aliases. Explicit owner display-name edits still follow existing behavior. Three regression tests cover the reported title, Chinese alias search through record import, and a genuinely Chinese canonical name. Full suite:40/40 passed. Syntax/whitespace checks passed.

Corrected only `display_name` on the existing reported album, with a compare-and-swap update to the photo index. All four photos, aliases, source description, cover, notes and the owner's garden settings were preserved. Data commit: `a04fd3f41980730b57d619959f626903ed5a0e26`.

Regenerated the owner page so its catalogue script URL receives the updated content hash. Public gallery remains unlinked from owner management.
