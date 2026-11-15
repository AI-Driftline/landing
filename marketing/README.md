# Marketing queue

Posts in this folder are approved: anything merged into `main` goes out on its own, on a schedule.
`tools/marketing.mjs` (run by the `update` workflow every 6 hours) decides when.

| What | When (UTC, first run from 12:00) | Source |
|---|---|---|
| X post | Monday, Wednesday, Friday | `x.json`, top to bottom |
| Blog article (+ dev.to draft + an X post announcing it) | 1st and 3rd Tuesday | `blog/*.json`, by `order`, then file name |

These come on top of the automatic retirement alerts (`tools/x-feed.mjs`, `tools/articles.mjs`).

## X posts (`x.json`)

`{ "id": "unique-id", "text": "..." }`. Max 280 characters; a link counts as 23. Numbers that change come from the
registry when the post goes out, so they are never stale:

`{total}` model IDs tracked · `{retiring30}` / `{retiring90}` retiring in the next 30 / 90 days ·
`{next_id}`, `{next_date}`, `{next_days}` the next fixed retirement.

A post whose number has no value that day waits until it has one. Never reuse an `id`: posted ids are in
`feed/marketing.json`.

## Blog articles (`blog/<slug>.json`)

The file name is the URL (`/blog/<slug>/`). Fields: `order`, `title`, `short`, `description`, `tags` (max 4, for
dev.to), `blocks`. A block is one of `{ "p": "..." }` (add `"answer": true` to the first one), `{ "h2": "..." }`,
`{ "h3": "..." }`, `{ "ul": ["...", "..."] }`, `{ "code": "..." }`, `{ "table": [["head", ...], ["cell", ...]] }`.
Inline: `` `code` ``, `**bold**`, `[text](/path or https://...)`.

## Rules for writing them

- Facts only: features that exist, numbers from tokens, quotes from the providers' own pages. No invented users,
  sales or testimonials.
- Plain and direct (see Mirza's writing rules): no hype words, no "not just X, it's Y".
- The monthly routine adds about 13 X posts and 2 articles as one pull request. Merging it approves them.
