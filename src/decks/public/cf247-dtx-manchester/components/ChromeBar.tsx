import { CloudflareLogo } from "./CloudflareLogo";

type Props = {
  current: number; // 1-indexed
  total: number;
};

/**
 * Chrome strips at the top + bottom of every content slide.
 *
 * - Top: Cloudflare × Car Finance 247 partnership lockup (left),
 *   DTX Manchester event tag (right).
 * - Bottom: speaker name (left), progress indicator (right).
 *
 * Hidden on the backdrop slide via Frame's `variant="backdrop"`.
 */
export function ChromeBar({ current, total }: Props) {
  const fillPct = Math.round((current / total) * 100);

  return (
    <>
      <div className="chrome-top">
        <div className="chrome__brand">
          <CloudflareLogo />
          <span>Cloudflare</span>
          <span className="chrome__brand-x" aria-hidden="true">
            ×
          </span>
          <img
            src="/cf247-dtx-manchester/logos/carfinance247.png"
            alt=""
            aria-hidden="true"
            className="chrome__brand-logo"
          />
          <span>Car Finance 247</span>
        </div>
        <div
          className="chrome__event"
          style={{ display: "inline-flex", alignItems: "center", gap: 10 }}
        >
          <img
            src="/cf247-dtx-manchester/photos/dtx-logo.png"
            alt=""
            aria-hidden="true"
            className="chrome__brand-logo chrome__dtx-logo"
          />
          <span>Manchester · 29.04.26</span>
        </div>
      </div>

      <div className="chrome-bottom">
        <div className="chrome__event">Miguel Caetano Dias</div>
        <div className="chrome__progress">
          <div className="chrome__progress-text">
            {String(current).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </div>
          <div className="chrome__progress-bar">
            <div className="chrome__progress-fill" style={{ width: `${fillPct}%` }} />
          </div>
        </div>
      </div>
    </>
  );
}
