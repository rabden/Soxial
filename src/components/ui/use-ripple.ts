import * as React from "react";

// --- TUNED CONSTANTS (MD3 Physics Configuration) ---
const PRESS_GROW_MS = 450;
const MINIMUM_PRESS_MS = 300;
const INITIAL_ORIGIN_SCALE = 0.2;
const PADDING = 10;
const SOFT_EDGE_MINIMUM_SIZE = 75;
const SOFT_EDGE_CONTAINER_RATIO = 0.35;
const ANIMATION_FILL = "forwards";
const TOUCH_DELAY_MS = 150;
const EASING_STANDARD = "cubic-bezier(0.2, 0, 0, 1)";

// --- TYPES & STATE MACHINE ---
enum RippleState {
  INACTIVE,
  TOUCH_DELAY,
  HOLDING,
  WAITING_FOR_CLICK,
}

// --- MATERIAL RIPPLE HOOK ---
const useMaterialRipple = (disabled = false) => {
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const rippleEffectRef = React.useRef<HTMLDivElement>(null);

  const stateRef = React.useRef(RippleState.INACTIVE);
  const rippleStartEventRef = React.useRef<React.PointerEvent | null>(null);
  const growAnimationRef = React.useRef<Animation | null>(null);

  const initialSizeRef = React.useRef(0);
  const rippleScaleRef = React.useRef("");
  const rippleSizeRef = React.useRef("");

  const isTouch = (event: React.PointerEvent) => event.pointerType === "touch";

  const shouldReactToEvent = (event: React.PointerEvent) => {
    if (disabled || !event.isPrimary) return false;
    if (
      rippleStartEventRef.current &&
      rippleStartEventRef.current.pointerId !== event.pointerId
    ) {
      return false;
    }
    if (event.type === "pointerenter" || event.type === "pointerleave") {
      return !isTouch(event);
    }
    const isPrimaryButton = event.buttons === 1;
    return isTouch(event) || isPrimaryButton;
  };

  const determineRippleSize = () => {
    if (!surfaceRef.current) return;
    const { height, width } = surfaceRef.current.getBoundingClientRect();
    const maxDim = Math.max(height, width);
    const softEdgeSize = Math.max(
      SOFT_EDGE_CONTAINER_RATIO * maxDim,
      SOFT_EDGE_MINIMUM_SIZE
    );

    const initialSize = Math.floor(maxDim * INITIAL_ORIGIN_SCALE);
    const hypotenuse = Math.sqrt(width ** 2 + height ** 2);
    const maxRadius = hypotenuse + PADDING;

    initialSizeRef.current = initialSize;
    const rippleScale = (maxRadius + softEdgeSize) / initialSize;

    rippleScaleRef.current = `${rippleScale}`;
    rippleSizeRef.current = `${initialSize}px`;
  };

  const getTranslationCoordinates = (event?: React.PointerEvent) => {
    if (!surfaceRef.current)
      return { startPoint: { x: 0, y: 0 }, endPoint: { x: 0, y: 0 } };
    const { height, width, left, top } =
      surfaceRef.current.getBoundingClientRect();

    const endPoint = {
      x: (width - initialSizeRef.current) / 2,
      y: (height - initialSizeRef.current) / 2,
    };

    let startPoint;
    if (event) {
      startPoint = {
        x: event.clientX - left,
        y: event.clientY - top,
      };
    } else {
      startPoint = {
        x: width / 2,
        y: height / 2,
      };
    }

    startPoint = {
      x: startPoint.x - initialSizeRef.current / 2,
      y: startPoint.y - initialSizeRef.current / 2,
    };

    return { startPoint, endPoint };
  };

  const startPressAnimation = (event?: React.PointerEvent) => {
    setPressed(true);
    if (!rippleEffectRef.current) return;

    growAnimationRef.current?.cancel();
    determineRippleSize();

    const { startPoint, endPoint } = getTranslationCoordinates(event);

    growAnimationRef.current = rippleEffectRef.current.animate(
      {
        top: [0, 0],
        left: [0, 0],
        height: [rippleSizeRef.current, rippleSizeRef.current],
        width: [rippleSizeRef.current, rippleSizeRef.current],
        transform: [
          `translate(${startPoint.x}px, ${startPoint.y}px) scale(1)`,
          `translate(${endPoint.x}px, ${endPoint.y}px) scale(${rippleScaleRef.current})`,
        ],
      },
      {
        duration: PRESS_GROW_MS,
        easing: EASING_STANDARD,
        fill: ANIMATION_FILL,
      }
    );
  };

  const endPressAnimation = async () => {
    rippleStartEventRef.current = null;
    stateRef.current = RippleState.INACTIVE;

    const animation = growAnimationRef.current;
    let pressAnimationPlayState = Infinity;

    if (animation && typeof animation.currentTime === "number") {
      pressAnimationPlayState = animation.currentTime;
    }

    if (pressAnimationPlayState < MINIMUM_PRESS_MS) {
      await new Promise((resolve) => {
        setTimeout(resolve, MINIMUM_PRESS_MS - pressAnimationPlayState);
      });
    }

    if (growAnimationRef.current !== animation) return;

    setPressed(false);
  };

  const handlePointerDown = async (event: React.PointerEvent) => {
    if (!shouldReactToEvent(event)) return;
    rippleStartEventRef.current = event;

    if (!isTouch(event)) {
      stateRef.current = RippleState.WAITING_FOR_CLICK;
      startPressAnimation(event);
      return;
    }

    stateRef.current = RippleState.TOUCH_DELAY;
    await new Promise((resolve) => setTimeout(resolve, TOUCH_DELAY_MS));

    if (stateRef.current !== RippleState.TOUCH_DELAY) return;

    stateRef.current = RippleState.HOLDING;
    startPressAnimation(event);
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!shouldReactToEvent(event)) return;
    if (stateRef.current === RippleState.HOLDING) {
      stateRef.current = RippleState.WAITING_FOR_CLICK;
      return;
    }
    if (stateRef.current === RippleState.TOUCH_DELAY) {
      stateRef.current = RippleState.WAITING_FOR_CLICK;
      startPressAnimation(rippleStartEventRef.current || undefined);
      return;
    }
  };

  const handlePointerEnter = (event: React.PointerEvent) => {
    if (!shouldReactToEvent(event)) return;
    setHovered(true);
  };

  const handlePointerLeave = (event: React.PointerEvent) => {
    if (!shouldReactToEvent(event)) return;
    setHovered(false);
    if (stateRef.current !== RippleState.INACTIVE) {
      endPressAnimation();
    }
  };

  const handleClick = () => {
    if (disabled) return;
    if (stateRef.current === RippleState.WAITING_FOR_CLICK) {
      endPressAnimation();
      return;
    }
    if (stateRef.current === RippleState.INACTIVE) {
      startPressAnimation();
      endPressAnimation();
    }
  };

  return {
    surfaceRef,
    rippleEffectRef,
    hovered,
    pressed,
    events: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave,
      onClick: handleClick,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      },
    },
  };
};

export { useMaterialRipple };
