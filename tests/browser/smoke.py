#!/usr/bin/env python3
"""Browser smoke test for the public gallery and the unauthenticated owner gate.

Python Playwright is installed outside the repository (no package.json, nothing vendored):
  python3 -m pip install --user playwright==1.58.0
  python3 -m playwright install chromium
  PLAYWRIGHT_BROWSERS_PATH=/tmp/gallery-modern-web/pw-browsers python3 -m playwright install webkit

Run against a local server (python3 -m http.server 8770 --bind 127.0.0.1) or production:
  BASE_URL=http://127.0.0.1:8770/ TEST_BROWSER=chromium python3 tests/browser/smoke.py
  PLAYWRIGHT_BROWSERS_PATH=/tmp/gallery-modern-web/pw-browsers BASE_URL=http://127.0.0.1:8770/ TEST_BROWSER=webkit python3 tests/browser/smoke.py
  BASE_URL=https://lukelwang.github.io/dwz.camellias/ TEST_BROWSER=chromium python3 tests/browser/smoke.py

GitHub safety (every context installs the route before its first navigation):
- api.github.com is never contacted by default. The anonymous latest-commit lookup is answered locally
  with FIXTURE_SHA (a pinned photo-repository commit); any other api.github.com request is aborted.
  Anonymous API calls share a 60/hour per-IP quota, and exhausting it takes the public gallery offline.
  LIVE_API=1 lets api.github.com GETs through (explicit opt-in only).
- Any non-GET request to *.github.com, *.githubusercontent.com or *.github.io is aborted, reported and
  fails the run. gallery.json and photos are still read from raw.githubusercontent.com at the pinned commit.
- The owner page is located by the filename pattern of scripts/build-pages.py (or OWNER_PATH) and is
  never printed. It is only checked unauthenticated: nothing is typed or submitted.

Exit code 0 when every check passes, no GitHub write was attempted and (without LIVE_API) no request
reached api.github.com; otherwise 1.
"""
import os, re, sys, unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import quote, urlparse
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8770/').rstrip('/') + '/'
BROWSER = os.environ.get('TEST_BROWSER', 'chromium')
PINNED_SHA = 'd13f0f5eae0fab47781668ae58b4f8fb2d6845c3'
# Counts of the photo repository at PINNED_SHA. Bump PINNED_SHA and these together. They are asserted
# only when the run uses PINNED_SHA (FIXTURE_SHA unset or equal, LIVE_API unset); otherwise they are skipped.
PINNED_CARDS = 20
PINNED_JAPONICA = 11
PINNED_SANPEI_IDS = ['camellia-library-53616e7065692d74737562616b69']  # search "sanpei" -> Sanpei-tsubaki only
FIXTURE_SHA = os.environ.get('FIXTURE_SHA', PINNED_SHA)
LIVE_API = os.environ.get('LIVE_API') == '1'
PINNED = FIXTURE_SHA == PINNED_SHA and not LIVE_API
ROOT = Path(__file__).resolve().parents[2]
OWNER = os.environ.get('OWNER_PATH') or next((p.name for p in sorted(ROOT.glob('*.html')) if re.fullmatch(r'studio-[a-f0-9]{12}\.html', p.name)), None)
_HIDDEN = sorted({v for name in filter(None, {OWNER, os.environ.get('OWNER_PATH'), OWNER and Path(OWNER).name})
                  for v in (name, quote(name), quote(name, safe=''))}, key=len, reverse=True)

def redact(text):
    """Every printed string passes through here so the owner page name never appears in output."""
    text = str(text)
    for value in _HIDDEN:
        text = text.replace(value, '<owner page>')
    return text

GITHUB_HOST = re.compile(r'(^|\.)(github\.com|githubusercontent\.com|github\.io)$')
REF_LOOKUP = re.compile(r'^https://api\.github\.com/repos/[^/]+/[^/]+/git/ref/heads/')
VIEWPORTS = {
    '390': dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True),
    '1440': dict(viewport={'width': 1440, 'height': 900}),
    '320': dict(viewport={'width': 320, 'height': 640}, device_scale_factor=2, is_mobile=True, has_touch=True),
    **{w: dict(viewport={'width': int(w), 'height': 900}) for w in ('581', '700', '768', '1024')},  # hero layout breakpoints between phone and desktop
}
INIT = """window.__csp = [];
document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
// Cold-load record: header top on every animation frame and every #resultSummary text, each with the card count at that moment.
// Sampling stops a settle window after the load completes (cards rendered, or the empty/error state shown once the page is no longer busy),
// with a 30s hard cap so a slow load cannot end the record early.
window.__load = {tops: [], summary: [], completedFrame: null};
(() => { const start = performance.now(), cards = () => document.querySelectorAll('#gallery .cultivar-card').length;
  const complete = () => document.body?.getAttribute('aria-busy') === 'false' && (cards() > 0 || document.querySelector('#emptyState')?.hidden === false);
  const tick = () => { const header = document.querySelector('.site-header'); if (header) __load.tops.push([Math.round(header.getBoundingClientRect().top * 100) / 100, cards()]);
    if (__load.completedFrame === null && complete()) __load.completedFrame = __load.tops.length;
    const settled = __load.completedFrame !== null && __load.tops.length - __load.completedFrame >= 30;
    if (!settled && performance.now() - start < 30000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const note = () => { const summary = document.querySelector('#resultSummary'); if (summary) __load.summary.push([summary.textContent, cards()]); };
  document.addEventListener('DOMContentLoaded', () => { note(); const summary = document.querySelector('#resultSummary');
    if (summary) new MutationObserver(note).observe(summary, {childList: true, characterData: true, subtree: true}); }); })();"""
EXTRA_INIT = []  # seam for scratch negative tests; always empty in this file

network = Counter()
writes_blocked, api_aborted = [], []
api_live = 0
results = []

def route_guard(route, request):
    global api_live
    url = urlparse(request.url); host = (url.hostname or '').rstrip('.').lower()
    if GITHUB_HOST.search(host) and request.method != 'GET':
        network[f'{request.method} {host} (blocked)'] += 1
        writes_blocked.append(redact(f'{request.method} {host}{url.path}'))
        return route.abort()
    if host == 'api.github.com' and not LIVE_API:
        network[f'{request.method} {host} (answered locally)'] += 1
        if REF_LOOKUP.match(request.url):
            return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                 body='{"object":{"sha":"%s","type":"commit"}}' % FIXTURE_SHA)
        api_aborted.append(redact(url.path))
        return route.abort()
    if host == 'api.github.com':
        api_live += 1
    network[f'{request.method} {host}'] += 1
    return route.continue_()

def new_context(browser, viewport):
    context = browser.new_context(**VIEWPORTS[viewport])
    context.route('**/*', route_guard)  # installed before any navigation
    context.add_init_script(INIT)
    for script in EXTRA_INIT:
        context.add_init_script(script)
    context.set_default_timeout(20000)
    return context

def open_page(context, path=''):
    """Fresh page; returns (page, gallery document, page errors list)."""
    page = context.new_page(); errors = []
    page.on('pageerror', lambda e: errors.append('pageerror: ' + redact(e)[:200]))  # redact before slicing
    page.on('console', lambda m: m.type == 'error' and errors.append('console: ' + redact(m.text)[:200]))
    with page.expect_response(lambda r: r.url.endswith('/gallery.json'), timeout=30000) as info:
        page.goto(BASE_URL + path, wait_until='domcontentloaded')
    response = info.value
    if not LIVE_API:
        check(FIXTURE_SHA in response.url, 'gallery.json read at the pinned commit')
    page.wait_for_function("() => document.querySelectorAll('#gallery .cultivar-card').length || !document.querySelector('#emptyState').hidden")
    page.wait_for_function("() => document.body.getAttribute('aria-busy') !== 'true'")
    doc = response.json()
    check(len(doc['albums']) > 0 and cards(page) > 0, f'gallery has cultivars (data {len(doc["albums"])}, cards {cards(page)})')
    if PINNED:
        check(len(doc['albums']) == PINNED_CARDS, f'pinned fixture has {PINNED_CARDS} cultivars (got {len(doc["albums"])})')
    return page, doc, errors

class Failure(Exception):
    pass

def check(condition, message):
    if not condition:
        raise Failure(message)

def finish(page, errors):
    csp = page.evaluate('() => window.__csp')
    check(not csp, f'no CSP violations: {csp}')
    check(not errors, f'no page or console errors: {errors}')

def no_overflow(page, label):
    data = page.evaluate("""() => { const vw = document.documentElement.clientWidth; const wide = [...document.querySelectorAll('body *')]
        .filter(el => !el.closest('dialog:not([open]),[hidden]') && el.getBoundingClientRect().right > vw + 1)
        .slice(0, 4).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
        return {scrollWidth: document.documentElement.scrollWidth, clientWidth: vw, wide}; }""")
    check(data['scrollWidth'] <= data['clientWidth'], f'no horizontal overflow ({label}): scrollWidth {data["scrollWidth"]} > clientWidth {data["clientWidth"]}; wide: {data["wide"]}')

def cards(page):
    return page.locator('#gallery .cultivar-card').count()

def card_ids(page):
    return page.eval_on_selector_all('#gallery .cultivar-card', 'els => els.map(e => e.dataset.id)')

def active_open(page):
    return page.evaluate('() => document.activeElement?.dataset?.open || null')

def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text) if not unicodedata.combining(c)).lower()

# --- flows -------------------------------------------------------------------------------------

def flow_load(context, vp):
    page, doc, errors = open_page(context)
    total = len(doc['albums'])
    check(cards(page) == total, f'{total} cultivar cards rendered (got {cards(page)})')
    check(page.text_content('#headingCount') == str(total), 'collection heading count matches the data')
    if any(album['photos'] for album in doc['albums']):
        page.wait_for_function("() => { const i = document.querySelector('.hero-art img'); return i && i.complete && i.naturalWidth > 0; }")
    no_overflow(page, f'{vp} page')
    page.wait_for_timeout(300)  # a few more frames after the gallery settles
    record = page.evaluate('() => window.__load')
    tops = sorted({top for top, _ in record['tops']})
    check(any(n == 0 for _, n in record['tops']) and any(n > 0 for _, n in record['tops']), f'header sampled before and after the cards appeared ({len(record["tops"])} frames)')
    check(len(tops) == 1, f'header top stays constant during the cold load: {tops}')
    check(any(text == 'Loading the garden…' and n == 0 for text, n in record['summary']), f'#resultSummary announced loading before the cards: {record["summary"][:4]}')
    check(page.is_hidden('#storeStatus'), 'no status banner after a successful public load')
    finish(page, errors)

def flow_load_failure(context, vp):
    """The latest-commit lookup answers 500 (a stubbed GET; this page only): the status banner and "Reload the garden" appear."""
    page = context.new_page(); page_errors = []
    page.on('pageerror', lambda e: page_errors.append('pageerror: ' + redact(e)[:200]))  # redact before slicing
    page.route(REF_LOOKUP, lambda route, request: route.fulfill(status=500, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"message":"fixture failure"}')
               if request.method == 'GET' else route.fallback())  # non-GETs reach route_guard, which blocks and counts them
    page.goto(BASE_URL, wait_until='domcontentloaded')
    page.wait_for_selector('#reloadGallery', state='visible')
    state = page.evaluate("""() => ({banner: !document.querySelector('#storeStatus').hidden && document.querySelector('#storeStatus').getClientRects().length > 0,
        error: document.querySelector('#storeStatus').classList.contains('has-error'), message: document.querySelector('#storeMessage').textContent.trim().length > 0,
        reload: document.querySelector('#reloadGallery').textContent.trim(), emptyReload: !document.querySelector('#emptyReload').hidden,
        summary: document.querySelector('#resultSummary').textContent})""")
    check(state == {'banner': True, 'error': True, 'message': True, 'reload': 'Reload the garden', 'emptyReload': True, 'summary': 'The garden could not be loaded.'},
          f'a failed load shows the status banner with "Reload the garden": {state}')
    check(not page.evaluate('() => window.__csp'), 'no CSP violations')
    check(not page_errors, f'no page errors: {page_errors}')

def flow_search(context, vp):
    page, doc, errors = open_page(context)
    total = len(doc['albums'])
    chinese = next(((a, n) for a in doc['albums'] for n in a.get('chinese_name') or [] if isinstance(n, str) and n.strip()), None)
    check(chinese, 'fixture data has a Chinese alias to search')
    album, alias = chinese
    page.fill('#search', alias.strip())
    check(album['id'] in card_ids(page) and 0 < cards(page) < total, f'Chinese search "{alias}" narrows to its cultivar ({cards(page)} of {total})')
    accented = next((a for a in doc['albums'] if fold(a['name']) != a['name'].lower()), doc['albums'][0])
    query = fold(accented['name']).split()[0].split('-')[0]
    page.fill('#search', query)
    check(accented['id'] in card_ids(page) and 0 < cards(page) < total, f'accent-insensitive search "{query}" narrows to {accented["name"]} ({cards(page)} of {total})')
    if PINNED:
        page.fill('#search', 'sanpei')
        check(card_ids(page) == PINNED_SANPEI_IDS, f'search "sanpei" shows exactly {PINNED_SANPEI_IDS} (got {card_ids(page)})')
    page.fill('#search', 'zzqqxx-no-such-camellia')
    check(cards(page) == 0 and page.is_visible('#emptyState'), 'unmatched search shows the empty state')
    page.fill('#search', '')
    check(cards(page) == total, 'clearing the search restores every cultivar')
    finish(page, errors)

def flow_filters(context, vp):
    page, doc, errors = open_page(context)
    albums = doc['albums']; total = len(albums)
    page.click('.filter-toggle')
    check(page.get_attribute('.filter-toggle', 'aria-expanded') == 'true' and page.is_visible('#moreFilters'), 'Filters opens its panel')
    no_overflow(page, f'{vp} filters open')
    color = Counter(a.get('color') for a in albums if a.get('color') in ('pink', 'white', 'red', 'bicolor', 'yellow')).most_common(1)
    check(color or not PINNED, 'pinned fixture has a filterable colour')
    if color:
        page.select_option('#colorFilter', color[0][0])
        check(cards(page) == color[0][1], f'colour {color[0][0]} shows {color[0][1]} cultivars (got {cards(page)})')
        check(page.is_visible('#filterBadge'), 'active filter badge is shown')
    page.click('#resetFilters')
    check(cards(page) == total and not page.is_visible('#moreFilters') and not page.is_visible('#filterBadge'), 'Clear filters restores every cultivar and closes the panel')
    japonica = sum(a.get('species') == 'Japonica' for a in albums)
    check(japonica == PINNED_JAPONICA if PINNED else japonica > 0, f'fixture has Japonica cultivars ({japonica})')
    page.click('[data-category="Japonica"]')
    check(page.get_attribute('[data-category="Japonica"]', 'aria-pressed') == 'true' and cards(page) == japonica, f'Japonica tab shows {japonica} cultivars')
    page.click('[data-category="all"]')
    check(cards(page) == total, 'All species restores every cultivar')
    finish(page, errors)

def open_first_album(page, doc):
    card = page.locator('.card-open').first
    album_id = card.get_attribute('data-open')
    card.focus(); page.keyboard.press('Enter')
    page.wait_for_selector('#albumDialog[open]')
    album = next(a for a in doc['albums'] if a['id'] == album_id)
    check(page.text_content('#albumDialog h2') == (album.get('display_name') or album['name']), 'album shows the chosen cultivar')
    check(page.evaluate("() => !!document.activeElement.closest('#albumDialog')"), 'focus moves into the album')
    return album_id

def flow_album(context, vp):
    page, doc, errors = open_page(context)
    album_id = open_first_album(page, doc)
    no_overflow(page, f'{vp} album open')
    page.keyboard.press('Escape')
    check(not page.is_visible('#albumDialog'), 'Esc closes the album')
    check(active_open(page) == album_id, 'Esc returns focus to the album card')
    open_first_album(page, doc)
    page.focus('#albumDialog .album-close'); page.keyboard.press('Enter')
    check(not page.is_visible('#albumDialog'), 'Close button closes the album')
    check(active_open(page) == album_id, 'Close button returns focus to the album card')
    finish(page, errors)

ACTIVE = """() => { const a = document.activeElement; if (!a || a === document.body) return 'body';
    const classes = typeof a.className === 'string' ? a.className.trim().split(/\\s+/).filter(Boolean).map(c => '.' + c).join('') : '';
    return (a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + classes).replace(/\\s+/g, ' ').slice(0, 80); }"""  # single-line descriptor for messages

def flow_focus_reset(context, vp):
    """Keyboard focus stays on a stable control after "Clear filters" and "View all cultivars" hide the button that held it."""
    page, doc, errors = open_page(context)
    page.click('.filter-toggle'); page.select_option('#colorFilter', 'pink')
    page.focus('#resetFilters'); page.keyboard.press('Enter')
    check(page.evaluate("() => document.activeElement.matches('.filter-toggle')"), f'Clear filters moves focus to the Filters button (got {page.evaluate(ACTIVE)})')
    page.fill('#search', 'zzzz'); page.wait_for_selector('#emptyReset', state='visible')
    page.focus('#emptyReset'); page.keyboard.press('Enter')
    check(cards(page) == len(doc['albums']), 'View all cultivars restores every cultivar')
    check(page.evaluate("() => document.activeElement.id === 'collectionTitle'"), f'View all cultivars moves focus to the collection heading (got {page.evaluate(ACTIVE)})')
    finish(page, errors)

OUTSIDE_POINT = """() => { const r = document.querySelector('#albumDialog').getBoundingClientRect(), w = innerWidth, h = innerHeight;
    const candidates = [[r.left / 2, r.top + r.height / 2], [(r.right + w) / 2, r.top + r.height / 2], [r.left + r.width / 2, r.top / 2], [r.left + r.width / 2, (r.bottom + h) / 2]];
    const out = candidates.find(([x, y]) => (x < r.left || x > r.right || y < r.top || y > r.bottom) && x >= 0 && x < w && y >= 0 && y < h && document.elementFromPoint(x, y)?.id === 'albumDialog');
    return out ? {x: out[0], y: out[1], rect: [r.left, r.top, r.right, r.bottom].map(Math.round)} : {rect: [r.left, r.top, r.right, r.bottom].map(Math.round)}; }"""

def flow_album_dialog(context, vp):
    """The album dialog is named by its heading, opens on Close, ignores a text-selection drag onto the backdrop and closes on a backdrop press."""
    page, doc, errors = open_page(context)
    album_id = open_first_album(page, doc)
    name = page.text_content('#albumDialog h2')
    check(page.evaluate("() => document.activeElement.matches('#albumDialog .album-close')"), f'keyboard open focuses Close (got {page.evaluate(ACTIVE)})')
    labelled = page.evaluate("""() => { const d = document.querySelector('#albumDialog'); const ids = (d.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
        return {ariaLabel: d.getAttribute('aria-label'), name: ids.map(id => document.getElementById(id)?.textContent || '').join(' ').trim(), galleryLabel: document.querySelector('#gallery').getAttribute('aria-label')}; }""")
    check(labelled == {'ariaLabel': None, 'name': name, 'galleryLabel': None}, f'album dialog is named by its heading and #gallery is unnamed: {labelled} vs "{name}"')
    snapshot = page.locator('#albumDialog').aria_snapshot()
    check(snapshot.splitlines()[0].strip().startswith(f'- dialog "{name}"'), f'accessibility tree names the dialog "{name}": {snapshot.splitlines()[0][:120]}')
    point = page.evaluate(OUTSIDE_POINT)
    check('x' in point, f'a backdrop point exists outside the album ({vp}): {point}')
    for button in ('right', 'middle'):
        page.mouse.click(point['x'], point['y'], button=button); page.wait_for_timeout(150)
        check(page.is_visible('#albumDialog'), f'a {button}-button click on the backdrop keeps the album open ({point})')
    box = page.locator('#albumDialog .album-description').bounding_box()
    page.mouse.move(box['x'] + min(40, box['width'] / 2), box['y'] + min(10, box['height'] / 2)); page.mouse.down()
    page.mouse.move(point['x'], point['y'], steps=12); page.mouse.up(); page.wait_for_timeout(200)
    check(page.is_visible('#albumDialog'), f'a text-selection drag released on the backdrop keeps the album open ({point})')
    page.mouse.click(point['x'], point['y']); page.wait_for_timeout(200)
    check(not page.is_visible('#albumDialog'), f'a press and release on the backdrop close the album ({point})')
    check(active_open(page) == album_id, 'backdrop close returns focus to the album card')
    open_first_album(page, doc); page.keyboard.press('Escape')
    check(not page.is_visible('#albumDialog') and active_open(page) == album_id, 'Esc closes the album and returns focus to its card')
    if VIEWPORTS[vp].get('has_touch'):
        touch_tap_closes_cleanly(page, doc, vp)
    finish(page, errors)

def touch_tap_closes_cleanly(page, doc, vp):
    """A touch tap on the backdrop strip below the album closes it, and the tap's click must not reach the card underneath."""
    setup = page.evaluate("""() => { const cards = [...document.querySelectorAll('#gallery .card-open')]; const card = cards[Math.min(2, cards.length - 1)];
        scrollBy(0, card.getBoundingClientRect().top - (innerHeight - 140)); card.focus({preventScroll: true}); return card.dataset.open; }""")
    page.keyboard.press('Enter'); page.wait_for_selector('#albumDialog[open]')
    opened = page.text_content('#albumDialog h2')
    tap = page.evaluate("""() => { const r = document.querySelector('#albumDialog').getBoundingClientRect(), y = (r.bottom + innerHeight) / 2;
        const under = [...document.querySelectorAll('#gallery .card-open')].find(c => { const b = c.getBoundingClientRect(); return b.top < y && b.bottom > y && b.left >= r.left && b.right <= r.right; });
        const x = under ? (() => { const b = under.getBoundingClientRect(); return (b.left + b.right) / 2; })() : r.left + r.width / 2;
        window.__cardClicks = []; document.addEventListener('click', e => { const card = e.target.closest?.('.card-open'); if (card) __cardClicks.push(card.dataset.open); }, true);
        return {x, y, under: under?.dataset.open || null, top: document.elementFromPoint(x, y)?.id || null, rect: [r.left, r.top, r.right, r.bottom].map(Math.round)}; }""")
    check(tap['under'] and tap['top'] == 'albumDialog' and tap['y'] > tap['rect'][3], f'a card lies under the backdrop strip below the album ({vp}): {tap}')
    page.touchscreen.tap(tap['x'], tap['y']); page.wait_for_timeout(500)
    after = page.evaluate("""() => ({open: document.querySelector('#albumDialog').open, heading: document.querySelector('#albumDialog').open ? document.querySelector('#albumDialog h2')?.textContent : null,
        cardClicks: __cardClicks})""")
    check(not after['open'] and not after['cardClicks'], f'a backdrop tap closes "{opened}" without opening an album ({vp}, opener {setup}, card under tap {tap["under"]}): {after}')

def flow_fullscreen(context, vp):
    page, doc, errors = open_page(context)
    album_id = open_first_album(page, doc)
    page.focus('#albumDialog .photo-zoom'); page.keyboard.press('Enter')
    page.wait_for_selector('#lightbox[open]')
    page.wait_for_function("() => { const i = document.querySelector('#lightbox img'); return i && i.complete && i.naturalWidth > 0; }")
    page.keyboard.press('Escape')
    check(not page.is_visible('#lightbox') and page.is_visible('#albumDialog'), 'Esc leaves fullscreen and keeps the album open')
    check(page.evaluate("() => document.activeElement.matches('#albumDialog .photo-zoom')"), 'focus returns to the photograph')
    page.keyboard.press('Escape')
    check(active_open(page) == album_id, 'closing the album returns focus to its card')
    finish(page, errors)

def flow_overflow_320(context, vp):
    page, doc, errors = open_page(context)
    no_overflow(page, '320 page')
    page.click('.filter-toggle'); no_overflow(page, '320 filters open'); page.click('.filter-toggle')
    page.locator('.card-open').first.click(); page.wait_for_selector('#albumDialog[open]')
    no_overflow(page, '320 album open')
    finish(page, errors)

HERO_SAMPLES = 6
HERO_BOXES = """() => { const hero = document.querySelector('.hero').getBoundingClientRect(); const box = el => { const r = el.getBoundingClientRect(); return {x: r.left, y: r.top, r: r.right, b: r.bottom}; };
    const mark = document.querySelector('.hero-art > .photo-watermark'); const style = mark && getComputedStyle(mark);
    const others = [...document.querySelectorAll('.hero *')].filter(el => !el.closest('svg') && !el.matches('img, .hero-art, .hero-art-shade, .photo-watermark')
        && ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || el.matches('a, button, .round-arrow')))
      .filter(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width && r.height && s.display !== 'none' && s.visibility !== 'hidden'; })
      .map(el => ({name: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''), ...box(el)}));
    return {hero: box(document.querySelector('.hero')), mark: mark && {...box(mark), visible: style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0}, others,
      featured: document.querySelector('.hero-art').getAttribute('aria-label')}; }"""

LONG_WATERMARK = ('© ' + 'A very long garden watermark entered by the owner ' * 3)[:100]  # the settings field allows 100 characters

def watermark_problems(page, label):
    """Returns (data, [(tag, detail)]) for the hero watermark in the current layout; empty when it is visible, inside the hero and clear."""
    data = page.evaluate(HERO_BOXES); mark, hero = data['mark'], data['hero']
    check(data['others'], f'hero text and controls found ({label})')
    if not (mark and mark['visible'] and mark['r'] - mark['x'] > 0 and mark['b'] - mark['y'] > 0):
        return data, [('hidden', f'hero watermark is not visible ({label})')]
    problems = []
    if not (mark['x'] >= hero['x'] and mark['r'] <= hero['r'] and mark['y'] >= hero['y'] and mark['b'] <= hero['b']):
        problems.append(('outside', f'hero watermark lies outside the hero ({label})'))
    hits = [o['name'] for o in data['others'] if o['x'] < mark['r'] and mark['x'] < o['r'] and o['y'] < mark['b'] and mark['y'] < o['b']]
    if hits:
        problems.append(('overlap', f'hero watermark overlaps hero text or controls ({label}): {hits}'))
    return data, problems

HIT_TARGET = """() => { const link = document.querySelector('.hero-link'); const r = link.getBoundingClientRect(); const before = getComputedStyle(link, '::before');
    const extends_ = before.content !== 'none' && before.position === 'absolute';  // the ::before overlay enlarges the hit area around the link box
    const inset = extends_ ? Math.abs(parseFloat(before.top) || 0) : 0;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = (x, y) => !!document.elementFromPoint(x, y)?.closest('.hero-link');
    return {boxHeight: r.height, boxWidth: r.width, beforeTopInset: inset, height: r.height + 2 * inset, width: r.width,
            insideHits: {up: hit(cx, cy - 21.5), down: hit(cx, cy + 21.5), left: hit(cx - 21.5, cy), right: hit(cx + 21.5, cy)}}; }"""

def flow_hero(context, vp):
    """At every hero layout the watermark is visible, inside the hero and clear of all hero text and controls (also when the owner
    sets a 100-character watermark); on phones the "Explore the garden" hit area is at least 44x44."""
    page, doc, errors = open_page(context)
    page.wait_for_function("() => { const i = document.querySelector('.hero-art img'); return i && i.complete && document.querySelector('.hero-art > .photo-watermark'); }")
    problems, seen = [], set()  # (tag, detail)
    for sample in range(HERO_SAMPLES):  # the featured cultivar changes on each hero activation; the watermark must clear every layout
        data, found = watermark_problems(page, f'{vp}, {page.get_attribute(".hero-art", "aria-label")}'); seen.add(data['featured'])
        if found:
            problems += [('default-' + tag, detail) for tag, detail in found]; break
        if sample < HERO_SAMPLES - 1 and page.is_enabled('.hero-art'):
            page.focus('.hero-art'); page.keyboard.press('Enter')
            page.wait_for_function("(label) => document.querySelector('.hero-art').getAttribute('aria-label') !== label && document.querySelector('.hero-art img').complete", arg=data['featured'])
    if not problems:
        check(len(seen) >= min(2, sum(bool(a['photos']) for a in doc['albums'])), f'sampled {len(seen)} different featured cultivars')
    # Long watermark: injected into this test page only (the app renders the owner's text into these nodes).
    short_height = page.evaluate("() => document.querySelector('.hero-art > .photo-watermark').getBoundingClientRect().height")
    page.evaluate("text => document.querySelectorAll('.photo-watermark').forEach(el => { el.textContent = text; })", LONG_WATERMARK)
    data, found = watermark_problems(page, f'{vp}, {len(LONG_WATERMARK)}-character watermark')
    problems += [('long-' + tag, detail) for tag, detail in found]
    if not found and data['mark']['b'] - data['mark']['y'] > short_height + 0.5:
        problems.append(('long-wrap', f'{len(LONG_WATERMARK)}-character watermark wraps ({data["mark"]["b"] - data["mark"]["y"]:.1f}px tall, one line is {short_height:.1f}px)'))
    if vp in ('320', '390'):
        page.locator('.hero-link').scroll_into_view_if_needed()
        target = page.evaluate(HIT_TARGET)  # geometry is the threshold; probes 21.5px from the centre only confirm hit testing inside it
        if target['height'] < 44 or target['width'] < 44:
            problems.append(('hit-area', f'"Explore the garden" hit area is under 44x44: {target}'))
        elif not all(target['insideHits'].values()):
            problems.append(('hit-probe', f'"Explore the garden" does not receive taps inside its 44x44 area: {target}'))
    if problems:
        count = f'{len(problems)} problem' + ('' if len(problems) == 1 else 's')
        raise Failure('\n'.join([f'hero ({vp}): {count} [{", ".join(tag for tag, _ in problems)}]'] + [f'{tag}: {detail}' for tag, detail in problems]))
    finish(page, errors)

def flow_owner_gate(context, vp):
    check(OWNER, 'owner page found (OWNER_PATH or build-pages filename pattern)')
    page, doc, errors = open_page(context, OWNER)
    page.wait_for_selector('#loginDialog[open]')
    state = page.evaluate("""() => ({focusInLogin: !!document.activeElement.closest('#loginDialog'), tokenEmpty: document.querySelector('#githubToken').value === '',
        adminVisible: [...document.querySelectorAll('[data-admin]')].filter(e => !e.hidden && e.getClientRects().length).length,
        cardAdmin: document.querySelectorAll('.card-admin').length, badgeHidden: document.querySelector('#adminBadge').hidden, settingsHidden: document.querySelector('#siteSettings').hidden})""")
    check(state == {'focusInLogin': True, 'tokenEmpty': True, 'adminVisible': 0, 'cardAdmin': 0, 'badgeHidden': True, 'settingsHidden': True}, f'unauthenticated owner page is gated: {state}')
    check(page.evaluate("() => document.querySelector('#storeStatus')?.getAttribute('role') === 'status' && document.querySelector('#reloadGallery')?.textContent.trim() === 'Reload the garden'"),
          'owner page keeps the status banner and "Reload the garden" markup')
    finish(page, errors)

PLAN = [(vp, flow) for vp in ('390', '1440') for flow in (flow_load, flow_search, flow_filters, flow_album, flow_fullscreen, flow_focus_reset, flow_album_dialog)]
PLAN += [('390', flow_load_failure), ('1440', flow_load_failure), ('320', flow_overflow_320), ('390', flow_owner_gate)] + [(vp, flow_hero) for vp in ('320', '390', '581', '700', '768', '1024')]

def main():
    print(redact(f'smoke: {BROWSER} {BASE_URL} api={"LIVE" if LIVE_API else "stubbed@" + FIXTURE_SHA[:7]} pinned-counts={"on" if PINNED else "off"}'))
    with sync_playwright() as playwright:
        browser = getattr(playwright, BROWSER).launch()
        contexts = {}
        for vp, flow in PLAN:
            context = contexts.get(vp) or contexts.setdefault(vp, new_context(browser, vp))
            name = f'{flow.__name__[5:]}@{vp}'
            failed, lines = False, []
            try:
                flow(context, vp)
            except Exception as error:  # report and continue with the next flow
                failed = True
                lines = [line[:300] for line in redact(error).splitlines() if line.strip()] or [type(error).__name__]  # redact before truncating
            results.append((name, failed))
            print(f'  FAIL {name}: {lines[0]}' if failed else f'  ok   {name}')
            for line in lines[1:]:
                print(f'         {line}')
            for page in context.pages: page.close()
        browser.close()
    failed = [name for name, bad in results if bad]
    print(redact(f'requests by method/host: {dict(sorted(network.items()))}'))
    print(redact(f'api.github.com requests that reached the network: {api_live}; stubbed-API aborts: {len(api_aborted)} {api_aborted}'))
    print(redact(f'GitHub write attempts blocked: {len(writes_blocked)} {writes_blocked}'))
    guard_ok = not writes_blocked and (LIVE_API or api_live == 0)
    print(f'{len(results) - len(failed)} passed, {len(failed)} failed' + ('' if guard_ok else '; GitHub guard violated'))
    return 0 if not failed and guard_ok else 1

if __name__ == '__main__':
    sys.exit(main())
