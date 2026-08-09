# behalf, field manual

Your agent has eyes. This gives it hands, in the browser you are already
signed in to.

    behalf start 90                 # random port, auto-closes after 90 minutes
    behalf open app.example.com
    behalf wait "Dashboard"
    behalf click "New invoice"
    behalf stop                     # closes the port. Do this.

## Install

    ./install.sh

Requires Node 22 or newer and Google Chrome. Nothing is downloaded, nothing is
compiled, no dependencies are installed. macOS, Linux and Windows.

Chrome is found automatically in the usual places. If yours lives somewhere
unusual, set `BEHALF_CHROME` to the binary. `BEHALF_PROFILE` picks a different
browser profile, and `BEHALF_DIR` moves where behalf keeps its own state, which
is useful when you want two independent browsers side by side.

Run `behalf doctor` if anything behaves oddly. It checks the platform, the Node
version, Chrome, the profile, the port file, whether Chrome answers, and whether
the port is bound to loopback only.

`test/run.sh` drives the whole tool against a local fixture and cleans up after
itself. It is safe to run while you are working, because it uses its own profile
and its own state directory. `node --test test/unit.mjs` covers the parts that
differ per operating system.

## Commands

    behalf doctor                    diagnose the setup
    behalf status                    port, browser version, tab count
    behalf tabs                      list tabs
    behalf frames                    list iframes and which are reachable
    behalf open <url> [ms]           navigate and wait
    behalf read [max]                page text, shadow DOM aware
    behalf wait <text> [--gone]      wait for state, not for time
    behalf links [filter]            links and buttons
    behalf fields                    form fields with names and values
    behalf click <text> [--mouse]    click by text
    behalf click-xy <x> <y>          click a coordinate
    behalf type-xy <x> <y> <text>    click a coordinate and type [--clear]
    behalf fill <name> <value>       fill a field
    behalf eval <expression>         run JS, return the value
    behalf shot [file]               screenshot
    behalf pdf [file]                page as PDF
    behalf upload <field> <file...>  attach files to a file input
    behalf lease claim|release|list  coordinate several agent sessions

Flags: `--tab <substring>` picks a tab by url or title. `--frame <substring>`
works inside an iframe, `*` takes the first reachable one. `--timeout <ms>`
for `wait`, default 15000.

## Wait for state, not for time

    behalf wait "Receipt"
    found after 412 ms

Every `sleep 6` in a script is a race waiting to be lost. Too short and it
breaks, too long and you burn minutes. `wait` polls until the text appears and
tells you how long it took. `--gone` waits for it to disappear.

This is the single most useful command in the set. Use it after every action
that changes the page.

## Clicking, and why there are two ways

Try `behalf click "Save"` first. It sends a DOM click, which is cheap and works
on most modern web apps.

If nothing happens, add `--mouse`. That scrolls the element into view with
`DOM.scrollIntoViewIfNeeded`, reads its position with `DOM.getBoxModel` (which
translates iframe offsets for you), and dispatches real mouse events through the
browser's input layer.

**There is no rule about which one wins.** A Swedish government portal built on
old server-rendered JSP ignored DOM clicks entirely and needed real mouse events.
A modern accounting web app did the exact opposite: real mouse clicks on verified
correct coordinates did nothing, while a DOM click on the same element worked
instantly. Try the cheap one, then the other.

If neither works the element is probably inside a sandboxed iframe that
JavaScript cannot reach, for example Microsoft Entra. Take a screenshot, work out
the coordinate, and use `click-xy` or `type-xy`. Those go through the browser's
input layer and land inside any frame.

## The silent trap under real mouse clicks

Chrome drops synthetic mouse input into a page it considers unfocused. Your
terminal has the OS focus, not the browser, so after the first navigation the
renderer decides the page is not focused and every real mouse click is swallowed.

No error is raised. Not from CDP, not from Chrome, not in the console. The
command reports a successful click at coordinates that are provably correct, and
nothing happens. The first click of a session works, which is what makes this so
expensive: it looks like an intermittent fault in your script.

behalf turns on `Emulation.setFocusEmulationEnabled` on every connection, so the
renderer always treats the page as focused. If you write your own CDP code,
send that before you dispatch input, or you will spend an afternoon measuring
coordinates that were right the whole time.

## Iframes

Many business apps render everything inside an iframe. `read` sees the text
because it drills through, but `click`, `fill` and `fields` will find nothing.

    behalf frames
      34 chars of text   [app] about:blank

    behalf fields --frame '*'
    behalf click "Import" --frame '*'

`--frame` matches on the iframe's src or name. `*` takes the first same-origin
frame with content. Cross-origin frames cannot be reached from JavaScript at all,
which is what `frames` tells you before you waste time.

## Shadow DOM

Portals built from web components return almost nothing from
`document.body.innerText`. A Swedish tax authority page returned the single
phrase "Start of e-service" while displaying a full form.

`read` and `links` drill through shadow roots automatically. When a page looks
empty but clearly is not, take a screenshot rather than trusting the text.

## Downloads

Set the download behaviour at browser level, not page level. Page level does not
cover iframe contexts, which is why downloads triggered inside an embedded app
appear to do nothing at all.

Some CDNs reject Node's default user agent with 403. If you fetch a result URL
by hand, send a real browser user agent.

## Uploading files

    behalf upload sieFile report.se --frame '*'

Filenames can matter more than you expect. One government upload required two
files where the first contained a line naming the second **by exact filename**.
Renaming either one made the upload fail with no useful error.

## Uploading is not submitting

Both authorities we tested against accept a file, show a receipt for the
transfer, and then wait for a separate signature before anything is actually
filed. If your workflow ends when the upload succeeds, nothing has been
submitted.

Read the confirmation text. Look for a second step.

## Several agents, one browser

The controlled profile supports one Chrome instance, so parallel agent sessions
share it. Without coordination one session runs `stop` in the middle of
another's work, or navigates away from its tab.

    behalf lease claim my-session
    behalf lease release my-session

Leases older than four hours are cleared automatically so a crashed session
cannot block the browser forever.

## Security, read this part

CDP has no authentication. Any process running as your user can connect to an
open port and act as you in every site you are signed in to.

behalf makes that window small and explicit:

- The port is random on every start and bound to 127.0.0.1 only
- A separate Chrome profile, so your everyday browser is untouched
- `behalf stop` closes the port, and nothing keeps running
- `behalf start 90` shuts itself down after ninety minutes if you forget

**Close it when you are done.** An open control port is an open bank window.

Google blocks OAuth sign-in in debug-controlled browsers, so Google logins need
your own clicks. Sign in once, then let behalf work in the session.

## Why a command line and not an MCP server

An MCP server loads its tool schemas into the model's context on every single
request. Google's chrome-devtools-mcp declares 29 tools, which is 23,244
characters of JSON schema, roughly 6,600 tokens. You pay that on every message
in the conversation, whether or not the browser is involved.

behalf costs one small rule file, about 390 tokens, and the model calls it the
way it calls `git` or `curl`. That is roughly seventeen times less context, kept
free for the actual work.

The other reason is reach. An MCP server works where MCP works. A command line
works in every agent that can run a shell command, which today is all of them.

## Adapters

`adapters/` contains the small file each host needs so your agent knows the tool
exists. Copy the one you use:

    claude-code/    a rule file loaded in every session
    codex/          an AGENTS.md section
    cursor/         a .cursorrules section
    zed/            a .rules section

They are twenty lines each. The tool itself is host agnostic, because it is a
command line.

## When something fails

Run the script by hand first. Then run it with a stripped environment,
`env -i HOME=$HOME PATH=/usr/bin:/bin`, because hooks and launchers get a
different PATH. Check the configuration last.

Twice now the script was never the problem.
