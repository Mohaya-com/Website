'use client';

import { useMemo } from 'react';
import QRCode from 'qrcode';

/** Renders a QR code as crisp inline SVG (no network, no canvas). */
export function QrCode({ value, size = 240, label, className }: { value: string; size?: number; label: string; className?: string }) {
  const { path, dimension } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const quiet = 4;
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (qr.modules.get(y, x)) d += `M${x + quiet},${y + quiet}h1v1h-1z`;
      }
    }
    return { path: d, dimension: n + quiet * 2 };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${dimension} ${dimension}`}
      shapeRendering="crispEdges"
      className={className}
      style={{ direction: 'ltr' }}
    >
      <rect width={dimension} height={dimension} fill="#fff" />
      <path d={path} fill="#0b1f3a" />
    </svg>
  );
}
