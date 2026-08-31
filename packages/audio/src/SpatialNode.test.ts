import { describe, it, expect, vi } from "vitest";
import { SpatialNode, setListenerPosition } from "./SpatialNode";

// ─── Mock Web Audio API ──────────────────────────────────────────────

function createMockPannerNode(): PannerNode {
  return {
    panningModel: "equalpower",
    distanceModel: "inverse",
    refDistance: 1,
    maxDistance: 50,
    rolloffFactor: 1,
    coneInnerAngle: 0,
    coneOuterAngle: 0,
    coneOuterGain: 0,
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as PannerNode;
}

function createMockAudioContext(): AudioContext {
  const panner = createMockPannerNode();
  return {
    createPanner: vi.fn(() => panner),
    listener: {
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
      forwardX: { value: 0 },
      forwardY: { value: 0 },
      forwardZ: { value: -1 },
      upX: { value: 0 },
      upY: { value: 1 },
      upZ: { value: 0 },
    },
  } as unknown as AudioContext;
}

describe("SpatialNode", () => {
  it("creates a PannerNode with default config", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);
    const panner = node.panner;

    expect(panner.panningModel).toBe("equalpower");
    expect(panner.distanceModel).toBe("inverse");
    expect(panner.refDistance).toBe(1);
    expect(panner.maxDistance).toBe(50);
    expect(panner.rolloffFactor).toBe(1);
  });

  it("applies custom config overrides", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx, { refDistance: 5, rolloffFactor: 2 });
    const panner = node.panner;

    expect(panner.refDistance).toBe(5);
    expect(panner.rolloffFactor).toBe(2);
  });

  it("sets omnidirectional cone (360°)", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);

    expect(node.panner.coneInnerAngle).toBe(360);
    expect(node.panner.coneOuterAngle).toBe(360);
    expect(node.panner.coneOuterGain).toBe(1);
  });

  it("initial position is (0, 0)", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);

    expect(node.getPosition()).toEqual({ x: 0, y: 0 });
  });

  it("setPosition updates cached position and panner values", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);

    node.setPosition(3, 5);

    expect(node.getPosition()).toEqual({ x: 3, y: 5 });
    expect(node.panner.positionX.value).toBe(3);
    expect(node.panner.positionY.value).toBe(0); // height always 0
    expect(node.panner.positionZ.value).toBe(-5); // Z = -Y (Web Audio coord flip)
  });

  it("getPosition returns a copy (not the internal reference)", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);

    node.setPosition(1, 2);
    const pos = node.getPosition();
    pos.x = 99;

    expect(node.getPosition().x).toBe(1);
  });

  it("connectInput wires source → panner", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);
    const source = { connect: vi.fn() } as unknown as AudioNode;

    node.connectInput(source);
    expect(source.connect).toHaveBeenCalledWith(node.panner);
  });

  it("connectOutput wires panner → destination", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);
    const dest = {} as AudioNode;

    node.connectOutput(dest);
    expect(node.panner.connect).toHaveBeenCalledWith(dest);
  });

  it("disconnect does not throw if already disconnected", () => {
    const ctx = createMockAudioContext();
    const node = new SpatialNode(ctx);
    (node.panner.disconnect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("already disconnected");
    });

    expect(() => node.disconnect()).not.toThrow();
  });
});

describe("setListenerPosition", () => {
  it("sets listener position with Y → -Z coordinate flip", () => {
    const ctx = createMockAudioContext();

    setListenerPosition(ctx, 2, 4);

    expect(ctx.listener.positionX.value).toBe(2);
    expect(ctx.listener.positionY.value).toBe(0);
    expect(ctx.listener.positionZ.value).toBe(-4);
  });

  it("sets forward direction facing into -Z", () => {
    const ctx = createMockAudioContext();

    setListenerPosition(ctx, 0, 0);

    expect(ctx.listener.forwardX.value).toBe(0);
    expect(ctx.listener.forwardY.value).toBe(0);
    expect(ctx.listener.forwardZ.value).toBe(-1);
  });

  it("sets up direction to +Y", () => {
    const ctx = createMockAudioContext();

    setListenerPosition(ctx, 0, 0);

    expect(ctx.listener.upX.value).toBe(0);
    expect(ctx.listener.upY.value).toBe(1);
    expect(ctx.listener.upZ.value).toBe(0);
  });
});
