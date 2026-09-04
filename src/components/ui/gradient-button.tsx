"use client";

import * as React from "react";
import { cn } from "src/lib/utils";

export interface GradientButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

const GRADIENT_LAYERS = [
  { delay: "0s", duration: "25s" },
  { delay: "0.15s", duration: "15.9s" },
  { delay: "0.53s", duration: "26.4s" },
  { delay: "0.45s", duration: "17.8s" },
  { delay: "1.6s", duration: "19.2s" },
  { delay: "1.6s", duration: "29.2s" },
  { delay: "1.6s", duration: "20.2s" },
];

export const GradientButton = React.forwardRef<
  HTMLButtonElement,
  GradientButtonProps
>(({ className, children = "Start", type = "button", ...props }, ref) => {
  return (
    <>
      <style>{`
        .btn-wrapper-root {
          --rad: 32px;
          --color-wrapper-border: #ffffff;
          --color-btn-bg: #ff0000;
          --color-btn-text: #000000;
          --color-btn-text-shadow: #ffffff;
          --color-btn-inset-shadow: #555588;
          --color-layer-a: #ffffff;
          --color-layer-b: #0000ff;
          --color-overlay-text: #000000;
          --color-overlay-glow: #ffffff;
          --color-overlay-shadow: rgba(0, 0, 0, 0.267);
          --color-overlay-highlight: rgba(255, 255, 255, 0.333);

          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          overflow: clip;
          overflow-clip-margin: 4px;
          padding: 0;
          background: transparent;
          cursor: pointer;
          border: 2px solid var(--color-wrapper-border);
          border-radius: var(--rad);
          font-family: inherit;
          font-size: 1.5rem;
          font-weight: 600;
          filter: saturate(0.65) brightness(1.8);
          user-select: none;
          outline: none;
          transition: transform 0.15s ease;
        }

        .btn-wrapper-root:active {
          transform: scale(0.96);
        }

        .btn-wrapper-root:focus-visible {
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.5);
        }

        .btn-wrapper-root .gradient-layer {
          position: absolute;
          pointer-events: none;
          left: -160px;
          width: 500%;
          aspect-ratio: 1;
          background: radial-gradient(
            ellipse at 65% 180%,
            var(--color-layer-a),
            var(--color-layer-b),
            var(--color-layer-a),
            var(--color-layer-b),
            var(--color-layer-a),
            var(--color-layer-b),
            var(--color-layer-a),
            var(--color-layer-b),
            var(--color-layer-a),
            var(--color-layer-b),
            var(--color-layer-a)
          );
          mix-blend-mode: difference;
          animation: rotate-anim 8s linear infinite;
        }

        .btn-wrapper-root .gradient-layer:nth-child(8) {
          mix-blend-mode: color-dodge;
        }

        @keyframes rotate-anim {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .btn-wrapper-root .gradient-bg {
          position: relative;
          z-index: 0;
          padding: 12px 36px;
          border: none;
          border-radius: var(--rad);
          font-family: inherit;
          font-size: inherit;
          font-weight: inherit;
          letter-spacing: 0.15rem;
          color: transparent;
          background-color: var(--color-btn-bg);
          background-size: 200% 200%;
          box-shadow: inset 0 0 10px 9px var(--color-btn-inset-shadow);
          text-shadow: none;
          mix-blend-mode: color-dodge;
          pointer-events: none;
        }

        .btn-wrapper-root .gradient-bg::after {
          content: "";
          position: absolute;
          pointer-events: none;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          border-radius: var(--rad);
          background-size: 200% 200%;
          mix-blend-mode: difference;
          z-index: 1;
        }

        .btn-wrapper-root .text-overlay {
          position: absolute;
          pointer-events: none;
          z-index: 2;
          padding: 12px 36px;
          border-radius: var(--rad);
          font-family: inherit;
          font-size: inherit;
          font-weight: inherit;
          letter-spacing: 0.15rem;
          color: #000000;
          text-shadow: 0 1px 3px rgba(255, 255, 255, 0.65);
          box-shadow:
            inset 0 -4px 4px 0 var(--color-overlay-shadow),
            inset 0 4px 4px 0 var(--color-overlay-highlight);
          mix-blend-mode: normal;
          opacity: 1;
          transition: transform 0.2s ease;
        }

        .btn-wrapper-root:hover .text-overlay {
          transform: scale(1.06);
        }

        .btn-wrapper-root .light-bar {
          position: absolute;
          pointer-events: none;
          z-index: 1;
          border-radius: 50px;
          width: 80%;
          height: 1.9rem;
          aspect-ratio: 1;
          background-color: rgba(255, 255, 255, 0.333);
          filter: blur(5px);
          animation: pulse-light-anim 3s ease-in-out infinite;
        }

        @keyframes pulse-light-anim {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.1; }
        }

        @keyframes opacityPulse-anim {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>

      <button
        ref={ref}
        type={type}
        className={cn("btn-wrapper-root", className)}
        {...props}
      >
        <div className="light-bar" />
        {GRADIENT_LAYERS.map((layer, index) => (
          <div
            key={index}
            className="gradient-layer"
            style={{
              animationDelay: layer.delay,
              animationDuration: layer.duration,
            }}
          />
        ))}
        <div className="gradient-bg">{children}</div>
        <div className="text-overlay">{children}</div>
      </button>
    </>
  );
});

GradientButton.displayName = "GradientButton";
