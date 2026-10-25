import React from 'react';

// Transport and volume icons — inline SVG in currentColor, so they follow the
// button's colour and theme instead of rendering as platform emoji.

function Svg({ size = 18, children, fill = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconPlay = (p) => <Svg fill {...p}><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></Svg>;
export const IconPause = (p) => <Svg fill {...p}><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></Svg>;
export const IconPrev = (p) => <Svg fill {...p}><path d="M18 5.5v13a1 1 0 0 1-1.55.83L7 13v5a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5l9.45-6.33A1 1 0 0 1 18 5.5z" /></Svg>;
export const IconNext = (p) => <Svg fill {...p}><path d="M6 5.5v13a1 1 0 0 0 1.55.83L17 13v5a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v5L7.55 4.67A1 1 0 0 0 6 5.5z" /></Svg>;
export const IconShuffle = (p) => (
  <Svg {...p}>
    <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" />
  </Svg>
);
export const IconRepeat = (p) => (
  <Svg {...p}>
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </Svg>
);
export const IconRepeatOne = (p) => (
  <Svg {...p}>
    <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    <path d="M11 10.5l1.5-1v5" strokeWidth="1.8" />
  </Svg>
);
export const IconVolume = (p) => (
  <Svg {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </Svg>
);
export const IconVolumeMuted = (p) => (
  <Svg {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
    <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
  </Svg>
);
