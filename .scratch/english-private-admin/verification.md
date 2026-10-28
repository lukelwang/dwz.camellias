# Verification

37 Node tests passed, including public/owner document contracts and the existing authentication, storage, image and model checks. JavaScript syntax and whitespace checks passed.

Browser integration used the real application/store with a synthetic GitHub backend and fake credentials. It verified an English public page with zero owner form/control nodes, automatic login on the separate owner page, rejection of invalid/other-user/read-only tokens, Chinese catalogue search results, Chinese caption/name/notes round trips, upload failure draft retention, frames, cover/order, delete confirmation/file removal, public browsing after saves, and memory-only tokens. No browser errors.

Public and owner pages were checked at320,390,1440px with no horizontal overflow. Shared markup is generated into two documents: public output strips all owner-only forms and scripts, owner output requests noindex/nofollow/nosnippet. Assets receive content-hash query versions to avoid old cached controllers when the public markup changes. No owner URL is linked from the public gallery or README.

The photo index's garden branding and introduction were changed to English using a compare-and-swap update. All albums were preserved; the repository was still empty. Photo data commit: c0bfefe3b4a620c71ac9f2679fdbe740cf4f6600. Cultivar aliases and Unicode user content were not changed.

Deployment is performed from main after merging this change. Public URL and the unlinked owner URL are handed directly to the user; knowing the owner URL still requires the same GitHub token authentication.
