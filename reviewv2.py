"""Review page format v2: renders content/reviews_v2/<slug>.json into reviews/<slug>.html.

Called from build.py (_write_editorial). Board numbers in the copy come only from the public board rows.
"""
import json, re, statistics
from html import escape


def E(s):
    return escape(str(s), quote=True)


TAG = {'Seller curated': 'seller', 'Seller claim': 'seller', 'Customer report': 'cust', 'Forum allegation': 'alleg',
       'Forum post': 'cust', 'Not found': 'none', 'Verified': 'ver'}


def board_stats(cappers):
    c = [x for x in cappers if (x.get('picks') or 0) >= 100 and x.get('win_pct') is not None]
    return {'established': str(len(c)), 'over60': str(sum(x['win_pct'] >= 60 for x in c)),
            'median_win': '%.1f' % statistics.median(x['win_pct'] for x in c)}


def fill(s, st):
    return re.sub(r'\{\{(\w+)\}\}', lambda m: st[m.group(1)], s)


def paras(items):
    return ''.join('<p>%s</p>' % E(x) for x in items)


def tag(kind):
    return '<span class="evt %s">%s</span>' % (TAG.get(kind.split(',')[0], 'seller'), E(kind))


def render(rev, st, names, document):
    url = 'https://handicapperwatchdog.com/reviews/%s.html' % rev['slug']
    src = rev['sources']
    ps = rev.get('pricing_source', 1)
    toc = [('answer', 'Short answer'), ('prices', 'Prices'), ('guarantee', 'Guarantee'), ('claims', 'Their claims'),
           ('record', 'Track record'), ('customers', 'What customers say'), ('conflicts', 'Conflicts of interest'),
           ('verdict', 'Strengths and concerns'), ('faq', 'FAQ'), ('sources', 'Sources')]
    legend = ('<div class="evlegend" aria-label="How to read the labels"><span class="evt ver">Verified</span> we checked it ourselves '
              '<span class="evt seller">Seller claim</span> the company says it <span class="evt cust">Customer report</span> a buyer says it '
              '<span class="evt alleg">Allegation</span> an unproven accusation by someone else</div>')
    glance = ''.join('<li><span>%s</span><b>%s</b></li>' % (E(k), E(v)) for k, v in rev['glance'])
    hero = ('<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Home</a><span aria-hidden="true">/</span>'
            '<a href="./">Reviews</a><span aria-hidden="true">/</span><span aria-current="page">%s</span></nav>'
            '<section class="edhero"><div class="herol"><div><p class="eyebrow">%s</p><h1>%s</h1><p class="lede">%s</p>'
            '<p class="byline">By the Handicapper Watchdog editorial desk · Checked %s · <a href="#standards">How we review</a></p></div>' + legend + '</div>'
            '<aside class="plate"><div class="seal" aria-hidden="true"><b>NV</b><span>%s</span></div>'
            '<p class="plate-k">Watchdog status</p><p class="plate-v">%s</p><p class="muted small">%s</p>'
            '<ul class="checks">%s</ul></aside></section>') % (
        E(rev['name']), E(rev['kind']), E(rev['h1']), E(rev['dek']), E(rev['checked']), E(rev['status']['label']),
        E(rev['status']['label']), E(rev['status']['note']), glance)
    answer = '<section class="panel edcard essay answer2" id="answer"><h2>Is %s legit?</h2><div class="prose">%s</div></section>' % (
        E(rev['name']), paras(rev['short_answer']))
    rows = ''.join('<tr><th scope="row">%s</th><td data-k="Packages">%s</td><td data-k="If it loses">%s</td></tr>' % tuple(E(x) for x in r) for r in rev['pricing'])
    prices = ('<section class="panel edcard" id="prices"><h2>What it costs</h2><p class="lede tight">%s %s</p>'
              '<div class="tw"><table class="ptab"><thead><tr><th class="l">Plan</th><th class="l">Packages</th><th class="l">If it loses</th></tr></thead>'
              '<tbody>%s</tbody></table></div><p class="muted small">Source: <a href="%s" rel="nofollow noopener">%s</a>, checked %s.</p></section>') % (
        tag('Verified'), E(rev['pricing_intro']), rows, E(src[ps]['url']), E(src[ps]['title']), E(src[ps]['accessed']))
    guar = '<section class="panel edcard essay" id="guarantee"><h2>How the guarantee really works</h2><div class="prose">%s</div></section>' % paras(rev['guarantee'])
    crow = ''.join('<li><div>%s%s</div><span class="muted small">%s</span></li>' % (tag(c['status']), ('<q>%s</q>' % E(c['claim'][1:-1])) if c['claim'].count('"') == 2 and c['claim'].startswith('"') else '<p class="cq">%s</p>' % E(c['claim']), E(c['where'])) for c in rev['claims'])
    claims = ('<section class="panel edcard" id="claims"><h2>What they advertise</h2><p class="lede tight">Quoted from %s pages on %s. '
              'A quote here is not a finding that it is true.</p><ul class="claims">%s</ul><div class="prose">%s</div></section>') % (
        E(rev['name']), E(rev['checked']), crow, paras(rev['claims_note']))
    od = rev['our_data']
    record = ('<section class="panel edcard essay" id="record"><h2>Track record: what can be verified</h2><div class="prose">%s'
              '<div class="ourdata"><p class="plate-k">Watchdog graded data</p><p><b>%s</b></p><p>%s</p></div></div></section>') % (
        paras(rev['record']), E(od['text']), E(fill(od['context'], st)))
    cust = ''.join('<li class="cr %s"><div class="crh">%s<span class="muted small">%s</span></div><p>%s</p>%s</li>' % (
        't-neg' if c['tone'] == 'Negative' else 't-pos' if c['tone'] == 'Positive' else 't-neu', tag(c['type']), E(c['date']), E(c['text']),
        '<p class="small"><a href="%s" rel="nofollow noopener">%s</a></p>' % (E(src[c['source']]['url']), E(src[c['source']]['title'])) if c['source'] is not None else '')
        for c in rev['customers'])
    customers = ('<section class="panel edcard" id="customers"><h2>What customers say</h2><p class="lede tight">%s</p><ul class="crs">%s</ul>'
                 '<p class="muted small">We never write, buy or edit testimonials. Allegations are reported as allegations, with the date and a link, and are not repeated as fact.</p></section>') % (
        E(rev['customers_intro']), cust)
    conf = '<section class="panel edcard essay" id="conflicts"><h2>Conflicts of interest</h2><div class="prose">%s</div></section>' % paras(rev['conflicts'])
    verdict = ('<section class="split" id="verdict"><div class="edsec good"><h2>Strengths</h2><ul>%s</ul></div>'
               '<div class="edsec bad"><h2>Concerns</h2><ul>%s</ul></div></section>') % (
        ''.join('<li>%s</li>' % E(x) for x in rev['strengths']), ''.join('<li>%s</li>' % E(x) for x in rev['concerns']))
    check = ('<section class="panel edcard probox"><h2>Before you pay any handicapper</h2><ol class="chk">%s</ol>'
             '<div class="procta"><div><p class="plate-k">Watchdog Pro</p><p><b>Graded records you can check before you buy.</b> Watchdog captures public picks before the game starts '
             'and grades every one. Free profiles show the record; Pro opens full pick logs and eligible pending picks.</p></div>'
             '<a class="btn pro" href="../pricing.html">See Watchdog Pro</a></div>'
             '<p class="small"><a href="../cappers.html">Browse graded records free</a> · <a href="../learn/scam-handicapper-red-flags.html">Scam red flags</a> · '
             '<a href="../learn/break-even-win-rate.html">Break even win rates</a></p></section>') % ''.join('<li>%s</li>' % E(x) for x in rev['checklist'])
    faq = '<section class="panel edcard" id="faq"><h2>Common questions</h2><div class="faqs">%s</div></section>' % ''.join(
        '<details class="faq" open><summary>%s</summary><p>%s</p></details>' % (E(q), E(a)) for q, a in rev['faq'])
    rel = '<section class="edsec"><h2>Related reviews</h2><div class="relrow">%s</div></section>' % ''.join(
        '<a class="rel" href="%s.html"><span>Review</span><b>%s</b></a>' % (s, E(names.get(s, s))) for s in rev['related'])
    sources = ('<section class="panel edcard srcpanel" id="sources"><h2>Sources</h2><ol class="src">%s</ol></section>') % ''.join(
        '<li><a href="%s" rel="nofollow noopener">%s</a> <span class="muted small">accessed %s</span></li>' % (E(s['url']), E(s['title']), E(s['accessed'])) for s in src)
    standards = ('<section class="panel edcard" id="standards"><h2>How we review, corrections and right of reply</h2><div class="prose">'
                 '<p>Every fact on this page comes from a page we opened on the date shown, and each source is linked. We label each statement as verified, a seller claim, a customer report or an allegation. We do not accept payment, affiliate fees or free picks from the services we review.</p>'
                 '<p>%s can reply. If something here is wrong or out of date, send the page that shows otherwise through our <a href="../contact.html">contact page</a>. We correct errors, note the change and its date on this page, and publish a fair summary of any reply. Last updated %s.</p>'
                 '</div></section>') % (E(rev['name']), E(rev['checked']))
    side = ('<aside class="rside"><nav class="rtoc" aria-label="On this page"><p class="plate-k">On this page</p>%s</nav>'
            '<div class="sidepro"><p class="plate-k">Watchdog Pro</p><p>Graded records captured before the game starts. Check a handicapper before you pay one.</p>'
            '<a class="btn pro" href="../pricing.html">See Watchdog Pro</a></div></aside>') % ''.join('<a href="#%s">%s</a>' % (a, E(b)) for a, b in toc)
    body = hero + '<div class="rlayout">' + side + '<article class="rmain">' + answer + prices + guar + claims + record + customers + conf + verdict + check + faq + rel + sources + standards + '</article></div>'
    org = {'@type': 'Organization', 'name': 'Handicapper Watchdog', 'url': 'https://handicapperwatchdog.com/'}
    ld = {'@context': 'https://schema.org', '@graph': [
        {'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Home', 'item': 'https://handicapperwatchdog.com/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Reviews', 'item': 'https://handicapperwatchdog.com/reviews/'},
            {'@type': 'ListItem', 'position': 3, 'name': rev['name'], 'item': url}]},
        {'@type': 'Article', 'headline': rev['title'], 'description': rev['description'], 'url': url, 'mainEntityOfPage': url,
         'datePublished': rev['checked_iso'], 'dateModified': rev['updated_iso'], 'author': org, 'publisher': org,
         'about': {'@type': 'Organization', 'name': rev['name'], 'legalName': rev.get('legal_name')}}]}
    html = document(1, 'reviews/index.html', rev['title'], rev['description'], url, body)
    html = html.replace('</head>', '<link rel="stylesheet" href="../review2.css">\n<script type="application/ld+json">%s</script>\n</head>' % (
        json.dumps(ld, ensure_ascii=True).replace('<', '\\u003c')), 1)
    return html


