---
name: terms-cli
description: Control Terms (formerly Schmuck), the native macOS tmux frontend, with the `terms` CLI. Use when asked to create, rename, or re-point Terms groups; open, close, rename, split, move, select, read, or type into Terms tabs; or launch an agent in a Terms tab.
---

# Terms CLI

`terms` controls the running Terms app. Run `terms help` for the current command list. If it reports that Terms is not running, ask the user to open Terms.

Terms was renamed from Schmuck. Stored identifiers keep the old name: the tmux session `schmuck-native`, pane options `@schmuck-*`, and bundle ID `com.alexledger.schmuck`.

## Syntax

Parameters use `key=value`; quote values with spaces. Bare words are flags. Everything after `--` is a program and its arguments, passed literally (no shell).

- `group=` takes a group name (case-insensitive, must be unique) or its ID.
- `tab=` takes a tab ID like `@123` or a unique tab name.
- `pane=` takes a pane ID like `%45` and implies its tab. Without it, commands act on the tab's active pane. `terms tabs` lists the panes of split tabs.
- `dir=` accepts relative paths and `~`; the CLI makes them absolute.
- A program name is looked up on `PATH`.

## Commands

```bash
terms groups                                   # name, directory, tab count, ID
terms tabs [group=misc]                        # * selected tab, > active pane; last column is Pi status
terms state                                    # everything, as JSON
terms group:new name="Research" dir=~/git/x    # prints the new group ID
terms group:set group=misc dir=~/git/aled1027  # change default directory
terms group:set group=misc name="Misc"         # rename
terms group:delete group=Research              # its tabs keep running
terms tab:new group=misc dir=. -- pi "fix the failing test"   # prints the new tab ID
terms tab:new group=misc background -- pi "..."               # don't switch to it
terms tab:new parent=@123 background -- pi "..."              # child tab under @123, shown with ↳
terms tab:rename tab=@123 name=server
terms tab:send tab=@123 text="npm test" enter  # literal text, then Return
terms tab:send tab=@123 keys="C-c"             # tmux key names, space-separated
terms tab:read tab=@123 lines=200              # screen plus 200 lines of scrollback
terms tab:read pane=%45                        # one pane of a split tab
terms tab:close tab=@123                       # stops every process in the tab
terms tab:split tab=@123 side=down             # split the active pane; side=right is the default
terms wait tab=@123 status=done,blocked timeout=900   # prints the status that matched
terms wait pane=%45 text="All tests passed"   # prints "text" when it appears on screen
terms tab:move tab=@123 group=Research         # move a tab to another group
terms select tab=@123                          # or: terms select group=misc (overview)
terms refresh
terms quit                                     # tmux terminals keep running
```

A tab and a terminal are the same thing: one tmux window. `tab:new` selects the new tab unless you pass `background`; use `background` when the user is working elsewhere. A program that exits closes its tab.

## Driving an agent in a tab

1. Start it: `id=$(terms tab:new group=G dir=D background -- <agent> <args>)`.
2. Wait: `terms wait tab=$id status=done,blocked`. Pi reports `running`, `blocked`, or `done` through the status integration; other agents report nothing, so wait on `text=` instead.
3. Read the result: `terms tab:read tab=$id lines=200`.
4. If it's blocked or needs more, answer with `terms tab:send tab=$id text="..." enter`, then wait again.

`wait` exits non-zero on timeout or if the tab closes. A tab with no status shows `-`.

## Not covered

Focusing, renaming, or swapping panes, joining tabs into splits, reordering, the Review panel, and worktrees are app-only. Point the user to them: right-click menus, drag and drop, Command-K, Command-Shift-R, and File → New Worktree.

Showing an image in the side panel works from inside a pane: `tmux set-option -p -t "$TMUX_PANE" @schmuck-show-image /absolute/path.png`.

## Care

Closing a tab or sending `C-c` stops work. Do it only for tabs you created or the user named. Keep credentials out of `text=` and program arguments.
