# UI and usability improvement audit

Status: implemented and verified

Keep the existing Noir immersive photography direction, English interface with Chinese cultivar aliases/input, public/owner separation, GitHub-only persistence and all owner data. Improve the existing experience rather than introducing a theme switch or new services.

## Observed visual problems

- Desktop search input is 12px, filter labels/selects are 11px, result count is 10px; mobile select text jumps to 16px. A 44px minimum control height surrounds tiny desktop text.
- Expanded filters use `padding:18px 0`, so labels touch the panel edge. Inline labels and unequal native selects do not share a field baseline or width.
- Search/filter controls, count badges, cards, owner buttons and dialogs use inconsistent 2/4/6/8/13px corner treatments, spacing and border colors inherited from prototype layers.
- Mobile filter button hides its text. Category tabs have small text and overflow horizontally; sorting has no visible label. The result count says “1 cultivars”.
- Album descriptions/facts and owner help text are small relative to the large display headings. Destructive actions and primary actions need more distinct emphasis.

## Source-confirmed usability issues to fix

- Gallery/album/fullscreen renders replace the focused control and can lose keyboard focus or dialog return targets.
- Processing each file replaces every pending caption/date row, interrupting editing during multi-file import.
- Loading, first-load error, empty Favorites, empty garden and filtered no-results need distinct feedback.
- Conflict reload keeps stale untouched editor fields; preserve actual edits while refreshing untouched fields and avoid overwriting concurrent changes.
- Public unknown-date labels ask visitors to “Add manually”, although they cannot edit.

## Acceptance

- Shared type, spacing, controls and border rules across collection, album, owner studio and upload/edit dialogs; readable inputs and 44px interactive targets; visible keyboard focus.
- Responsive checks at 320, 390, 768 and 1440 CSS px; no horizontal page/dialog overflow or clipped controls. Check representative multi-album/long-name fixtures as well as the real one-album garden.
- Preserve English/Chinese search, favorites, color/form/species filters, sorting, random visit order, album navigation and full-screen viewing.
- Browser-check owner login, multi-photo append from cultivar editor, unsaved edits, failures/retry, conflict recovery and import editing with synthetic GitHub storage. No fixture writes to the real photo repository.
- Build and verify both generated pages, run appropriate existing checks, publish through the existing GitHub Pages workflow, then verify the deployed assets and pages.
