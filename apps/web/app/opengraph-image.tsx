import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'T & A Gallery — Curated GIFs & Short Videos';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '24px',
          }}
        >
          <div
            style={{
              fontSize: '72px',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-2px',
            }}
          >
            T & A Gallery
          </div>
          <div
            style={{
              fontSize: '28px',
              color: '#a0a0b0',
              letterSpacing: '4px',
              textTransform: 'uppercase',
            }}
          >
            Curated Motion
          </div>
          <div
            style={{
              display: 'flex',
              gap: '16px',
              marginTop: '24px',
            }}
          >
            {['GIFs', 'Videos', 'Trending'].map((label) => (
              <div
                key={label}
                style={{
                  padding: '8px 24px',
                  border: '1px solid #333',
                  color: '#888',
                  fontSize: '18px',
                  letterSpacing: '2px',
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
