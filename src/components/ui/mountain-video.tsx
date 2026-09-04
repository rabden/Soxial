"use client"

import peakMountainPoster from "src/assets/onboarding/peak-mountain.png"
import peakMountainVideo from "src/assets/onboarding/peak-mountain.webm"

export function MountainVideo({ className }: { className?: string }) {
  return (
    <video
      className={className}
      src={peakMountainVideo}
      poster={peakMountainPoster}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      tabIndex={-1}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  )
}
