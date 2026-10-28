# Photo display and owner controls

Status: implemented and verified

## User requests implemented

- Fix upload progress: four selected photographs display 1/4 through 4/4, grouping each display JPEG and thumbnail under one photo. Save remains one atomic Git commit; repeated/interleaved file orders do not inflate the counter.
- Add Garden settings > Show cultivar record links. Defaults to visible for existing gardens; toggling affects only the View full cultivar record link, preserving descriptions, facts, years and photos.
- Add configurable display-only watermark text. Blank uses © plus garden name. Escaped watermark layers cover hero, gallery, album, thumbnails, previews and fullscreen; stored JPEGs are unchanged.
- Discourage casual saving via image drag prevention, noneditable context-menu prevention, mobile image callout CSS and Ctrl/Cmd+S prevention. Inputs and editable menus remain usable. This cannot prevent screenshots, developer tools or direct downloads from the public GitHub photo repository. This limit was explained to the user.
- Keep Japonica/Sasanqua/Reticulata/Hybrid filters; group remaining species such as Hiemalis under Other. Preserve the real saved species in records and displayed cultivar details.
- Make cover selection discoverable above owner thumbnails, with Set as cover / Current cover and an owner-only Cover badge. Persist coverPhotoId and retain photo order. Gallery and initially opened album use the chosen cover.
- Keep the existing homepage arrow icon. Clicking the hero now randomly selects a different photographed cultivar cover without opening an album. Preserve selection through renders; disable switching with fewer than two photographed cultivars.

## Verification

- Reproduced the reported four-photo bug as 1/8 through 8/8 before the fix; regression now checks 1/4 through 4/4 and four saved photos/eight file blobs, including interleaved input.
- 60 Node tests passed; source syntax and generated-page checks passed.
- Isolated browser storage test uploaded four photos, observed all four progress messages, selected and saved a cover, verified the Cover badge and initial reopened image, toggled source links off/on, and confirmed descriptions/facts/photos remain unchanged.
- Verified custom watermark persistence and literal HTML escaping, brand fallback on blank, full-screen watermark with complete-image containment, context-menu/drag/save deterrents, and editable-menu preservation.
- Other includes real Hiemalis labels. Eight hero clicks produced different consecutive cultivar names with no album modal; zero/one-photo states disable switching without dimming the image.
- Owner setting fits 320/390/1440px. No page errors. Test writes stayed in the synthetic GitHub backend; real photographs and owner data were not changed by QA.
