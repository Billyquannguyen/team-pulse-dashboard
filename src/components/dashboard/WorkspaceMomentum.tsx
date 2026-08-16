import { useEffect, useState } from "react";
import { Player } from "@remotion/player";
import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type MomentumSceneProps = {
  current: number;
  target: number;
  memberCount: number;
  personal: boolean;
};

function formatMoney(value: number) {
  return `£${Math.round(value).toLocaleString()}`;
}

export function MomentumScene({ current, target, memberCount, personal }: MomentumSceneProps) {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(120deg, #10131b 0%, #171d2c 48%, #241629 100%)",
        color: "white",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        isolation: "isolate",
        overflow: "hidden",
      }}
    >
      <Interactive.Div
        name="Blue orbit glow"
        style={{
          position: "absolute",
          width: 640,
          height: 640,
          borderRadius: 999,
          border: "2px solid rgba(133, 220, 255, 0.18)",
          left: 920,
          top: -120,
          zIndex: 0,
          rotate: interpolate(frame, [0, durationInFrames], ["0deg", "360deg"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.linear,
          }),
        }}
      >
        <Interactive.Div
          name="Blue orbiting dot"
          style={{
            position: "absolute",
            width: 54,
            height: 54,
            borderRadius: 999,
            background: "linear-gradient(135deg, #9ce7ff, #80a8ff)",
            boxShadow: "0 0 60px rgba(127, 214, 255, .55)",
            left: 62,
            top: 62,
          }}
        />
      </Interactive.Div>

      <Interactive.Div
        name="Pink ambient glow"
        style={{
          position: "absolute",
          width: 520,
          height: 520,
          borderRadius: 999,
          background:
            "radial-gradient(circle, rgba(255, 134, 177, .26), rgba(255, 134, 177, 0) 68%)",
          right: -80,
          bottom: -260,
          zIndex: 0,
          scale: interpolate(frame, [0, 2 * fps, 4 * fps], [0.96, 1.08, 0.96], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
            output: "perceptual-scale",
          }),
        }}
      />

      <Interactive.Div
        name="Momentum copy"
        style={{
          position: "absolute",
          left: 76,
          top: 54,
          width: 800,
          zIndex: 2,
          opacity: interpolate(frame, [0, 0.8 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [0, 0.8 * fps], ["0px 28px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Interactive.Div
          name="Momentum eyebrow"
          style={{
            color: "rgba(255,255,255,.58)",
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: 4,
            textTransform: "uppercase",
          }}
        >
          {personal ? "Your momentum" : "Team momentum"}
        </Interactive.Div>
        <Interactive.Div
          name="Momentum headline"
          style={{
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: -3.5,
            lineHeight: 0.98,
            marginTop: 14,
          }}
        >
          Keep the streak moving.
        </Interactive.Div>
        <Interactive.Div
          name="Momentum supporting text"
          style={{
            color: "rgba(255,255,255,.62)",
            fontSize: 24,
            fontWeight: 600,
            lineHeight: 1.35,
            marginTop: 16,
            maxWidth: 760,
          }}
        >
          Live progress from the workspace, turned into one clear daily pulse.
        </Interactive.Div>
      </Interactive.Div>

      <Interactive.Div
        name="Progress capsule"
        style={{
          position: "absolute",
          alignItems: "center",
          background: "rgba(255,255,255,.08)",
          border: "1px solid rgba(255,255,255,.12)",
          borderRadius: 32,
          bottom: 32,
          display: "flex",
          gap: 24,
          left: 76,
          padding: "16px 24px",
          width: 780,
          zIndex: 2,
          opacity: interpolate(frame, [0.5 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <Interactive.Div
          name="Progress percent"
          style={{ flexShrink: 0, fontSize: 38, fontWeight: 900, lineHeight: 1 }}
        >
          {progress}%
        </Interactive.Div>
        <Interactive.Div
          name="Progress track"
          style={{
            background: "rgba(255,255,255,.1)",
            borderRadius: 99,
            flex: 1,
            height: 16,
            minWidth: 260,
            overflow: "hidden",
          }}
        >
          <Interactive.Div
            name="Progress fill"
            style={{
              background: "linear-gradient(90deg, #a6f04d, #ffe036, #ff8c66)",
              borderRadius: 99,
              height: 16,
              width: `${progress}%`,
              scale: interpolate(frame, [0.8 * fps, 2 * fps], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.spring({ damping: 200 }),
                output: "perceptual-scale",
              }),
              transformOrigin: "left center",
            }}
          />
        </Interactive.Div>
        <Interactive.Div
          name="Progress value"
          style={{ flexShrink: 0, fontSize: 23, fontWeight: 800, whiteSpace: "nowrap" }}
        >
          {formatMoney(current)} / {formatMoney(target)}
        </Interactive.Div>
      </Interactive.Div>

      <Interactive.Div
        name="Active members badge"
        style={{
          alignItems: "center",
          background: "rgba(255,255,255,.92)",
          borderRadius: 34,
          color: "#131722",
          display: "flex",
          fontSize: 25,
          fontWeight: 900,
          gap: 14,
          padding: "18px 24px",
          position: "absolute",
          right: 72,
          top: 68,
          zIndex: 2,
          translate: interpolate(frame, [0.2 * fps, 1.1 * fps], ["30px 0px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
          }),
        }}
      >
        <Interactive.Div
          name="Live status dot"
          style={{
            background: "#a6f04d",
            borderRadius: 99,
            boxShadow: "0 0 22px rgba(166, 240, 77, .7)",
            height: 18,
            width: 18,
          }}
        />
        {memberCount} active member{memberCount === 1 ? "" : "s"}
      </Interactive.Div>
    </AbsoluteFill>
  );
}

export function WorkspaceMomentum({ current, target, memberCount, personal }: MomentumSceneProps) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return (
    <section className="relative isolate overflow-hidden rounded-[2rem] border border-white/10 bg-[#10131b] shadow-[0_28px_80px_rgba(22,18,35,.16)]">
      <Player
        component={MomentumScene}
        inputProps={{ current, target, memberCount, personal }}
        durationInFrames={120}
        compositionWidth={1600}
        compositionHeight={420}
        fps={30}
        autoPlay={!reduceMotion}
        loop={!reduceMotion}
        controls={false}
        clickToPlay={false}
        style={{ display: "block", width: "100%", aspectRatio: "1600 / 420" }}
      />
    </section>
  );
}
