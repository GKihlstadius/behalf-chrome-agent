# Contributing

The tool is 681 lines with no dependencies. You can read all of it in an evening,
which is the point, so please keep it that way.

## Before you change anything

```sh
test/run.sh                 # 56 checks against a real Chrome and a local fixture
node --test test/unit.mjs   # the parts that differ per operating system
```

They use their own browser profile and their own state directory, so they are
safe to run while you are working. Both must pass.

## What is welcome

- **New traps for the [field manual](FIELD-MANUAL.md).** This is the most valuable
  thing you can contribute. If a site defeated you and you worked out why, that
  knowledge is worth more than another command
- Windows and Linux fixes. Both are implemented and unit tested, but neither has
  been run in anger on real hardware. Bug reports from those platforms are gold
- Fixes with a test that fails before and passes after

## What is probably not welcome

- Dependencies. There are none and that is a feature
- A build step
- Commands that duplicate something a shell can already do
- Anything that phones home

## House style

- Comments explain **why**, not what, and usually name the bug that caused the line
- No em dashes
- Error messages say what to try next, not just what went wrong
- Every command exits non-zero when it did not do the thing

## Adding a trap to the field manual

Say what the symptom looked like, what you tried that did not work, and what did.
The failed attempts are half the value. The entry on focus emulation exists
because `Page.bringToFront` and `Input.setIgnoreInputEvents` were both tried
first, and saying so saves the next person that afternoon.
