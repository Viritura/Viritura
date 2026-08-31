# MCP

Viritura exposes an opt-in MCP connection for external clients working with the
document open in your browser.

## Connect an MCP client

Choose the MCP button in the Activity Bar and select **Connect MCP client**.
When the secure session is ready:

1. Select **Copy setup prompt** and paste it into Copilot CLI or another
   Streamable HTTP MCP client, or copy the URL for manual setup.
2. Complete the OAuth flow in your browser.
3. Keep the Viritura document tab open while the client works.

No access token is copied into the setup prompt. Connecting is tab-specific:
other open documents are not exposed unless you explicitly connect them too.

## Review MCP changes

An MCP client can inspect the open document, answer notation-aware questions,
and propose edits. Proposed document changes require approval in the
corresponding Viritura tab.

Review the visual and semantic diff before accepting:

- confirm the intended measures, staves, and instruments changed;
- inspect notation, metadata, and layout changes separately;
- reject proposals that are broader than the request;
- play back or engrave the result before saving.

Disconnect the MCP session when the task is complete. The stable MCP endpoint
does not make a closed tab or an unconnected document available to a client.

For project history and inspecting revisions, see
[Viewing & Review](/docs/viewing-and-review#review-version-history). For
person-to-person editing, see [Collaboration](/docs/collaboration).
