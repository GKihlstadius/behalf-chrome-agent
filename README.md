# behalf

**[behalf-cli.vercel.app](https://behalf-cli.vercel.app)**

Your agent has eyes. This gives it hands, in the browser you are already
signed in to.

```sh
behalf start 90                 # random port, closes itself after 90 minutes
behalf open app.example.com
behalf wait "Dashboard"
behalf click "New invoice"
behalf stop                     # closes the port. Do this.
```

No API keys. No sandbox browser that knows nothing about you. No screenshot
guessing. Nineteen commands your agent already knows how to run, in the session
where you are already authenticated.

## Install

```sh
git clone https://github.com/GKihlstadius/behalf
cd behalf && ./install.sh
```

Node 22 or newer and Google Chrome. macOS, Linux and Windows. No dependencies,
no build step, nothing downloaded at install time. 681 lines of plain JavaScript
you can read in an evening.

Then copy the one small file your agent host needs from [`adapters/`](adapters/).

## The part that actually matters

**[Read the FIELD MANUAL.](FIELD-MANUAL.md)**

The commands take five minutes to learn. The manual is the part that took a
week, because driving a real browser is not hard until it is:

- Two ways to click, and no rule about which one works. An old government portal
  ignored DOM clicks entirely. A modern accounting app did the exact opposite.
- Business apps that render everything inside an iframe, where `read` sees the
  text but `click` finds nothing.
- Portals built from web components that return an empty document while
  displaying a full form.
- Downloads that silently do nothing because you set the behaviour on the page
  instead of the browser.
- Uploads that succeed while nothing has actually been submitted.

## One finding worth your time even if you never install this

**Chrome silently drops synthetic mouse clicks into a page it considers
unfocused.**

Your terminal has the OS focus, not the browser. After the first navigation the
renderer decides the page is unfocused, and every real mouse click is swallowed.
No error is raised. Not from CDP, not from Chrome, not in the console. Your tool
reports a successful click at coordinates that are provably correct, and nothing
happens.

The first click of a session works, which is what makes this so expensive: it
looks like an intermittent bug in your own code. We measured the coordinates
against the actual element three separate times before accepting they were right
all along.

`Page.bringToFront` does not fix it. `Input.setIgnoreInputEvents` does not fix
it. This does:

```js
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
```

Send it when you attach. The effect lasts the session. If you are writing your
own CDP code, this one line will save you an afternoon.

## Security

CDP has no authentication. Any process running as your user can connect to an
open port and act as you in every site you are signed in to. That is true of
every tool in this category, including this one.

behalf makes the window small and explicit rather than pretending otherwise:

- Random port on every start, bound to `127.0.0.1` only
- A separate Chrome profile, so your everyday browser is untouched
- `behalf stop` closes the port and nothing keeps running
- `behalf start 90` shuts itself down if you walk away and forget

**Close it when you are done.** An open control port is an open bank window.

## Tests

```sh
test/run.sh                 # 51 checks against a real Chrome and a local fixture
node --test test/unit.mjs   # the parts that differ per operating system
```

They use their own browser profile and their own state directory, so they are
safe to run while you are working.

## Honest comparison

This is a small tool in a crowded field, and most of the field is free:

| | What it is | Licence |
|---|---|---|
| [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Google's MCP server, 29 tools, connects to your running Chrome | Apache-2.0 |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | Vercel's Rust CLI, 50+ commands, `--cdp` to an existing browser | Apache-2.0 |
| Playwright MCP | Microsoft, full browser automation | Apache-2.0 |
| behalf | 19 commands, a command line, and a field manual | MIT |

Use whichever fits. Two reasons you might want this one:

**Context cost.** An MCP server loads its tool schemas into the model's context
on every request. chrome-devtools-mcp declares 29 tools, which measures 23,244
characters of JSON schema, roughly 6,600 tokens, paid on every message whether or
not the browser is involved. behalf costs one rule file of about 400 tokens,
because the model calls it the way it calls `git`. That is roughly seventeen
times less context left for the actual work.

**It is small enough to read.** When a tool can act as you in your bank, being
able to read all of it in an evening is a feature.

## Licence

MIT. Use it, change it, ship it.

## Support

behalf is free and staying that way. Nothing is gated. If it saved you an
afternoon, there is a coffee fund.

```
Bitcoin           bc1qf0aw36judg5qzjrf365rp9nq04nav5da8jjxzx
Ethereum ERC-20   0x9869799157186227bA3Cc980bAE3C64E022453a0
BNB Chain BEP-20  0x9869799157186227bA3Cc980bAE3C64E022453a0
Solana            DZ8Sh5rXDsnFL9G6WUYuJ6dELyHzKByWxKurGLY5Pt22
```

Ethereum and BNB Smart Chain share one address but are separate networks. Send
on the network you picked, or the funds are gone.
