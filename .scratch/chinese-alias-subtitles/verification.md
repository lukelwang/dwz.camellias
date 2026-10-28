# Chinese alias subtitles

Status: implemented and verified

Show source Chinese aliases as a smaller secondary line below the primary cultivar title in the hero, gallery cards, album details, and selected-cultivar upload preview. Empty aliases are omitted, duplicate aliases are collapsed, and names equal to the title are excluded. Catalogue title selection, Chinese search, owner-edited titles, persisted data and photographs are unchanged. The detail view retains Japanese aliases separately without repeating Chinese aliases.

Manual browser checks with the owner's Secchū-no-ka album confirmed English primary title, Chinese subtitle 雪中花, one Chinese line in the album, and four photos. Hero type sizes are27px/14px on desktop,24px/13px on mobile. Checked320/390/1440px widths. Mobile adjustments keep the decorative hero label clear of the caption and allow long garden names/footer text to wrap; no horizontal overflow. Browser console had no errors. Existing Node suite40/40 passed; syntax/whitespace checks passed. No new test suite added for this presentation change.
