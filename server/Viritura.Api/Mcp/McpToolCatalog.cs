using System.Text.Json;
using System.Text.Json.Nodes;

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
    private static readonly JsonElement GeneratedPreviewSchema = Schema("""
                {
                    "type": "object",
                    "properties": {
                        "sessionId": { "type": "string", "minLength": 16 },
                        "allowRhythmTruncation": { "type": "boolean", "default": false },
                        "baseRevision": { "type": "string", "minLength": 1 },
                        "requestId": { "type": "string", "minLength": 1, "maxLength": 64 }
                    },
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
            description = "Return a compact MNX slice for 1 to 32 measures and optionally selected part IDs. Boundaries are 1-based ordinals or stable global measure IDs; returned references include zero-based indices, ordinals and displayed number overrides.",
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
            description = "Identify exact triads and seventh chords encoded in note events and summarize pitch classes by measure. Boundaries are 1-based ordinals or global measure IDs.",
            inputSchema = MeasureRangeSchema(),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_timeline",
            description = "Return performed measure start times, tempo regions, and total duration in seconds for a bounded range (max 512). Boundaries are 1-based ordinals or global measure IDs.",
            inputSchema = QuerySchema("{}", includeRange: true),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_section_timings",
            description = "Summarize performed section durations including repeats and jumps. Supply explicit ranges, or omit sections to split at rehearsal marks; paginate sections with offset and limit.",
            inputSchema = Schema("""
                {
                    "type": "object",
                    "properties": {
                        "sessionId": { "type": "string", "minLength": 16 },
                        "offset": { "type": "integer", "minimum": 0 },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
                        "sections": {
                            "type": "array", "minItems": 1, "maxItems": 100,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "startMeasure": { "type": "integer", "minimum": 1 },
                                    "endMeasure": { "type": "integer", "minimum": 1 },
                                    "startMeasureId": { "type": "string", "minLength": 1 },
                                    "endMeasureId": { "type": "string", "minLength": 1 }
                                },
                                "allOf": [
                                    { "oneOf": [ { "required": ["startMeasure"] }, { "required": ["startMeasureId"] } ] },
                                    { "oneOf": [ { "required": ["endMeasure"] }, { "required": ["endMeasureId"] } ] }
                                ],
                                "additionalProperties": false
                            }
                        }
                    },
                    "additionalProperties": false
                }
                """),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.search_annotations",
            description = "Search staff/system text, rehearsal marks, tempo text, lyrics and chord symbols with locations suitable for edits. Results are paginated; partIds filters part-owned entries only.",
            inputSchema = QuerySchema("""
                {
                    "query": { "type": "string" },
                    "kinds": { "type": "array", "uniqueItems": true, "items": { "enum": ["staffText", "systemText", "rehearsal", "tempo", "lyric", "chordSymbol"] } },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
                }
                """, includeRange: true, includeParts: true),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_notes",
            description = "Return a paginated table of notated events, pitches, event paths and quarter-note beat positions for up to 32 measures. Grace and tremolo entries report anchors, not performed timings.",
            inputSchema = QuerySchema("""
                {
                    "includeRests": { "type": "boolean" },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 500 }
                }
                """, includeRange: true, includeParts: true),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.validate",
            description = "Dry-run patches or MNX without staging. Returns rhythmic repairs, affected event IDs, splice before/after content, and whether truncation requires confirmation. Provide exactly one of patches or mnx.",
            inputSchema = PatchInputSchema("""
                {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "properties": {
                        "patches": { "type": "array", "minItems": 1, "maxItems": 4096 },
                        "mnx": { "type": ["object", "string"] },
                        "sessionId": { "type": "string", "minLength": 16 }
                    },
                    "oneOf": [
                        { "required": ["patches"], "not": { "required": ["mnx"] } },
                        { "required": ["mnx"], "not": { "required": ["patches"] } }
                    ],
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
            description = "Return per-part identity, catalog and sounding ranges, and paginated located range violations. Use partIds and violationOffset/violationLimit to inspect every violation.",
            inputSchema = QuerySchema("""
                {
                    "violationOffset": { "type": "integer", "minimum": 0 },
                    "violationLimit": { "type": "integer", "minimum": 1, "maximum": 100 }
                }
                """, includeParts: true),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "score.get_instrument_catalog",
            description = "Search paginated instrument catalog IDs, names, families, staff counts and sounding ranges for use with preview.change_instrument.",
            inputSchema = QuerySchema("""
                {
                    "query": { "type": "string" },
                    "offset": { "type": "integer", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 100 }
                }
                """),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "preview.propose_patches",
            description = "Validate ScorePatch objects against the current score and propose edits. To remove staff text annotations, use {kind: \"removeMeasureExpression\", measurePath: {partId, measureIndex}, expressionIndex}; both indices are zero-based. Read the current expressions from score.get_measures at parts[].measures[]._x.viritura.expressions; remove multiple entries in one measure in descending index order. Show an in-app diff for approval, or apply immediately if the user enabled session auto-accept. Check the returned proposal status. For more than 256 patches (up to 4096), send the batches sequentially with the same batchId: earlier calls use final: false and return status \"batching\"; the call with final: true creates ONE proposal containing every batch, approved and undone as a single edit. A batch is discarded if the score changes before it is final.",
            inputSchema = PatchInputSchema("""
                {
                  "$schema": "https://json-schema.org/draft/2020-12/schema",
                  "type": "object",
                  "properties": {
                    "sessionId": { "type": "string", "minLength": 16 },
                    "baseRevision": { "type": "string", "minLength": 1 },
                    "requestId": { "type": "string", "minLength": 1, "maxLength": 64 },
                    "patches": {
                      "type": "array",
                      "minItems": 1,
                      "maxItems": 256
                    },
                    "summary": { "type": "string", "maxLength": 240 },
                    "batchId": { "type": "string", "minLength": 1, "maxLength": 64 },
                    "final": { "type": "boolean", "default": true },
                    "allowRhythmTruncation": { "type": "boolean", "default": false }
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
            description = "Validate a complete MNX document via the MNX schema and submit ONE whole-document proposal, reviewed by a structural summary. Use this to author or replace a large score without serializing many patch approvals. Apply immediately only if the user enabled session auto-accept. Check the returned proposal status.",
            inputSchema = Schema("""
                {
                  "type": "object",
                  "properties": {
                    "sessionId": { "type": "string", "minLength": 16 },
                    "baseRevision": { "type": "string", "minLength": 1 },
                    "requestId": { "type": "string", "minLength": 1, "maxLength": 64 },
                    "mnx": { "type": ["object", "string"] },
                    "summary": { "type": "string", "maxLength": 240 },
                    "allowRhythmTruncation": { "type": "boolean", "default": false }
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
            description = "Remove every explicit note-event stemDirection, including nested tuplets, grace groups, and tremolos, and submit one whole-document proposal. Requires approval unless the user enabled session auto-accept.",
            inputSchema = GeneratedPreviewSchema,
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
            name = "preview.split_orchestral_staves",
            description = "Split the current score's combined P2/P5/P6/P7 orchestral parts into separate player Parts, add a distinct auto-condensed score, and submit one whole-document proposal. Requires approval unless the user enabled session auto-accept.",
            inputSchema = GeneratedPreviewSchema,
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
            name = "preview.normalize_tritsch_instruments",
            description = "Normalize the known 23-part Tritsch score to modern English names and catalog identities, normalize split wind/brass voices and automatic stems, assign Viritura Sounds sources, correct bass drum/triangle/cymbal routing, and submit one whole-document proposal. Requires approval unless the user enabled session auto-accept.",
            inputSchema = GeneratedPreviewSchema,
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
                        name = "preview.propose_chord_notes",
                        description = "Add one or more pitches to existing note events as a reviewable proposal. Requires approval unless the user enabled session auto-accept.",
                        inputSchema = Schema("""
                                {
                                    "type": "object",
                                    "properties": {
                                        "sessionId": { "type": "string", "minLength": 16 },
                                        "baseRevision": { "type": "string", "minLength": 1 },
                                        "requestId": { "type": "string", "minLength": 1, "maxLength": 64 },
                                        "summary": { "type": "string", "maxLength": 240 },
                                        "allowRhythmTruncation": { "type": "boolean", "default": false },
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
            name = "preview.change_instrument",
            description = "Safely change a part's catalog instrument and stage one reviewable document proposal, or apply with session auto-accept. Unsafe staff-count or pitched/percussion changes are rejected; warnings are included in the review summary.",
            inputSchema = Schema("""
                {
                    "type": "object",
                    "properties": {
                        "sessionId": { "type": "string", "minLength": 16 },
                        "baseRevision": { "type": "string", "minLength": 1 },
                        "requestId": { "type": "string", "minLength": 1, "maxLength": 64 },
                        "partId": { "type": "string", "minLength": 1 },
                        "instrumentId": { "type": "string", "minLength": 1 },
                        "allowRhythmTruncation": { "type": "boolean", "default": false }
                    },
                    "required": ["partId", "instrumentId"],
                    "additionalProperties": false
                }
                """),
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
        new
        {
            name = "preview.get_batch",
            description = "Inspect an open patch batch, including its base revision, chunk count, and stale status; independent of auto-accept.",
            inputSchema = BatchSchema(false),
            annotations = new { readOnlyHint = true, idempotentHint = true }
        },
        new
        {
            name = "preview.cancel_batch",
            description = "Discard an open patch batch without creating or auto-accepting a proposal.",
            inputSchema = BatchSchema(true),
            annotations = new { readOnlyHint = false, destructiveHint = false }
        },
                new
                {
            name = "preview.get_status",
            description = "Return whether a previous proposal is pending review, accepted (manually or via session auto-accept), rejected, or stale.",
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
            or "preview.propose_chord_notes" or "preview.change_instrument" or "preview.get_status" or "preview.get_batch"
            or "preview.cancel_batch" => "score:propose",
        "score.overview" or "score.get_mnx" or "score.get_measures" or "score.analyze_chords"
            or "score.get_timeline" or "score.get_section_timings" or "score.search_annotations" or "score.get_notes"
            or "score.validate" or "score.get_video_sync" or "score.get_instruments" or "score.get_instrument_catalog" => "score:read",
        _ => null
    };

    private static JsonElement Schema(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static JsonElement PatchInputSchema(string json)
    {
        using var stream = typeof(McpToolCatalog).Assembly.GetManifestResourceStream(
            "Viritura.Api.Mcp.score-patches.schema.json")
            ?? throw new InvalidOperationException("The generated MCP score patch schema is missing.");
        var patches = JsonNode.Parse(stream)?.AsObject()
            ?? throw new InvalidOperationException("The generated MCP score patch schema is invalid.");
        var schema = JsonNode.Parse(json)!.AsObject();
        schema["definitions"] = patches["definitions"]!.DeepClone();
        schema["properties"]!["patches"]!["items"] = new JsonObject
        {
            ["anyOf"] = patches["anyOf"]!.DeepClone()
        };
        return JsonSerializer.SerializeToElement(schema);
    }

    private static JsonElement BatchSchema(bool canCancel)
    {
        var schema = JsonNode.Parse("""
            {
                "type": "object",
                "properties": {
                    "batchId": { "type": "string", "minLength": 1, "maxLength": 64 },
                    "sessionId": { "type": "string", "minLength": 16 }
                },
                "required": ["batchId"],
                "additionalProperties": false
            }
            """)!.AsObject();
        if (canCancel)
        {
            schema["properties"]!["requestId"] = JsonNode.Parse("""{ "type": "string", "minLength": 1, "maxLength": 64 }""");
        }

        return JsonSerializer.SerializeToElement(schema);
    }

    private static JsonElement MeasureRangeSchema() => QuerySchema("{}", includeRange: true, includeParts: true);

    private static JsonElement QuerySchema(string extraProperties, bool includeRange = false, bool includeParts = false)
    {
        var schema = JsonNode.Parse("""
            {
                "type": "object",
                "properties": { "sessionId": { "type": "string", "minLength": 16 } },
                "additionalProperties": false
            }
            """)!.AsObject();
        var properties = schema["properties"]!.AsObject();
        if (includeRange)
        {
            properties["startMeasure"] = JsonNode.Parse("""{ "type": "integer", "minimum": 1 }""");
            properties["endMeasure"] = JsonNode.Parse("""{ "type": "integer", "minimum": 1 }""");
            properties["startMeasureId"] = JsonNode.Parse("""{ "type": "string", "minLength": 1 }""");
            properties["endMeasureId"] = JsonNode.Parse("""{ "type": "string", "minLength": 1 }""");
            schema["allOf"] = JsonNode.Parse("""
                [
                    { "not": { "required": ["startMeasure", "startMeasureId"] } },
                    { "not": { "required": ["endMeasure", "endMeasureId"] } }
                ]
                """);
        }
        if (includeParts)
        {
            properties["partIds"] = JsonNode.Parse("""{ "type": "array", "items": { "type": "string" }, "uniqueItems": true }""");
        }
        foreach (var property in JsonNode.Parse(extraProperties)!.AsObject())
        {
            properties[property.Key] = property.Value?.DeepClone();
        }
        return JsonSerializer.SerializeToElement(schema);
    }
}