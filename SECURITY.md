# Security

behalf drives a browser that is signed in as you. That is the point, and it is
also the risk. This document says exactly what it does and does not do, so you
can decide whether that trade is one you want.

## What the tool does

- Opens Chrome on a **random port**, bound to `127.0.0.1` only, never the network
- Uses a **separate Chrome profile** (`~/.behalf-chrome`), so your everyday browser is untouched
- Writes the port and pid files with mode `0600`
- `behalf stop` closes the port. Nothing keeps running
- `behalf start 90` shuts itself down after the time you gave it, in case you walk away

## What the tool does not do

- **No network calls except to `127.0.0.1`.** Read `bin/` and check. There are four
  `fetch` calls and every one of them goes to the local browser
- **No logs.** Nothing is written about what you visited or what was on the page
- **No telemetry, no analytics, no update check**
- Screenshots and PDFs default into `~/.behalf` with mode `0600`, not `/tmp`,
  because a screenshot of a signed-in page is as sensitive as the session itself
  and `/tmp` is readable by every user on the machine

## The part you cannot engineer away

**The Chrome DevTools Protocol has no authentication.** While the port is open,
any process running as your user can connect to it and act as you in every site
that profile is signed into.

behalf makes that window small, random and explicit. It cannot make it safe.
Close it when you are done.

We deliberately do **not** pass `--remote-allow-origins=*`. That flag disables
Chrome's origin check on the debugging socket, which is what stops a web page
from opening a connection to your control port. Some tooling sets it for
convenience. This does not.

## Reporting a vulnerability

Open a [security advisory](https://github.com/GKihlstadius/behalf-chrome-agent/security/advisories/new)
rather than a public issue, and give it a few days before disclosing.

If you find that behalf sends anything anywhere, or writes something readable it
should not, that is the highest severity thing you can report and it will be
fixed immediately.
