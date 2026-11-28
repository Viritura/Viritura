# Click Sessions

The **Click** activity follows your score with a click track for practice or
recording in another application. It plays only the click, not the instruments,
and does not record audio. Use your recording application to capture a take.

## Start a session

1. Open a score and select **Click** in the Activity Bar.
2. Choose the score or instrumental part you want to read. Tap a bar, or use
   the bar dial to choose where to start. The upper dial navigates rehearsal
   marks and named tempo changes; repeated bars appear for each visit.
3. Set **Session tempo %** to slow the whole performance without changing the
   written tempo. The range is 0 to 100%; Start is disabled at 0%.
4. Choose a one- or two-bar countoff, then select **Start** or press `Space`.
   Select **Stop** or press `Space` again to stop.

The countoff uses the starting bar's meter and tempo. During playback, the
controller shows the countoff followed by the current bar and beat. The score
follows repeats and navigation markings. Stopping selects the current bar for
the next start; starting again gives a fresh countoff. The tempo percentage,
countoff, and starting position are session settings, not saved in the score.

Use the status bar to change view, pitch display, zoom, and fit. The floating
controller can be dragged or moved with the arrow keys when focused. In
**Settings → Playback**, choose the metronome sound and whether the controller
flashes on every beat, only on downbeats, or not at all. Reduced-motion
settings disable the flash.

> [!NOTE]
> **Availability: Supported picture-in-picture hosts**
>
> When the host supports Document Picture-in-Picture, **Keep above other apps**
> moves the controller into a separate window. Otherwise the controller stays
> in the editor. If a video already uses the picture window, Viritura offers
> to replace it.

For recording, use a wired audio interface, prevent the device from sleeping,
and avoid changing audio devices during a take. The click is not synchronized
to the recording application's transport or locked to its audio clock.
Background tabs and a recording application in the foreground have not been
qualified for timing, so check your own setup before recording.

## Shape the click

Click timing follows the score's meter, beat grouping, tempo changes, ramps,
repeats, and holds. To set subdivisions, select a system instruction or tempo
marking in **Write**, then use **Clicks per beat** in **Properties**. Choose
one to five clicks per beat, or **No clicks (free time)** to silence the click
without changing the score's timing. A new tempo marking resets the click to
one per beat unless it specifies another setting.

For an uneven pattern, enter **Click grouping** and choose a **Click grid
division**. The division splits each denominator note; the group lengths must
add up to the meter's numerator multiplied by the division. For example, in
6/8, division 2 and grouping `3+3+2+2+2` produce five clicks on a
sixteenth-note grid. Select **Apply click grouping** to save it. A click-only
system instruction can change the pattern without adding a tempo; add another
instruction to restore the previous pattern after an exceptional bar.

Global fermatas can silence or continue the click during a hold. See
[Notation & Editing](/docs/notation-and-editing#fermatas).

## Open and share a setlist

When a project folder contains multiple `.mnx` files, the file picker lists its
immediate score files in filename order. Rename files, for example with numeric
prefixes, to change their order. Switching scores checks for unsaved changes;
the next score does not start automatically.

To share a setlist, choose **File → Share**. Connect GitHub and select
**Create secret Gist and link**, or paste an existing Gist URL and choose
**Create link from existing Gist**. You can pin the link to the current
revision. A new share includes the open score's unsaved edits and, for a
project folder, its MNX files, including files in subfolders.

> [!NOTE]
> **Availability: GitHub Gist**
>
> Creating a Gist requires a connected GitHub account and Gist permission.
> Recipients can open the link without an account. Secret Gists are unlisted,
> not private: anyone with the link can forward it, and the owner's username
> and revision history are visible.

The link opens the first score in Click. Shared setlists are read-only; save a
local copy to edit it. A setlist is limited to 50 files, 512 MiB of MNX, and
64 MiB of stored data. Viritura cannot update an existing Gist or open a
setlist link from inside the app; open the link in a browser instead.
