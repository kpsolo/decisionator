import { useMemo } from "react";
import { encode } from "uqr";

/**
 * A QR code drawn as one SVG path. Dark modules on a white plate in both themes: scanners need
 * the contrast and the quiet zone, whatever the page colours are.
 */
export function QrCode({
  value,
  label,
  size = 192,
}: { value: string; label: string; size?: number }) {
  const { path, dimension } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    let d = "";
    qr.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { path: d, dimension: qr.size };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}
