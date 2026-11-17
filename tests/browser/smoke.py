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
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:8770/').rstrip('/') + '/'
BROWSER = os.environ.get('TEST_BROWSER', 'chromium')
FIXTURE_SHA = os.environ.get('FIXTURE_SHA', 'd13f0f5eae0fab47781668ae58b4f8fb2d6845c3')
LIVE_API = os.environ.get('LIVE_API') == '1'
ROOT = Path(__file__).resolve().parents[2]
GITHUB_HOST = re.compile(r'(^|\.)(github\.com|githubusercontent\.com|github\.io)$')
REF_LOOKUP = re.compile(r'^https://api\.github\.com/repos/[^/]+/[^/]+/git/ref/heads/')
VIEWPORTS = {
    '390': dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True),
    '1440': dict(viewport={'width': 1440, 'height': 900}),
    '320': dict(viewport={'width': 320, 'height': 640}, device_scale_factor=2, is_mobile=True, has_touch=True),
}
INIT = """window.__csp = [];
document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));"""
EXTRA_INIT = []  # seam for scratch negative tests; always empty in this file

network = Counter()
writes_blocked, api_aborted = [], []
api_live = 0
results = []

def route_guard(route, request):
    global api_live
    url = urlparse(request.url); host = url.hostname or ''
    if GITHUB_HOST.search(host) and request.method != 'GET':
        network[f'{request.method} {host} (blocked)'] += 1
        writes_blocked.append(f'{request.method} {host}{url.path}')
        return route.abort()
    if host == 'api.github.com' and not LIVE_API:
        network[f'{request.method} {host} (answered locally)'] += 1
        if REF_LOOKUP.match(request.url):
            return route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'},
                                 body='{"object":{"sha":"%s","type":"commit"}}' % FIXTURE_SHA)
        api_aborted.append(url.path)
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
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)[:200]))
    page.on('console', lambda m: m.type == 'error' and errors.append('console: ' + m.text[:200]))
    with page.expect_response(lambda r: r.url.endswith('/gallery.json'), timeout=30000) as info:
        page.goto(BASE_URL + path, wait_until='domcontentloaded')
    response = info.value
    if not LIVE_API:
        check(FIXTURE_SHA in response.url, 'gallery.json read at the pinned commit')
    page.wait_for_function("() => document.querySelectorAll('#gallery .cultivar-card').length || !document.querySelector('#emptyState').hidden")
    page.wait_for_function("() => document.body.getAttribute('aria-busy') !== 'true'")
    return page, response.json(), errors

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
    finish(page, errors)

def flow_search(context, vp):
    page, doc, errors = open_page(context)
    total = len(doc['albums'])
    chinese = next(((a, n) for a in doc['albums'] for n in a.get('chinese_name') or [] if isinstance(n, str) and n.strip()), None)
    check(chinese, 'fixture data has a Chinese alias to search')
    album, alias = chinese
    page.fill('#search', alias.strip())
    check(album['id'] in card_ids(page), f'Chinese search "{alias}" shows its cultivar')
    accented = next((a for a in doc['albums'] if fold(a['name']) != a['name'].lower()), doc['albums'][0])
    query = fold(accented['name']).split()[0].split('-')[0]
    page.fill('#search', query)
    check(accented['id'] in card_ids(page), f'accent-insensitive search "{query}" shows {accented["name"]}')
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
    if color:
        page.select_option('#colorFilter', color[0][0])
        check(cards(page) == color[0][1], f'colour {color[0][0]} shows {color[0][1]} cultivars (got {cards(page)})')
        check(page.is_visible('#filterBadge'), 'active filter badge is shown')
    page.click('#resetFilters')
    check(cards(page) == total and not page.is_visible('#moreFilters') and not page.is_visible('#filterBadge'), 'Clear filters restores every cultivar and closes the panel')
    japonica = sum(a.get('species') == 'Japonica' for a in albums)
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

def flow_owner_gate(context, vp):
    owner = os.environ.get('OWNER_PATH') or next((p.name for p in sorted(ROOT.glob('*.html')) if re.fullmatch(r'studio-[a-f0-9]{12}\.html', p.name)), None)
    check(owner, 'owner page found (OWNER_PATH or build-pages filename pattern)')
    page, doc, errors = open_page(context, owner)
    page.wait_for_selector('#loginDialog[open]')
    state = page.evaluate("""() => ({focusInLogin: !!document.activeElement.closest('#loginDialog'), tokenEmpty: document.querySelector('#githubToken').value === '',
        adminVisible: [...document.querySelectorAll('[data-admin]')].filter(e => !e.hidden && e.getClientRects().length).length,
        cardAdmin: document.querySelectorAll('.card-admin').length, badgeHidden: document.querySelector('#adminBadge').hidden, settingsHidden: document.querySelector('#siteSettings').hidden})""")
    check(state == {'focusInLogin': True, 'tokenEmpty': True, 'adminVisible': 0, 'cardAdmin': 0, 'badgeHidden': True, 'settingsHidden': True}, f'unauthenticated owner page is gated: {state}')
    finish(page, errors)

PLAN = [(vp, flow) for vp in ('390', '1440') for flow in (flow_load, flow_search, flow_filters, flow_album, flow_fullscreen)]
PLAN += [('320', flow_overflow_320), ('390', flow_owner_gate)]

def main():
    print(f'smoke: {BROWSER} {BASE_URL} api={"LIVE" if LIVE_API else "stubbed@" + FIXTURE_SHA[:7]}')
    with sync_playwright() as playwright:
        browser = getattr(playwright, BROWSER).launch()
        contexts = {}
        for vp, flow in PLAN:
            context = contexts.get(vp) or contexts.setdefault(vp, new_context(browser, vp))
            name = f'{flow.__name__[5:]}@{vp}'
            try:
                flow(context, vp); results.append((name, None)); print(f'  ok   {name}')
            except Exception as error:  # report and continue with the next flow
                message = str(error).splitlines()[0][:300]
                results.append((name, message)); print(f'  FAIL {name}: {message}')
            finally:
                for page in context.pages: page.close()
        browser.close()
    failed = [r for r in results if r[1]]
    print('requests by method/host:', dict(sorted(network.items())))
    print(f'api.github.com requests that reached the network: {api_live}; stubbed-API aborts: {len(api_aborted)}')
    print(f'GitHub write attempts blocked: {len(writes_blocked)} {writes_blocked}')
    guard_ok = not writes_blocked and (LIVE_API or api_live == 0)
    print(f'{len(results) - len(failed)} passed, {len(failed)} failed' + ('' if guard_ok else '; GitHub guard violated'))
    return 0 if not failed and guard_ok else 1

if __name__ == '__main__':
    sys.exit(main())
