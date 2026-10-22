/** Small line icons, drawn in the current text color. */

const base = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const BellIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? "currentColor" : "none"}>
    <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8z" />
    <path d="M6.6 14a1.5 1.5 0 0 0 2.8 0" fill="none" />
  </svg>
);

export const PinIcon = ({ filled = false }: { filled?: boolean }) => (
  <svg {...base} fill={filled ? "currentColor" : "none"}>
    <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6z" />
    <path d="M8 8.5V14" fill="none" />
  </svg>
);

export const CalendarIcon = () => (
  <svg {...base}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg {...base} width={10} height={10} style={{ transform: open ? "rotate(90deg)" : undefined }}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const PlusIcon = () => (
  <svg {...base} width={12} height={12}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const CloseIcon = () => (
  <svg {...base} width={10} height={10}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
