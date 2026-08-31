using System.Text.Json;

namespace Viritura.Api.Mcp;

/// <summary>
/// MCP tools implemented by the active Viritura editor tab. Keeping the
/// catalogue server-side lets clients discover tools before a browser RPC is
/// made while all score reads and writes remain inside the authoritative tab.
/// </summary>
internal static class McpToolCatalog
{
    private static readonly JsonElement EmptyObjectSchema = Schema("""
        { "type": "object", "additionalProperties": false }
        """);
    private static readonly JsonElement SessionRoutingSchema = Schema("""
                {
                    "type": "object",
                    "properties": { "sessionId": { "type": "string", "minLength": 16 } },
                    "additionalProperties": false
                }
                """);

    internal static readonly JsonElement Tools = JsonSerializer.SerializeToElement(new object[]
    {
        new
        {
            name = "editor.list_sessions",
            description = "List this OAuth user's opted-in Viritura browser sessions. Use a returned sessionId for score tools when multiple sessions are connected.",
            inputSchema = EmptyObjectSchema,
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.overview",
            description = "Return score metadata, part names, and measure count from the active Viritura document.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_mnx",
            description = "Return the complete current score as MNX JSON. Prefer score.overview or editor.get_selection when less context is sufficient.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_measures",
            description = "Return a compact MNX slice for 1 to 32 measures and optionally selected part IDs. Measure numbers are 1-based.",
            inputSchema = MeasureRangeSchema(),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "editor.get_selection",
            description = "Return the current selection in the active Viritura editor tab.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "editor.get_selected_music",
            description = "Resolve the current editor selection to its selection metadata and compact MNX measure slice.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.analyze_chords",
            description = "Identify exact triads and seventh chords encoded in note events and summarize pitch classes by measure. Measure numbers are 1-based.",
            inputSchema = MeasureRangeSchema(),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_timeline",
            description = "Return measure start times, tempo regions, and total duration in seconds for a bounded measure range (max 512). Use this to verify score time against picture. Measure numbers are 1-based.",
            inputSchema = Schema("""
                {
                    "type": "object",
                    "properties": {
                        "startMeasure": { "type": "integer", "minimum": 1 },
                        "endMeasure": { "type": "integer", "minimum": 1 },
                        "sessionId": { "type": "string", "minLength": 16 }
                    },
                    "additionalProperties": false
                }
                """),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.validate",
            description = "Dry-run a ScorePatch array or a complete MNX document and return diagnostics WITHOUT staging a proposal. Lets a model iterate without spending human approvals. Provide exactly one of patches or mnx.",
            inputSchema = Schema("""
                {
                    "type": "object",
                    "properties": {
                        "patches": { "type": "array", "items": { "type": "object", "required": ["kind"] } },
                        "mnx": { "type": ["object", "string"] },
                        "sessionId": { "type": "string", "minLength": 16 }
                    },
                    "additionalProperties": false
                }
                """),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_video_sync",
            description = "Return the persisted score-to-picture sync settings (picture offset, media identity, start timecode), or null when none is set.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_instruments",
            description = "Return per-part instrument identity, catalog range and clefs, the part's actual sounding pitch range, and a flag for notes outside the playable range.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "preview.propose_patches",
            description = "Validate ScorePatch objects against the current score and show an in-app diff for user approval. This never changes the score directly.",
            inputSchema = Schema("""
                {
                  "type": "object",
                  "properties": {
                                        "sessionId": { "type": "string", "minLength": 16 },
                    "patches": {
                      "type": "array",
                      "minItems": 1,
                      "maxItems": 256,
                      "items": { "type": "object", "required": ["kind"] }
                    },
                    "summary": { "type": "string", "maxLength": 240 }
                  },
                  "required": ["patches"],
                  "additionalProperties": false
                }
                """),
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
            name = "preview.propose_mnx",
            description = "Validate a complete MNX document via the MNX schema and stage ONE whole-document proposal for ONE approval, reviewed by a structural summary. Use this to author or replace a large score without serializing many patch approvals. This never changes the score before user approval.",
            inputSchema = Schema("""
                {
                  "type": "object",
                  "properties": {
                    "sessionId": { "type": "string", "minLength": 16 },
                    "mnx": { "type": ["object", "string"] },
                    "summary": { "type": "string", "maxLength": 240 }
                  },
                  "required": ["mnx"],
                  "additionalProperties": false
                }
                """),
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
            name = "preview.reset_stem_directions",
            description = "Remove every explicit note-event stemDirection, including nested tuplets, grace groups, and tremolos, and stage one whole-document proposal for approval. This never changes the score before approval.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
            name = "preview.split_orchestral_staves",
            description = "Split the current score's combined P2/P5/P6/P7 orchestral parts into separate player Parts, add a distinct auto-condensed score, and stage one whole-document proposal for approval. This never changes the score before approval.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
            name = "preview.normalize_tritsch_instruments",
            description = "Normalize the known 23-part Tritsch score to modern English names and catalog identities, normalize split wind/brass voices and automatic stems, assign Viritura Sounds sources, correct bass drum/triangle/cymbal routing, and stage one whole-document proposal for approval. This never changes the score before approval.",
            inputSchema = SessionRoutingSchema,
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
                        name = "preview.propose_chord_notes",
                        description = "Add one or more pitches to existing note events as a reviewable proposal. This never changes the score before user approval.",
                        inputSchema = Schema("""
                                {
                                    "type": "object",
                                    "properties": {
                                        "sessionId": { "type": "string", "minLength": 16 },
                                        "summary": { "type": "string", "maxLength": 240 },
                                        "changes": {
                                            "type": "array",
                                            "minItems": 1,
                                            "maxItems": 64,
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "partId": { "type": "string" },
                                                    "measure": { "type": "integer", "minimum": 1 },
                                                    "voice": { "type": "integer", "minimum": 0 },
                                                    "eventId": { "type": "string" },
                                                    "pitches": {
                                                        "type": "array",
                                                        "minItems": 1,
                                                        "maxItems": 12,
                                                        "items": {
                                                            "type": "object",
                                                            "properties": {
                                                                "step": { "type": "string", "enum": ["A", "B", "C", "D", "E", "F", "G"] },
                                                                "octave": { "type": "integer", "minimum": 0, "maximum": 9 },
                                                                "alter": { "type": "integer", "minimum": -2, "maximum": 2 }
                                                            },
                                                            "required": ["step", "octave"],
                                                            "additionalProperties": false
                                                        }
                                                    }
                                                },
                                                "required": ["partId", "measure", "voice", "eventId", "pitches"],
                                                "additionalProperties": false
                                            }
                                        }
                                    },
                                    "required": ["changes"],
                                    "additionalProperties": false
                                }
                                """),
                        annotations = new { readOnlyHint = false, destructiveHint = false }
                },
                new
                {
            name = "preview.get_status",
            description = "Return whether a previously proposed patch set is still awaiting review, accepted, or rejected.",
            inputSchema = Schema("""
                {
                  "type": "object",
                                    "properties": {
                                        "sessionId": { "type": "string", "minLength": 16 },
                                        "proposalId": { "type": "string" }
                                    },
                  "required": ["proposalId"],
                  "additionalProperties": false
                }
                """),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        }
    });

    internal static bool Contains(string name)
    {
        foreach (var tool in Tools.EnumerateArray())
        {
            if (tool.GetProperty("name").GetString() == name)
            {
                return true;
            }
        }

        return false;
    }

    internal static string? RequiredScope(string name) => name switch
    {
        "editor.list_sessions" => "score:read",
        "editor.get_selection" or "editor.get_selected_music" => "selection:read",
        "preview.propose_patches" or "preview.propose_mnx" or "preview.reset_stem_directions"
            or "preview.split_orchestral_staves" or "preview.normalize_tritsch_instruments"
            or "preview.propose_chord_notes" or "preview.get_status" => "score:propose",
        "score.overview" or "score.get_mnx" or "score.get_measures" or "score.analyze_chords"
            or "score.get_timeline" or "score.validate" or "score.get_video_sync" or "score.get_instruments" => "score:read",
        _ => null
    };

    private static JsonElement Schema(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static JsonElement MeasureRangeSchema() => Schema("""
                {
                    "type": "object",
                    "properties": {
                        "startMeasure": { "type": "integer", "minimum": 1 },
                        "endMeasure": { "type": "integer", "minimum": 1 },
                        "partIds": { "type": "array", "items": { "type": "string" }, "uniqueItems": true },
                        "sessionId": { "type": "string", "minLength": 16 }
                    },
                    "additionalProperties": false
                }
                """);
}