import { describe, expect, it } from "vitest";
import type { MediaInfoResult, Track } from "mediainfo.js";
import { normalizeMediaInfo } from "../mediaMetadata";

function result(...track: Track[]): MediaInfoResult {
  return { media: { "@ref": "fixture", track } };
}

const general: Track = {
  "@type": "General",
  Format: "MPEG-4",
};

describe("normalizeMediaInfo frame rates", () => {
  it("preserves an exact NTSC film rational", () => {
    const metadata = normalizeMediaInfo(
      result(general, {
        "@type": "Video",
        Format: "AVC",
        Format_Profile: "High@L4",
        Width: 1920,
        Height: 1080,
        FrameRate_Mode: "CFR",
        FrameRate: 23.976,
        FrameRate_Num: 24000,
        FrameRate_Den: 1001,
      }),
    );

    expect(metadata).toMatchObject({
      container: "MPEG-4",
      codec: "AVC",
      codecProfile: "High@L4",
      width: 1920,
      height: 1080,
      frameRate: {
        numerator: 24000,
        denominator: 1001,
        mode: "constant",
        source: "container-rational",
        confidence: "high",
        suggestedFrameRateId: "23.976",
      },
    });
  });

  it("reduces equivalent rational fields before matching a standard", () => {
    const metadata = normalizeMediaInfo(
      result({
        "@type": "Video",
        Format: "AVC",
        FrameRate_Mode: "Constant",
        FrameRate_Num: 48000,
        FrameRate_Den: 2002,
      }),
    );
    expect(metadata.frameRate).toMatchObject({
      numerator: 24000,
      denominator: 1001,
      suggestedFrameRateId: "23.976",
    });
  });

  it("does not call a merely near-standard rational authoritative", () => {
    const metadata = normalizeMediaInfo(
      result({
        "@type": "Video",
        Format: "AVC",
        FrameRate_Mode: "CFR",
        FrameRate_Num: 23999,
        FrameRate_Den: 1000,
      }),
    );
    expect(metadata.frameRate).toMatchObject({
      numerator: 23999,
      denominator: 1000,
      confidence: "medium",
      suggestedFrameRateId: "24",
    });
  });

  it("requires confirmed CFR before calling an exact rate high confidence", () => {
    const metadata = normalizeMediaInfo(
      result({
        "@type": "Video",
        Format: "AVC",
        FrameRate_Num: 24,
        FrameRate_Den: 1,
      }),
    );
    expect(metadata.frameRate).toMatchObject({
      mode: "unknown",
      confidence: "medium",
      suggestedFrameRateId: "24",
    });
  });

  it("recognizes a standard from average-only metadata with lower confidence", () => {
    const metadata = normalizeMediaInfo(
      result({
        "@type": "Video",
        Format: "VP9",
        FrameRate_Mode: "CFR",
        FrameRate: 25,
      }),
    );
    expect(metadata.frameRate).toMatchObject({
      numerator: 25,
      denominator: 1,
      source: "container-average",
      confidence: "medium",
      suggestedFrameRateId: "25",
    });
  });

  it("does not suggest a constant rate for VFR media", () => {
    const metadata = normalizeMediaInfo(
      result({
        "@type": "Video",
        Format: "VP9",
        FrameRate_Mode: "VFR",
        FrameRate: 29.84,
        FrameRate_Minimum: 12.5,
        FrameRate_Maximum: 60,
      }),
    );
    expect(metadata.frameRate).toMatchObject({
      mode: "variable",
      confidence: "vfr",
      minimumFps: 12.5,
      maximumFps: 60,
      suggestedFrameRateId: null,
    });
  });

  it("leaves a non-standard rate for manual confirmation", () => {
    const metadata = normalizeMediaInfo(
      result({
        "@type": "Video",
        Format: "AVC",
        FrameRate_Mode: "CFR",
        FrameRate_Num: 48,
        FrameRate_Den: 1,
      }),
    );
    expect(metadata.frameRate).toMatchObject({
      numerator: 48,
      denominator: 1,
      confidence: "medium",
      suggestedFrameRateId: null,
    });
  });
});

describe("normalizeMediaInfo timecode", () => {
  const ntscVideo: Track = {
    "@type": "Video",
    Format: "AVC",
    FrameRate_Mode: "CFR",
    FrameRate_Num: 30000,
    FrameRate_Den: 1001,
  };

  it("uses the QuickTime timecode track to select drop-frame", () => {
    const metadata = normalizeMediaInfo(
      result(general, ntscVideo, {
        "@type": "Other",
        Format: "Time code",
        TimeCode_FirstFrame: "01:00:00;00",
        TimeCode_DropFrame: "Yes",
        TimeCode_Source: "QuickTime TC",
      }),
    );
    expect(metadata.frameRate?.suggestedFrameRateId).toBe("29.97df");
    expect(metadata.timecode).toEqual({
      firstFrame: "01:00:00;00",
      dropFrame: true,
      source: "QuickTime TC",
    });
  });

  it("selects non-drop only when the file explicitly says so", () => {
    const metadata = normalizeMediaInfo(
      result(ntscVideo, {
        "@type": "Other",
        Format: "Time code",
        TimeCode_FirstFrame: "01:00:00:00",
        TimeCode_DropFrame: "No",
      }),
    );
    expect(metadata.frameRate?.suggestedFrameRateId).toBe("29.97");
    expect(metadata.timecode.dropFrame).toBe(false);
  });

  it("does not guess DF/NDF from 29.97 alone", () => {
    const metadata = normalizeMediaInfo(result(ntscVideo));
    expect(metadata.frameRate?.suggestedFrameRateId).toBeNull();
    expect(metadata.timecode.dropFrame).toBeNull();
  });

  it("understands MediaInfo's settings string when the direct field is absent", () => {
    const metadata = normalizeMediaInfo(
      result(ntscVideo, {
        "@type": "Other",
        Format: "Time code",
        TimeCode_Settings: "DropFrame=Yes / 24HourMax=Yes",
      }),
    );
    expect(metadata.timecode.dropFrame).toBe(true);
    expect(metadata.frameRate?.suggestedFrameRateId).toBe("29.97df");
  });

  it("recognizes a semicolon timecode as an explicit DF declaration", () => {
    const metadata = normalizeMediaInfo(
      result(ntscVideo, {
        "@type": "Other",
        Format: "Time code",
        TimeCode_FirstFrame: "01:00:00;00",
      }),
    );
    expect(metadata.timecode.dropFrame).toBe(true);
    expect(metadata.frameRate?.suggestedFrameRateId).toBe("29.97df");
  });

  it("combines timecode fields MediaInfo reports on different tracks", () => {
    const metadata = normalizeMediaInfo(
      result(
        {
          ...ntscVideo,
          TimeCode_DropFrame: "Yes",
        },
        {
          "@type": "Other",
          Format: "Time code",
          TimeCode_FirstFrame: "10:00:00;00",
          TimeCode_Source: "QuickTime TC",
        },
      ),
    );
    expect(metadata.timecode).toEqual({
      firstFrame: "10:00:00;00",
      dropFrame: true,
      source: "QuickTime TC",
    });
  });
});

describe("normalizeMediaInfo missing data", () => {
  it("uses the default video track when a container has several", () => {
    const metadata = normalizeMediaInfo(
      result(
        {
          "@type": "Video",
          Format: "JPEG",
          Width: 320,
          Height: 180,
          FrameRate_Num: 1,
          FrameRate_Den: 1,
        },
        {
          "@type": "Video",
          Format: "AVC",
          Default: "Yes",
          Width: 1920,
          Height: 1080,
          FrameRate_Num: 24,
          FrameRate_Den: 1,
        },
      ),
    );
    expect(metadata).toMatchObject({
      codec: "AVC",
      width: 1920,
      height: 1080,
      frameRate: { suggestedFrameRateId: "24" },
    });
  });

  it("returns useful container information without a video track", () => {
    expect(normalizeMediaInfo(result(general))).toEqual({
      container: "MPEG-4",
      codec: null,
      codecProfile: null,
      width: null,
      height: null,
      frameRate: null,
      timecode: { firstFrame: null, dropFrame: null, source: null },
    });
  });
});
