# render-report

Shows what the engine's tests draw, as an HTML page with each drawing next to the MNX that produced it. Use it to see
what an engine change does to engraving across every test.

```sh
pnpm render:draw <test>...         # draw the tests whose names contain any <test>
pnpm render:record                 # record what every test draws in the working tree
pnpm render:diff <before> [after]  # show the drawings that differ between two recordings
```

`render:diff` compares any two recorded commits, branches or other refs. Leave out `after` to compare with the working
tree. Each one must have been recorded first, by checking it out and running `pnpm render:record`. For example:

```sh
git switch main && pnpm render:record
git switch my-branch && pnpm render:record
pnpm render:diff main
```

Recordings are named by git tree, so `render:diff` finds them whichever branch is checked out. Recordings, pictures and
reports go in `target/` here.

## How it works

The engine's `drawing_recorder` module wraps `promote_root` and the top-level layout entry points. In test builds,
setting `RENDER_RECORDING` to a folder makes it save each outermost layout's pages as SVG, along with the MNX the test
parsed, and list them in that folder's `manifest.jsonl`. Outside test builds it only calls through. A commit from before
the recorder existed can't be recorded unless the recorder is added to it.
