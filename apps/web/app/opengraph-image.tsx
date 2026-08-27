import { ImageResponse } from "next/og";

export const alt = "AT Storage — Your files. Your account.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 84px",
          backgroundColor: "#f2f0e8",
          color: "#171815",
          border: "16px solid #e4e0d4",
          boxSizing: "border-box",
        }}
      >
        {/* Masthead */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #c5c1b5",
            paddingBottom: "24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div
              style={{
                width: "44px",
                height: "44px",
                borderRadius: "8px",
                backgroundColor: "#224f3d",
                color: "#f6fff9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                fontWeight: 800,
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              A
            </div>
            <span
              style={{
                fontSize: "30px",
                fontWeight: 800,
                letterSpacing: "-0.03em",
                color: "#171815",
                fontFamily: "Arial, Helvetica, sans-serif",
              }}
            >
              AT Storage
            </span>
          </div>

          <div
            style={{
              padding: "6px 14px",
              borderRadius: "6px",
              backgroundColor: "#e4e0d4",
              border: "1px solid #c5c1b5",
              color: "#7a3d12",
              fontSize: "14px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            EXPERIMENTAL ALPHA
          </div>
        </div>

        {/* Hero Copy */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "1020px" }}>
          <div
            style={{
              fontSize: "72px",
              fontWeight: 500,
              lineHeight: 1.05,
              letterSpacing: "-0.04em",
              color: "#171815",
              fontFamily: "Georgia, 'Times New Roman', serif",
            }}
          >
            Your files. Your account.
          </div>
          <div
            style={{
              fontSize: "27px",
              lineHeight: 1.5,
              color: "#62635d",
              fontWeight: 400,
              fontFamily: "Arial, Helvetica, sans-serif",
            }}
          >
            AT Storage keeps exact media originals in an owner-only permissioned Space, organizes
            them into albums. Other file types will be added soon™
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #c5c1b5",
            paddingTop: "24px",
            fontFamily: "Arial, Helvetica, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "8px 16px",
              borderRadius: "6px",
              backgroundColor: "#224f3d",
              color: "#f6fff9",
              fontSize: "16px",
              fontWeight: 600,
            }}
          >
            Built on AT Protocol
          </div>

          <span
            style={{
              fontSize: "22px",
              color: "#224f3d",
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            atgallery.noz.am
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
