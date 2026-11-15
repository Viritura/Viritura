# MCP

Viritura exposes an opt-in MCP connection for external clients working with the
document open in your browser.

## Connect an MCP client

Choose the MCP button in the Activity Bar, then select **Connect this tab**.
**Auto-accept proposed edits** is off by default; you can turn it on or off at
any time while the tab is connected. Only enable it for a trusted client.
When the secure session is ready:

1. Select **Copy setup prompt** and paste it into Copilot CLI or another
   Streamable HTTP MCP client, or copy the URL for manual setup. The URL is
   the same for every tab, so this is a one-time step per client.
2. Sign in through your browser when the client asks.
3. Keep the Viritura document tab open while the client works.

Connecting is tab-specific: other open documents are not exposed unless you
explicitly connect them too.

A client's sign-in lasts up to 30 days if the client supports staying signed
in; otherwise it lasts about an hour. After that, or if you revoke access, the
client asks you to sign in through your browser again.

## Review MCP changes

An MCP client can inspect the open document, answer notation-aware questions
about chords, timing, instrument ranges, and annotations, and propose edits,
including notes, chord symbols, and individual staff expressions. By default,
proposed document changes require approval in the
corresponding Viritura tab. Clicking outside a review dialog does not dismiss or
reject the proposal; use **Accept** or **Reject** to decide.

With auto-accept enabled, validated proposals apply immediately without opening
a review dialog. The panel shows the current setting, and turning it on does not
apply proposals already awaiting review.
Changes still use the normal validation, undo, and collaboration paths. This
option applies only to the current connection in this tab, survives automatic
reconnections, and resets when you disconnect or reload the tab.

When reviewing manually, inspect the visual and semantic diff before accepting:

- confirm the intended measures, staves, and instruments changed;
- inspect notation, metadata, and layout changes separately;
- reject proposals that are broader than the request;
- play back or engrave the result before saving.

Disconnect the MCP session when the task is complete. The stable MCP endpoint
does not make a closed tab or an unconnected document available to a client.

For project history and inspecting revisions, see
[Viewing & Review](/docs/viewing-and-review#review-version-history). For
person-to-person editing, see [Collaboration](/docs/collaboration).
