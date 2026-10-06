/**
 * GENERATED — Feather-family stroke icons for the shared empty-state badge
 * (components/layout/EmptyStateBadge.tsx). Each entry is the icon's raw SVG
 * node list on Feather's 24x24 grid plus (dx, dy): the offset that moves the
 * geometry's measured bounding-box centre onto the grid centre, so every
 * glyph sits OPTICALLY centred in the badge circle (Feather/lucide glyphs are
 * not all centred in their own 24px box — shopping-bag, tag, send, ...).
 *
 * Sources: "grid", "shopping-bag" and "tag" are Feather's own geometry
 * (MIT, feathericons.com) so they match the profile tab icons exactly; the
 * rest are lucide (ISC, lucide.dev) — Feather's maintained fork, same grid,
 * same stroke language — under their Feather names. Bounding boxes were
 * measured with SVGGraphicsElement.getBBox() in Chromium.
 *
 * Regenerate: node scripts/empty-state-icons/generate.mjs <abs lucide-react dir>
 * <abs out file> <abs artifacts/mobile dir> — do not hand-edit the numbers.
 */
export type EmptyStateIconNode = [tag: 'path' | 'rect' | 'circle' | 'line' | 'polyline' | 'polygon' | 'ellipse', attrs: Record<string, string>];
export interface EmptyStateIcon { nodes: EmptyStateIconNode[]; dx: number; dy: number }

export const EMPTY_STATE_ICONS: Record<string, EmptyStateIcon> = {
  activity: {
    nodes: [
      [
        "path",
        {
          d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "alert-circle": {
    nodes: [
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ],
      [
        "line",
        {
          x1: "12",
          x2: "12",
          y1: "8",
          y2: "12"
        }
      ],
      [
        "line",
        {
          x1: "12",
          x2: "12.01",
          y1: "16",
          y2: "16"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "alert-triangle": {
    nodes: [
      [
        "path",
        {
          d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"
        }
      ],
      [
        "path",
        {
          d: "M12 9v4"
        }
      ],
      [
        "path",
        {
          d: "M12 17h.01"
        }
      ]
    ],
    dx: 0.01,
    dy: 0.007
  },
  archive: {
    nodes: [
      [
        "rect",
        {
          width: "20",
          height: "5",
          x: "2",
          y: "3",
          rx: "1"
        }
      ],
      [
        "path",
        {
          d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"
        }
      ],
      [
        "path",
        {
          d: "M10 12h4"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "at-sign": {
    nodes: [
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "4"
        }
      ],
      [
        "path",
        {
          d: "M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "bar-chart-2": {
    nodes: [
      [
        "path",
        {
          d: "M5 21v-6"
        }
      ],
      [
        "path",
        {
          d: "M12 21V3"
        }
      ],
      [
        "path",
        {
          d: "M19 21V9"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  bell: {
    nodes: [
      [
        "path",
        {
          d: "M10.268 21a2 2 0 0 0 3.464 0"
        }
      ],
      [
        "path",
        {
          d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
        }
      ]
    ],
    dx: -0.001,
    dy: 0
  },
  bookmark: {
    nodes: [
      [
        "path",
        {
          d: "m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  briefcase: {
    nodes: [
      [
        "path",
        {
          d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"
        }
      ],
      [
        "rect",
        {
          width: "20",
          height: "14",
          x: "2",
          y: "6",
          rx: "2"
        }
      ]
    ],
    dx: 0,
    dy: 1
  },
  calendar: {
    nodes: [
      [
        "path",
        {
          d: "M8 2v4"
        }
      ],
      [
        "path",
        {
          d: "M16 2v4"
        }
      ],
      [
        "rect",
        {
          width: "18",
          height: "18",
          x: "3",
          y: "4",
          rx: "2"
        }
      ],
      [
        "path",
        {
          d: "M3 10h18"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "check-circle": {
    nodes: [
      [
        "path",
        {
          d: "M21.801 10A10 10 0 1 1 17 3.335"
        }
      ],
      [
        "path",
        {
          d: "m9 11 3 3L22 4"
        }
      ]
    ],
    dx: -0.002,
    dy: 0.003
  },
  clock: {
    nodes: [
      [
        "path",
        {
          d: "M12 6v6l4 2"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  compass: {
    nodes: [
      [
        "path",
        {
          d: "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  cpu: {
    nodes: [
      [
        "path",
        {
          d: "M12 20v2"
        }
      ],
      [
        "path",
        {
          d: "M12 2v2"
        }
      ],
      [
        "path",
        {
          d: "M17 20v2"
        }
      ],
      [
        "path",
        {
          d: "M17 2v2"
        }
      ],
      [
        "path",
        {
          d: "M2 12h2"
        }
      ],
      [
        "path",
        {
          d: "M2 17h2"
        }
      ],
      [
        "path",
        {
          d: "M2 7h2"
        }
      ],
      [
        "path",
        {
          d: "M20 12h2"
        }
      ],
      [
        "path",
        {
          d: "M20 17h2"
        }
      ],
      [
        "path",
        {
          d: "M20 7h2"
        }
      ],
      [
        "path",
        {
          d: "M7 20v2"
        }
      ],
      [
        "path",
        {
          d: "M7 2v2"
        }
      ],
      [
        "rect",
        {
          x: "4",
          y: "4",
          width: "16",
          height: "16",
          rx: "2"
        }
      ],
      [
        "rect",
        {
          x: "8",
          y: "8",
          width: "8",
          height: "8",
          rx: "1"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "credit-card": {
    nodes: [
      [
        "rect",
        {
          width: "20",
          height: "14",
          x: "2",
          y: "5",
          rx: "2"
        }
      ],
      [
        "line",
        {
          x1: "2",
          x2: "22",
          y1: "10",
          y2: "10"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "dollar-sign": {
    nodes: [
      [
        "line",
        {
          x1: "12",
          x2: "12",
          y1: "2",
          y2: "22"
        }
      ],
      [
        "path",
        {
          d: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "edit-3": {
    nodes: [
      [
        "path",
        {
          d: "M13 21h8"
        }
      ],
      [
        "path",
        {
          d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
        }
      ]
    ],
    dx: 0,
    dy: 0.001
  },
  "file-text": {
    nodes: [
      [
        "path",
        {
          d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
        }
      ],
      [
        "path",
        {
          d: "M14 2v4a2 2 0 0 0 2 2h4"
        }
      ],
      [
        "path",
        {
          d: "M10 9H8"
        }
      ],
      [
        "path",
        {
          d: "M16 13H8"
        }
      ],
      [
        "path",
        {
          d: "M16 17H8"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  film: {
    nodes: [
      [
        "rect",
        {
          width: "18",
          height: "18",
          x: "3",
          y: "3",
          rx: "2"
        }
      ],
      [
        "path",
        {
          d: "M7 3v18"
        }
      ],
      [
        "path",
        {
          d: "M3 7.5h4"
        }
      ],
      [
        "path",
        {
          d: "M3 12h18"
        }
      ],
      [
        "path",
        {
          d: "M3 16.5h4"
        }
      ],
      [
        "path",
        {
          d: "M17 3v18"
        }
      ],
      [
        "path",
        {
          d: "M17 7.5h4"
        }
      ],
      [
        "path",
        {
          d: "M17 16.5h4"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  folder: {
    nodes: [
      [
        "path",
        {
          d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        }
      ]
    ],
    dx: 0,
    dy: 0.5
  },
  "git-branch": {
    nodes: [
      [
        "line",
        {
          x1: "6",
          x2: "6",
          y1: "3",
          y2: "15"
        }
      ],
      [
        "circle",
        {
          cx: "18",
          cy: "6",
          r: "3"
        }
      ],
      [
        "circle",
        {
          cx: "6",
          cy: "18",
          r: "3"
        }
      ],
      [
        "path",
        {
          d: "M18 9a9 9 0 0 1-9 9"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  grid: {
    nodes: [
      [
        "rect",
        {
          x: "3",
          y: "3",
          width: "7",
          height: "7"
        }
      ],
      [
        "rect",
        {
          x: "14",
          y: "3",
          width: "7",
          height: "7"
        }
      ],
      [
        "rect",
        {
          x: "14",
          y: "14",
          width: "7",
          height: "7"
        }
      ],
      [
        "rect",
        {
          x: "3",
          y: "14",
          width: "7",
          height: "7"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  hash: {
    nodes: [
      [
        "line",
        {
          x1: "4",
          x2: "20",
          y1: "9",
          y2: "9"
        }
      ],
      [
        "line",
        {
          x1: "4",
          x2: "20",
          y1: "15",
          y2: "15"
        }
      ],
      [
        "line",
        {
          x1: "10",
          x2: "8",
          y1: "3",
          y2: "21"
        }
      ],
      [
        "line",
        {
          x1: "16",
          x2: "14",
          y1: "3",
          y2: "21"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  heart: {
    nodes: [
      [
        "path",
        {
          d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"
        }
      ]
    ],
    dx: 0,
    dy: -0.492
  },
  image: {
    nodes: [
      [
        "rect",
        {
          width: "18",
          height: "18",
          x: "3",
          y: "3",
          rx: "2",
          ry: "2"
        }
      ],
      [
        "circle",
        {
          cx: "9",
          cy: "9",
          r: "2"
        }
      ],
      [
        "path",
        {
          d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  inbox: {
    nodes: [
      [
        "polyline",
        {
          points: "22 12 16 12 14 15 10 15 8 12 2 12"
        }
      ],
      [
        "path",
        {
          d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  layers: {
    nodes: [
      [
        "path",
        {
          d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"
        }
      ],
      [
        "path",
        {
          d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"
        }
      ],
      [
        "path",
        {
          d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"
        }
      ]
    ],
    dx: -0.008,
    dy: 0.001
  },
  layout: {
    nodes: [
      [
        "rect",
        {
          width: "18",
          height: "18",
          x: "3",
          y: "3",
          rx: "2"
        }
      ],
      [
        "path",
        {
          d: "M3 9h18"
        }
      ],
      [
        "path",
        {
          d: "M9 21V9"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  link: {
    nodes: [
      [
        "path",
        {
          d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
        }
      ],
      [
        "path",
        {
          d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  lock: {
    nodes: [
      [
        "rect",
        {
          width: "18",
          height: "11",
          x: "3",
          y: "11",
          rx: "2",
          ry: "2"
        }
      ],
      [
        "path",
        {
          d: "M7 11V7a5 5 0 0 1 10 0v4"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  mail: {
    nodes: [
      [
        "path",
        {
          d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"
        }
      ],
      [
        "rect",
        {
          x: "2",
          y: "4",
          width: "20",
          height: "16",
          rx: "2"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "map-pin": {
    nodes: [
      [
        "path",
        {
          d: "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "10",
          r: "3"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  menu: {
    nodes: [
      [
        "path",
        {
          d: "M4 5h16"
        }
      ],
      [
        "path",
        {
          d: "M4 12h16"
        }
      ],
      [
        "path",
        {
          d: "M4 19h16"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "message-circle": {
    nodes: [
      [
        "path",
        {
          d: "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  package: {
    nodes: [
      [
        "path",
        {
          d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"
        }
      ],
      [
        "path",
        {
          d: "M12 22V12"
        }
      ],
      [
        "polyline",
        {
          points: "3.29 7 12 12 20.71 7"
        }
      ],
      [
        "path",
        {
          d: "m7.5 4.27 9 5.15"
        }
      ]
    ],
    dx: 0,
    dy: -0.001
  },
  percent: {
    nodes: [
      [
        "line",
        {
          x1: "19",
          x2: "5",
          y1: "5",
          y2: "19"
        }
      ],
      [
        "circle",
        {
          cx: "6.5",
          cy: "6.5",
          r: "2.5"
        }
      ],
      [
        "circle",
        {
          cx: "17.5",
          cy: "17.5",
          r: "2.5"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "play-circle": {
    nodes: [
      [
        "path",
        {
          d: "M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  repeat: {
    nodes: [
      [
        "path",
        {
          d: "m17 2 4 4-4 4"
        }
      ],
      [
        "path",
        {
          d: "M3 11v-1a4 4 0 0 1 4-4h14"
        }
      ],
      [
        "path",
        {
          d: "m7 22-4-4 4-4"
        }
      ],
      [
        "path",
        {
          d: "M21 13v1a4 4 0 0 1-4 4H3"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "rotate-ccw": {
    nodes: [
      [
        "path",
        {
          d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
        }
      ],
      [
        "path",
        {
          d: "M3 3v5h5"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  search: {
    nodes: [
      [
        "path",
        {
          d: "m21 21-4.34-4.34"
        }
      ],
      [
        "circle",
        {
          cx: "11",
          cy: "11",
          r: "8"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  send: {
    nodes: [
      [
        "path",
        {
          d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"
        }
      ],
      [
        "path",
        {
          d: "m21.854 2.147-10.94 10.939"
        }
      ]
    ],
    dx: -0.001,
    dy: 0.001
  },
  shield: {
    nodes: [
      [
        "path",
        {
          d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        }
      ]
    ],
    dx: 0,
    dy: -0.001
  },
  "shopping-bag": {
    nodes: [
      [
        "path",
        {
          d: "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"
        }
      ],
      [
        "line",
        {
          x1: "3",
          y1: "6",
          x2: "21",
          y2: "6"
        }
      ],
      [
        "path",
        {
          d: "M16 10a4 4 0 0 1-8 0"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  slash: {
    nodes: [
      [
        "path",
        {
          d: "M22 2 2 22"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  sliders: {
    nodes: [
      [
        "path",
        {
          d: "M10 8h4"
        }
      ],
      [
        "path",
        {
          d: "M12 21v-9"
        }
      ],
      [
        "path",
        {
          d: "M12 8V3"
        }
      ],
      [
        "path",
        {
          d: "M17 16h4"
        }
      ],
      [
        "path",
        {
          d: "M19 12V3"
        }
      ],
      [
        "path",
        {
          d: "M19 21v-5"
        }
      ],
      [
        "path",
        {
          d: "M3 14h4"
        }
      ],
      [
        "path",
        {
          d: "M5 10V3"
        }
      ],
      [
        "path",
        {
          d: "M5 21v-7"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  star: {
    nodes: [
      [
        "path",
        {
          d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"
        }
      ]
    ],
    dx: 0.001,
    dy: 0.464
  },
  tag: {
    nodes: [
      [
        "path",
        {
          d: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
        }
      ],
      [
        "line",
        {
          x1: "7",
          y1: "7",
          x2: "7.01",
          y2: "7"
        }
      ]
    ],
    dx: 0.414,
    dy: 0.417
  },
  tool: {
    nodes: [
      [
        "path",
        {
          d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"
        }
      ]
    ],
    dx: -0.002,
    dy: 0.001
  },
  "trending-up": {
    nodes: [
      [
        "path",
        {
          d: "M16 7h6v6"
        }
      ],
      [
        "path",
        {
          d: "m22 7-8.5 8.5-5-5L2 17"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  tv: {
    nodes: [
      [
        "path",
        {
          d: "m17 2-5 5-5-5"
        }
      ],
      [
        "rect",
        {
          width: "20",
          height: "15",
          x: "2",
          y: "7",
          rx: "2"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "user-check": {
    nodes: [
      [
        "path",
        {
          d: "m16 11 2 2 4-4"
        }
      ],
      [
        "path",
        {
          d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        }
      ],
      [
        "circle",
        {
          cx: "9",
          cy: "7",
          r: "4"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "user-x": {
    nodes: [
      [
        "path",
        {
          d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        }
      ],
      [
        "circle",
        {
          cx: "9",
          cy: "7",
          r: "4"
        }
      ],
      [
        "line",
        {
          x1: "17",
          x2: "22",
          y1: "8",
          y2: "13"
        }
      ],
      [
        "line",
        {
          x1: "22",
          x2: "17",
          y1: "8",
          y2: "13"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  users: {
    nodes: [
      [
        "path",
        {
          d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"
        }
      ],
      [
        "path",
        {
          d: "M16 3.128a4 4 0 0 1 0 7.744"
        }
      ],
      [
        "path",
        {
          d: "M22 21v-2a4 4 0 0 0-3-3.87"
        }
      ],
      [
        "circle",
        {
          cx: "9",
          cy: "7",
          r: "4"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  video: {
    nodes: [
      [
        "path",
        {
          d: "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"
        }
      ],
      [
        "rect",
        {
          x: "2",
          y: "6",
          width: "14",
          height: "12",
          rx: "2"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "volume-x": {
    nodes: [
      [
        "path",
        {
          d: "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"
        }
      ],
      [
        "line",
        {
          x1: "22",
          x2: "16",
          y1: "9",
          y2: "15"
        }
      ],
      [
        "line",
        {
          x1: "16",
          x2: "22",
          y1: "9",
          y2: "15"
        }
      ]
    ],
    dx: 0,
    dy: -0.001
  },
  "wifi-off": {
    nodes: [
      [
        "path",
        {
          d: "M12 20h.01"
        }
      ],
      [
        "path",
        {
          d: "M8.5 16.429a5 5 0 0 1 7 0"
        }
      ],
      [
        "path",
        {
          d: "M5 12.859a10 10 0 0 1 5.17-2.69"
        }
      ],
      [
        "path",
        {
          d: "M19 12.859a10 10 0 0 0-2.007-1.523"
        }
      ],
      [
        "path",
        {
          d: "M2 8.82a15 15 0 0 1 4.177-2.643"
        }
      ],
      [
        "path",
        {
          d: "M22 8.82a15 15 0 0 0-11.288-3.764"
        }
      ],
      [
        "path",
        {
          d: "m2 2 20 20"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  zap: {
    nodes: [
      [
        "path",
        {
          d: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  user: {
    nodes: [
      [
        "path",
        {
          d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "7",
          r: "4"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "plus-circle": {
    nodes: [
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ],
      [
        "path",
        {
          d: "M8 12h8"
        }
      ],
      [
        "path",
        {
          d: "M12 8v8"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "shopping-cart": {
    nodes: [
      [
        "circle",
        {
          cx: "8",
          cy: "21",
          r: "1"
        }
      ],
      [
        "circle",
        {
          cx: "19",
          cy: "21",
          r: "1"
        }
      ],
      [
        "path",
        {
          d: "M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"
        }
      ]
    ],
    dx: -0.07,
    dy: -0.025
  },
  truck: {
    nodes: [
      [
        "path",
        {
          d: "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"
        }
      ],
      [
        "path",
        {
          d: "M15 18H9"
        }
      ],
      [
        "path",
        {
          d: "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"
        }
      ],
      [
        "circle",
        {
          cx: "17",
          cy: "18",
          r: "2"
        }
      ],
      [
        "circle",
        {
          cx: "7",
          cy: "18",
          r: "2"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  box: {
    nodes: [
      [
        "path",
        {
          d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"
        }
      ],
      [
        "path",
        {
          d: "m3.3 7 8.7 5 8.7-5"
        }
      ],
      [
        "path",
        {
          d: "M12 22V12"
        }
      ]
    ],
    dx: 0,
    dy: -0.001
  },
  gift: {
    nodes: [
      [
        "rect",
        {
          x: "3",
          y: "8",
          width: "18",
          height: "4",
          rx: "1"
        }
      ],
      [
        "path",
        {
          d: "M12 8v13"
        }
      ],
      [
        "path",
        {
          d: "M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"
        }
      ],
      [
        "path",
        {
          d: "M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  camera: {
    nodes: [
      [
        "path",
        {
          d: "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "13",
          r: "3"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  eye: {
    nodes: [
      [
        "path",
        {
          d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "3"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  globe: {
    nodes: [
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ],
      [
        "path",
        {
          d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"
        }
      ],
      [
        "path",
        {
          d: "M2 12h20"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  list: {
    nodes: [
      [
        "path",
        {
          d: "M3 5h.01"
        }
      ],
      [
        "path",
        {
          d: "M3 12h.01"
        }
      ],
      [
        "path",
        {
          d: "M3 19h.01"
        }
      ],
      [
        "path",
        {
          d: "M8 5h13"
        }
      ],
      [
        "path",
        {
          d: "M8 12h13"
        }
      ],
      [
        "path",
        {
          d: "M8 19h13"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  music: {
    nodes: [
      [
        "path",
        {
          d: "M9 18V5l12-2v13"
        }
      ],
      [
        "circle",
        {
          cx: "6",
          cy: "18",
          r: "3"
        }
      ],
      [
        "circle",
        {
          cx: "18",
          cy: "16",
          r: "3"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  phone: {
    nodes: [
      [
        "path",
        {
          d: "M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  settings: {
    nodes: [
      [
        "path",
        {
          d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "3"
        }
      ]
    ],
    dx: 0,
    dy: 0.001
  },
  smile: {
    nodes: [
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ],
      [
        "path",
        {
          d: "M8 14s1.5 2 4 2 4-2 4-2"
        }
      ],
      [
        "line",
        {
          x1: "9",
          x2: "9.01",
          y1: "9",
          y2: "9"
        }
      ],
      [
        "line",
        {
          x1: "15",
          x2: "15.01",
          y1: "9",
          y2: "9"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "thumbs-up": {
    nodes: [
      [
        "path",
        {
          d: "M7 10v12"
        }
      ],
      [
        "path",
        {
          d: "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
        }
      ]
    ],
    dx: 0.085,
    dy: 0
  },
  "trash-2": {
    nodes: [
      [
        "path",
        {
          d: "M10 11v6"
        }
      ],
      [
        "path",
        {
          d: "M14 11v6"
        }
      ],
      [
        "path",
        {
          d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"
        }
      ],
      [
        "path",
        {
          d: "M3 6h18"
        }
      ],
      [
        "path",
        {
          d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  upload: {
    nodes: [
      [
        "path",
        {
          d: "M12 3v12"
        }
      ],
      [
        "path",
        {
          d: "m17 8-5-5-5 5"
        }
      ],
      [
        "path",
        {
          d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  download: {
    nodes: [
      [
        "path",
        {
          d: "M12 15V3"
        }
      ],
      [
        "path",
        {
          d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
        }
      ],
      [
        "path",
        {
          d: "m7 10 5 5 5-5"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "x-circle": {
    nodes: [
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ],
      [
        "path",
        {
          d: "m15 9-6 6"
        }
      ],
      [
        "path",
        {
          d: "m9 9 6 6"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "help-circle": {
    nodes: [
      [
        "circle",
        {
          cx: "12",
          cy: "12",
          r: "10"
        }
      ],
      [
        "path",
        {
          d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
        }
      ],
      [
        "path",
        {
          d: "M12 17h.01"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  award: {
    nodes: [
      [
        "path",
        {
          d: "m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"
        }
      ],
      [
        "circle",
        {
          cx: "12",
          cy: "8",
          r: "6"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "layout-grid": {
    nodes: [
      [
        "rect",
        {
          width: "7",
          height: "7",
          x: "3",
          y: "3",
          rx: "1"
        }
      ],
      [
        "rect",
        {
          width: "7",
          height: "7",
          x: "14",
          y: "3",
          rx: "1"
        }
      ],
      [
        "rect",
        {
          width: "7",
          height: "7",
          x: "14",
          y: "14",
          rx: "1"
        }
      ],
      [
        "rect",
        {
          width: "7",
          height: "7",
          x: "3",
          y: "14",
          rx: "1"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "message-square": {
    nodes: [
      [
        "path",
        {
          d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
        }
      ]
    ],
    dx: 0,
    dy: -0.498
  },
  "refresh-cw": {
    nodes: [
      [
        "path",
        {
          d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
        }
      ],
      [
        "path",
        {
          d: "M21 3v5h-5"
        }
      ],
      [
        "path",
        {
          d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
        }
      ],
      [
        "path",
        {
          d: "M8 16H3v5"
        }
      ]
    ],
    dx: 0,
    dy: 0
  },
  "share-2": {
    nodes: [
      [
        "circle",
        {
          cx: "18",
          cy: "5",
          r: "3"
        }
      ],
      [
        "circle",
        {
          cx: "6",
          cy: "12",
          r: "3"
        }
      ],
      [
        "circle",
        {
          cx: "18",
          cy: "19",
          r: "3"
        }
      ],
      [
        "line",
        {
          x1: "8.59",
          x2: "15.42",
          y1: "13.51",
          y2: "17.49"
        }
      ],
      [
        "line",
        {
          x1: "15.41",
          x2: "8.59",
          y1: "6.51",
          y2: "10.49"
        }
      ]
    ],
    dx: 0,
    dy: 0
  }
};
