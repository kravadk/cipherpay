import { QRCodeSVG } from 'qrcode.react';

interface QRDisplayProps {
  value: string;
  size?: number;
}

export function QRDisplay({ value, size = 200 }: QRDisplayProps) {
  return (
    <div className="bg-white p-4 rounded-xl inline-block">
      <QRCodeSVG
        value={value}
        size={size}
        bgColor="#FFFFFF"
        fgColor="#0a0a0a"
        level="H"
        includeMargin={false}
      />
    </div>
  );
}
