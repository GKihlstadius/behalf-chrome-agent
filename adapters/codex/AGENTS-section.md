## behalf


The browser you are already signed in to is available to you as a command line.

    behalf start 90                  start it, auto-closes after 90 minutes
    behalf doctor                    diagnose if anything is wrong
    behalf frames                    list iframes and which are reachable
    behalf open <url> [ms]           navigate
    behalf read [max]                page text, shadow DOM aware
    behalf wait <text> [--gone]      wait for state, never sleep a fixed time
    behalf links [filter]            links and buttons
    behalf fields                    form fields
    behalf click <text> [--mouse]    click by text
    behalf fill <name> <value>       fill a field
    behalf upload <field> <file...>  attach files
    behalf shot [file]               screenshot
    behalf stop                      close the port when the task is done

Flags: `--tab <match>` picks a tab, `--frame <match>|*` works inside an iframe.

Read FIELD-MANUAL.md before writing your own automation. It documents the traps
that already cost someone a day.

- Prefer `wait` over `sleep`. Every fixed sleep is a race waiting to be lost.
- Try `click` first. If nothing happens, add `--mouse`. Neither method is
  universally right; they fail in opposite directions.
- If a page looks empty but is not, it is shadow DOM or an iframe. Run `frames`.
- Check the exit code. Every command exits non-zero when it did not do the thing,
  and says what to try instead.
- **Run `behalf stop` when the task is done.** An open control port lets any
  local process act as the user in their bank and government services.
- Never submit filings, payments or other binding actions on the user's behalf.
  Prepare it, show it, let them press the button.
