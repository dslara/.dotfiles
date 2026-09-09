# pi-profile

Isolated profiles for Pi. Each profile is a full agent directory with its own settings, resources, sessions, and credentials. Entering a profile means restarting Pi inside that directory. Nothing is shared with base unless you copy it by hand.

## How it works

Profiles live beside the agent directory, in a `profiles` folder. The file `state.json` next to them holds the selection. On launch the extension checks the selection first. With one set, it relaunches Pi with the profile directory as the agent directory and then gets out of the way. The footer shows the profile name while routed and stays silent in base.

Switching always quits Pi. The agent directory cannot change under a live process, so there is no hot swap and the conversation does not carry over. Each profile keeps its own sessions.

A fresh profile starts truly empty: one blank settings file. Pi grows the resource dirs and credentials on first run inside it.

## Commands

Bare `/profile` lists, same as `/profile list`.

- `/profile list` — all profiles, active one marked.
- `/profile create <name>` — new empty profile. Names take letters, digits, hyphen, underscore, starting with a letter or digit. Duplicates fail. A failed create leaves no directory behind.
- `/profile use <name>` — select and quit. Next launch runs inside.
- `/profile off` — clear the selection and quit back to base.
- `/profile show [name]` — print the profile settings file. No name means the active profile.
- `/profile delete <name>` — remove the directory with everything in it. Refuses the active profile, asks first, proceeds without asking where no UI exists.

Two flags cover single launches without touching the selection:

- `pi --profile <name>` — this launch only.
- `pi --no-profile` — base for this launch only, even with a selection set.

## Sharing

Copy a plain Pi settings file into a new profile directory by hand, for install and for updates. No fetching, no merging, no remembered sources. Only the packages shape is validated, everything else passes through. Broken content fails at write time, never at next launch.

Local-only resources work the same way: drop files straight into the profile `extensions`, `skills`, `prompts`, or `themes` dirs. Yours, never reconciled.

## Install

Recopy this directory over the old one. No install step, no dependencies. Version lives in `package.json` only.

## Troubleshooting

- `Profile routing skipped: ...` on stderr — the selection points at a missing or invalid profile. Pi continues in base. Fix or clear the selection.
- `No active profile.` — `show` with no name and nothing selected. Pass a name or select first.
- `Deactivate the profile before deleting it.` — step out with `use` or `off` before deleting.
- `Profile names may contain only letters, numbers, hyphens, and underscores.` — rename and retry.
- `Invalid profile settings from ...` — the file failed validation. Fix the JSON or the packages shape and rewrite it.
- `Unknown ...` style usage lines — run the bare command to see the six.

## Manual checklist

Run top to bottom against the installed copy. UI steps need a real terminal.

1. Boot shows no errors and no profile marking in base.
2. Bare command lists, empty state reads `No Pi profiles exist.`
3. Create makes the profile with a blank settings file.
4. Duplicate create fails, invalid name fails, no stray dirs left.
5. List marks nothing active yet.
6. Show prints the file, show with no name errors `No active profile.`, show missing errors.
7. Unknown subcommand prints usage naming all six.
8. Use selects and quits, relaunch footer shows the name.
9. Off clears and quits, relaunch silent in base.
10. Flag launch enters without changing stored selection, checked via list after.
11. No-profile flag with a selection set stays in base.
12. Ghost selection prints the skip line and runs base.
13. Delete asks, confirmed removes the dir, declined keeps it.
14. Delete refuses the active profile before asking.
15. Delete headless proceeds.
16. Fresh profile grows resource dirs on first run.

Old filter keys like `profiles` left in settings are ignored silently. Remove them by hand whenever.
