# English public gallery and separate owner page

Status: implemented and verified

The public home page must have no sign-in entry, token form, upload controls, settings or management link. Owner management moves to a separate unlinked page at a randomized file name (final URL given directly to the owner). The owner page has noindex/nofollow metadata. It still requires the same GitHub owner identity and Contents write verification; an unlinked URL is not a substitute for authentication.

All interface text is English, including HTML metadata, headings, buttons, accessible names, dialogs, catalogue status labels, errors and save confirmations. Chinese/Japanese cultivar names and aliases, descriptions received from the source, user captions/notes and manual Chinese input remain supported and unchanged. Do not strip Unicode or translate user data.

Shared controller uses `document.body.dataset.page === 'manager'` to enable management wiring. Public markup has only the album dialog; manager-only form listeners are installed only on the owner page. Public render/load methods tolerate absent management nodes. Default site text: brand `DWZ Camellias`; titleLine1 `Every bloom,`; titleLine2 `a moment kept.`; description `A garden of more than 400 camellia cultivars.\nPhotographed, remembered, and grown with care.`; gardenCount `400+`. Existing seeded Chinese default settings are migrated in the photo JSON with a compare-and-swap update preserving all albums and any owner changes.

Keep the existing Noir appearance, mobile multi-photo batch input, real saves, and memory-only token. Homepage never links to owner page or loads login/upload form markup. Owner page links back to public home; no login state is shared through storage between the pages.
