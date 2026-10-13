# EcoCoach fund price lookup

Every complete valuation checks the public EcoCoach BlackRock fund page first:
`https://ecocoach.net/blackrock-index`. This route was identified in the site's
public router and independently fetched on 2026-10-13. The homepage and fund
page returned HTTP 200. The fund page describes its composition and historical
return chart; navigation labels say **به زودی**. It currently publishes no
per-unit price, currency-labelled NAV or quote timestamp. Those marketing/chart
figures must not become the user's fund price.

The adapter accepts only an explicit per-unit quote in a table whose caption
identifies this EcoCoach fund, with a rial/toman currency and a timezone-bearing
quote timestamp in the same table. Quotes older than 24 hours, future/ambiguous
quotes, simulated/example data, total NAV, missing units and foreign BlackRock
instruments are rejected. The successful result retains source URL, unit,
source timestamp and retrieval timestamp. A valid website quote is used before
any supplied manual fallback and is included exactly once in valuation.

The accepted quote-table cases are synthetic regression fixtures; no live price
is claimed to have been extracted from today's page. An unknown future website
format fails closed and needs a reviewed adapter update. Public requests use
HTTPS, no authentication or cache, an eight-second timeout, a one-megabyte
response limit, and reject redirects. No credentials or login session are sent
to EcoCoach. Category commands that do not contain the fund skip this lookup.

When the site is unreachable or provides no reliable quote, the existing admin
manual-price flow remains available. Guests never receive that price/quantity
prompt: the bot sends it to current admins privately, scopes the entered price
to the awaiting request, performs another fresh OneDrive read and delivers the
guest's chart without total valuation or notes. The owner's six manual holdings
and OneDrive workbook remain unchanged.

Cloud development networking requires `ecocoach.net` and `www.ecocoach.net` in
the allowlist. Both were added to the saved environment draft; actual HTTPS
fetches of the homepage, published app scripts and fund page succeeded. This
proves read access and unavailable-price fallback, not a successful live quote.
