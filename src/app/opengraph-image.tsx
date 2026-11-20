import { ImageResponse } from "next/og";

// The picture shown when a MERCYMAP link is shared. Words only; no people.
export const alt = "MERCYMAP: turning church compassion into coordinated community impact";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#174d3a", color: "#faf8f2" }}>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 800, letterSpacing: 2 }}>
          <span>MERCY</span>
          <span style={{ color: "#c5a15b" }}>MAP</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1, maxWidth: 980 }}>
            Turning church compassion into coordinated community impact.
          </div>
          <div style={{ marginTop: 28, fontSize: 28, color: "#e5efe8", maxWidth: 980 }}>
            “…because you did it to one of the least of these my brothers, you did it to me.” Matthew 25:40 (WEB)
          </div>
        </div>
      </div>
    ),
    size,
  );
}
