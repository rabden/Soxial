import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn, openExternalUrl } from "src/lib/utils";
import { playTactilePopSound } from "src/components/ui/tactile-sound";
import { useMaterialRipple } from "src/components/ui/use-ripple";

// --- 1. RIPPLE COMPONENT ---
interface RippleProps {
  hovered: boolean;
  pressed: boolean;
  rippleEffectRef: React.RefObject<HTMLDivElement | null>;
}

const Ripple = React.forwardRef<HTMLDivElement, RippleProps>(
  ({ hovered, pressed, rippleEffectRef }, ref) => {
    return (
      <div
        ref={ref}
        className="absolute inset-0 overflow-hidden rounded-[inherit] pointer-events-none z-0 surface"
        aria-hidden="true"
      >
        <div
          className={cn(
            "absolute inset-0 bg-current transition-opacity duration-200 linear",
            hovered ? "opacity-[0.08]" : "opacity-0",
            pressed && "opacity-[0.12]"
          )}
        />
        <div
          ref={rippleEffectRef}
          className="absolute rounded-full opacity-0 bg-current"
          style={{
            background:
              "radial-gradient(closest-side, currentColor max(calc(100% - 70px), 65%), transparent 100%)",
            transition: "opacity 375ms linear",
            opacity: pressed ? "0.25" : "0",
            transitionDuration: pressed ? "105ms" : "375ms",
          }}
        />
      </div>
    );
  }
);
Ripple.displayName = "Ripple";

// --- 2. DEPTH SHADOWS (Play Store badge recipe, per variant) ---
// Layer order mirrors the marketing-site store badges:
//   1. seam ring (0 0 0 1px)  — machined hairline around the badge
//   2. contact shadow         — tight shadow where the badge meets the page
//   3. ambient drop           — deep soft shadow floating the badge
//   4. inset top light        — 1px machined top-edge highlight
//   5. inset bottom bevel     — 3px recessed bottom edge
// Every state keeps the same layers (alpha 0 when hidden) so CSS interpolates
// smoothly idle -> hover -> pressed. Hover deepens the drops only — no lift.
const DEPTH_SHADOWS: Record<string, { idle: string; hover: string; pressed: string }> = {
  default: {
    // Silver store badge (the "light" badge): dark seam, bright top light,
    // soft bottom bevel, deep cool float
    idle: '0 0 0 1px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.45), 0 12px 24px -4px rgba(0,0,0,0.85), inset 0 1px 1px rgba(255,255,255,0.95), inset 0 -3px 6px rgba(0,0,0,0.22)',
    hover: '0 0 0 1px rgba(0,0,0,0.35), 0 6px 12px -2px rgba(0,0,0,0.5), 0 20px 32px -6px rgba(0,0,0,0.95), inset 0 1px 1px rgba(255,255,255,1), inset 0 -3px 6px rgba(0,0,0,0.22)',
    pressed: '0 0 0 1px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.4), 0 5px 14px -4px rgba(0,0,0,0.7), inset 0 2px 5px rgba(0,0,0,0.28), inset 0 -2px 4px rgba(0,0,0,0.18)',
  },
  destructive: {
    // Red store badge: light seam, red-tinted float, machined top-light
    idle: '0 0 0 1px rgba(255,255,255,0.08), 0 2px 4px rgba(0,0,0,0.6), 0 12px 24px -4px rgba(120,20,20,0.6), inset 0 1px 1px rgba(255,255,255,0.22), inset 0 -3px 6px rgba(0,0,0,0.6)',
    hover: '0 0 0 1px rgba(255,255,255,0.12), 0 6px 12px -2px rgba(0,0,0,0.7), 0 20px 32px -6px rgba(140,25,25,0.7), inset 0 1px 1px rgba(255,255,255,0.28), inset 0 -3px 6px rgba(0,0,0,0.6)',
    pressed: '0 0 0 1px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.5), 0 5px 14px -4px rgba(100,15,15,0.5), inset 0 2px 5px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.55)',
  },
  outline: {
    // Border store badge: the seam IS the border — light hairline, shallow float
    idle: '0 0 0 1px rgba(255,255,255,0.14), 0 2px 4px rgba(0,0,0,0.4), 0 12px 24px -4px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.06), inset 0 -3px 6px rgba(0,0,0,0.35)',
    hover: '0 0 0 1px rgba(255,255,255,0.22), 0 6px 12px -2px rgba(0,0,0,0.5), 0 20px 32px -6px rgba(0,0,0,0.7), inset 0 1px 1px rgba(255,255,255,0.1), inset 0 -3px 6px rgba(0,0,0,0.35)',
    pressed: '0 0 0 1px rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.35), 0 5px 14px -4px rgba(0,0,0,0.5), inset 0 2px 5px rgba(0,0,0,0.25), inset 0 -2px 4px rgba(0,0,0,0.3)',
  },
  secondary: {
    // Dark store badge: direct port of btn-modern-dark — light seam, deep
    // twin drop, dim top-light, heavy bottom bevel
    idle: '0 0 0 1px rgba(255,255,255,0.10), 0 2px 4px rgba(0,0,0,0.6), 0 12px 24px -4px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.15), inset 0 -3px 6px rgba(0,0,0,0.8)',
    hover: '0 0 0 1px rgba(255,255,255,0.14), 0 6px 12px -2px rgba(0,0,0,0.7), 0 20px 32px -6px rgba(0,0,0,1), inset 0 1px 1px rgba(255,255,255,0.2), inset 0 -3px 6px rgba(0,0,0,0.8)',
    pressed: '0 0 0 1px rgba(255,255,255,0.07), 0 1px 2px rgba(0,0,0,0.5), 0 5px 14px -4px rgba(0,0,0,0.7), inset 0 2px 5px rgba(0,0,0,0.45), inset 0 -2px 4px rgba(0,0,0,0.7)',
  },
  ghost: {
    // Transparent store badge: calm seat at rest; on hover the seam ignites
    // into the badge ring + contact/drop pair + inner lights
    idle: '0 0 0 1px rgba(255,255,255,0), 0 2px 4px rgba(0,0,0,0), 0 12px 24px -4px rgba(0,0,0,0), inset 0 1px 1px rgba(255,255,255,0), inset 0 -3px 6px rgba(0,0,0,0)',
    hover: '0 0 0 1px rgba(255,255,255,0.08), 0 6px 12px -2px rgba(0,0,0,0.45), 0 20px 32px -6px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.07), inset 0 -3px 6px rgba(0,0,0,0.3)',
    pressed: '0 0 0 1px rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.3), 0 5px 14px -4px rgba(0,0,0,0.4), inset 0 2px 5px rgba(0,0,0,0.2), inset 0 -2px 4px rgba(0,0,0,0.25)',
  },
  elevated: {
    // Lifted card badge: brightest seam + deepest twin drop of the set
    idle: '0 0 0 1px rgba(255,255,255,0.08), 0 2px 4px rgba(0,0,0,0.6), 0 16px 32px -6px rgba(0,0,0,0.95), inset 0 1px 1px rgba(255,255,255,0.13), inset 0 -3px 6px rgba(0,0,0,0.7)',
    hover: '0 0 0 1px rgba(255,255,255,0.12), 0 6px 12px -2px rgba(0,0,0,0.65), 0 24px 40px -8px rgba(0,0,0,1), inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -3px 6px rgba(0,0,0,0.7)',
    pressed: '0 0 0 1px rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.5), 0 6px 16px -4px rgba(0,0,0,0.7), inset 0 2px 5px rgba(0,0,0,0.4), inset 0 -2px 4px rgba(0,0,0,0.6)',
  },
  link: {
    idle: '0 0 0 1px rgba(255,255,255,0), 0 2px 4px rgba(0,0,0,0), 0 12px 24px -4px rgba(0,0,0,0), inset 0 1px 1px rgba(255,255,255,0), inset 0 -3px 6px rgba(0,0,0,0)',
    hover: '0 0 0 1px rgba(255,255,255,0), 0 2px 4px rgba(0,0,0,0), 0 12px 24px -4px rgba(0,0,0,0), inset 0 1px 1px rgba(255,255,255,0), inset 0 -3px 6px rgba(0,0,0,0)',
    pressed: '0 0 0 1px rgba(255,255,255,0), 0 2px 4px rgba(0,0,0,0), 0 12px 24px -4px rgba(0,0,0,0), inset 0 1px 1px rgba(255,255,255,0), inset 0 -3px 6px rgba(0,0,0,0)',
  },
};

// Badge fills: the store badges sit on a vertical gradient (light badge:
// background -> muted; dark badge: secondary -> card). Applied per variant
// with the same 180deg recipe, static across states so only shadows animate.
const DEPTH_GRADIENTS: Record<string, string> = {
  default:
    "linear-gradient(180deg, color-mix(in oklab, hsl(var(--btn-primary-bg)), white 20%) 0%, color-mix(in oklab, hsl(var(--btn-primary-bg)), black 8%) 100%)",
  secondary: "linear-gradient(180deg, hsl(var(--secondary)) 0%, hsl(var(--card)) 100%)",
  destructive:
    "linear-gradient(180deg, color-mix(in oklab, hsl(var(--destructive)), white 14%) 0%, color-mix(in oklab, hsl(var(--destructive)), black 22%) 100%)",
  elevated: "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--background)) 100%)",
};

function resolveDepthShadow(
  variant: string | null | undefined,
  depthShadow: boolean,
  hovered: boolean,
  pressed: boolean,
): { shadow?: string; gradient?: string } {
  if (!depthShadow) return {};
  const v = (variant as string) || 'default';
  const shadows = DEPTH_SHADOWS[v] || DEPTH_SHADOWS.default;
  return {
    shadow: pressed ? shadows.pressed : hovered ? shadows.hover : shadows.idle,
    gradient: DEPTH_GRADIENTS[v],
  };
}

// --- 3. MD3 EXPRESSIVE BUTTON VARIANTS (SHADCN API ALIGNED) ---
const buttonVariants = cva(
  "group relative inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap font-medium tracking-[0.01em] transition-[background-color,color,box-shadow,border-radius,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-[0.38] disabled:shadow-none overflow-hidden [&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-[cubic-bezier(0.2,0.8,0.2,1.2)] data-[pressed=true]:[&_svg]:scale-[0.90]",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--btn-primary-bg))] text-[hsl(var(--btn-primary-foreground))] shadow-sm hover:shadow",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:shadow",
        outline: "bg-transparent text-foreground shadow-none border border-border hover:bg-secondary/20",
        secondary: "bg-secondary/50 text-secondary-foreground shadow-none hover:bg-secondary/70",
        ghost: "bg-transparent text-primary shadow-none hover:bg-primary/10",
        link: "text-primary underline-offset-4 hover:underline",
        elevated: "bg-card text-card-foreground shadow-md hover:shadow-lg data-[pressed=true]:shadow-sm",
      },
      size: {
        // Core Sizes
        default: "py-[10px] px-[16px] gap-[8px] text-sm", 
        sm: "py-[6px] px-[12px] gap-[8px] text-sm",       
        lg: "py-[16px] px-[24px] gap-[8px] text-base",    
        icon: "p-[8px] w-[40px] h-[40px]",
        // Expressive Scales
        xl: "py-[32px] px-[48px] gap-[12px] text-2xl",    
        "2xl": "py-[48px] px-[64px] gap-[16px] text-3xl", 
        "icon-sm": "p-[6px] w-[32px] h-[32px]",
        "icon-lg": "p-[16px] w-[56px] h-[56px]",
        "icon-xl": "p-[32px] w-[96px] h-[96px]",
        "icon-2xl": "p-[48px] w-[136px] h-[136px]",
      },
      shape: {
        round: "", 
        square: "",
        "split-left": "",  // Automatically injected by SplitButton
        "split-right": "", // Automatically injected by SplitButton
        "split-left-square": "",  // Square variant for SplitButton
        "split-right-square": "", // Square variant for SplitButton
      },
    },
    compoundVariants: [
      // Scale on press — opt-in via scaleOnPress prop (override inner icon scale)
      // Applied via runtime style below to avoid Tailwind compound data-variant issues
      // Nullify borders on non-outline variants to prevent stroke artifacts
      { variant: ["default", "destructive", "secondary", "ghost", "link", "elevated"], className: "border-transparent" },
      // Expressive outlined dynamic border-widths
      { variant: "outline", size: ["xl", "icon-xl"], className: "border-2" },
      { variant: "outline", size: ["2xl", "icon-2xl"], className: "border-[3px]" },
      
      // SHAPE PHYSICS: Standard "Round" Morphing (Pill -> Squish)
      { shape: "round", size: ["sm", "icon-sm"], className: "rounded-[16px] data-[pressed=true]:rounded-[8px]" },
      { shape: "round", size: ["default", "icon"], className: "rounded-[20px] data-[pressed=true]:rounded-[8px]" },
      { shape: "round", size: ["lg", "icon-lg"], className: "rounded-[28px] data-[pressed=true]:rounded-[12px]" },
      { shape: "round", size: ["xl", "icon-xl"], className: "rounded-[48px] data-[pressed=true]:rounded-[16px]" },
      { shape: "round", size: ["2xl", "icon-2xl"], className: "rounded-[68px] data-[pressed=true]:rounded-[16px]" },

      // SHAPE PHYSICS: Standard "Square" Morphing (Squish -> Pill)
      { shape: "square", size: ["sm", "icon-sm"], className: "rounded-[12px] data-[pressed=true]:rounded-[16px]" },
      { shape: "square", size: ["default", "icon"], className: "rounded-[12px] data-[pressed=true]:rounded-[20px]" },
      { shape: "square", size: ["lg", "icon-lg"], className: "rounded-[16px] data-[pressed=true]:rounded-[28px]" },
      { shape: "square", size: ["xl", "icon-xl"], className: "rounded-[28px] data-[pressed=true]:rounded-[48px]" },
      { shape: "square", size: ["2xl", "icon-2xl"], className: "rounded-[28px] data-[pressed=true]:rounded-[68px]" },

      // SPLIT-LEFT PHYSICS (Your custom tweaks implemented)
      { shape: "split-left", size: ["sm", "icon-sm"], className: "rounded-l-[16px] rounded-r-[4px] data-[pressed=true]:rounded-l-[16px] data-[pressed=true]:rounded-r-[16px]" },
      { shape: "split-left", size: ["default", "icon"], className: "rounded-l-[24px] rounded-r-[4px] data-[pressed=true]:rounded-l-[24px] data-[pressed=true]:rounded-r-[24px]" },
      { shape: "split-left", size: ["lg", "icon-lg"], className: "rounded-l-[28px] rounded-r-[4px] data-[pressed=true]:rounded-l-[28px] data-[pressed=true]:rounded-r-[28px]" },
      { shape: "split-left", size: ["xl", "icon-xl"], className: "rounded-l-[46px] rounded-r-[6px] data-[pressed=true]:rounded-l-[46px] data-[pressed=true]:rounded-r-[46px]" },
      { shape: "split-left", size: ["2xl", "icon-2xl"], className: "rounded-l-[62px] rounded-r-[12px] data-[pressed=true]:rounded-l-[62px] data-[pressed=true]:rounded-r-[62px]" },

      // SPLIT-RIGHT PHYSICS (Your custom tweaks mirrored for right)
      { shape: "split-right", size: ["sm", "icon-sm"], className: "rounded-r-[16px] rounded-l-[4px] data-[pressed=true]:rounded-r-[16px] data-[pressed=true]:rounded-l-[16px]" },
      { shape: "split-right", size: ["default", "icon"], className: "rounded-r-[24px] rounded-l-[4px] data-[pressed=true]:rounded-r-[24px] data-[pressed=true]:rounded-l-[24px]" },
      { shape: "split-right", size: ["lg", "icon-lg"], className: "rounded-r-[28px] rounded-l-[4px] data-[pressed=true]:rounded-r-[28px] data-[pressed=true]:rounded-l-[28px]" },
      { shape: "split-right", size: ["xl", "icon-xl"], className: "rounded-r-[46px] rounded-l-[6px] data-[pressed=true]:rounded-r-[46px] data-[pressed=true]:rounded-l-[46px]" },
      { shape: "split-right", size: ["2xl", "icon-2xl"], className: "rounded-r-[62px] rounded-l-[12px] data-[pressed=true]:rounded-r-[62px] data-[pressed=true]:rounded-l-[62px]" },

      // SPLIT-LEFT-SQUARE PHYSICS (Square pill-morph)
      { shape: "split-left-square", size: ["sm", "icon-sm"], className: "rounded-l-[12px] rounded-r-[4px] data-[pressed=true]:rounded-l-[16px] data-[pressed=true]:rounded-r-[16px]" },
      { shape: "split-left-square", size: ["default", "icon"], className: "rounded-l-[12px] rounded-r-[4px] data-[pressed=true]:rounded-l-[20px] data-[pressed=true]:rounded-r-[20px]" },
      { shape: "split-left-square", size: ["lg", "icon-lg"], className: "rounded-l-[16px] rounded-r-[4px] data-[pressed=true]:rounded-l-[28px] data-[pressed=true]:rounded-r-[28px]" },
      { shape: "split-left-square", size: ["xl", "icon-xl"], className: "rounded-l-[28px] rounded-r-[6px] data-[pressed=true]:rounded-l-[48px] data-[pressed=true]:rounded-r-[48px]" },
      { shape: "split-left-square", size: ["2xl", "icon-2xl"], className: "rounded-l-[28px] rounded-r-[12px] data-[pressed=true]:rounded-l-[68px] data-[pressed=true]:rounded-r-[68px]" },

      // SPLIT-RIGHT-SQUARE PHYSICS (Square pill-morph, mirrored)
      { shape: "split-right-square", size: ["sm", "icon-sm"], className: "rounded-r-[12px] rounded-l-[4px] data-[pressed=true]:rounded-r-[16px] data-[pressed=true]:rounded-l-[16px] data-[state=open]:rounded-r-[16px] data-[state=open]:rounded-l-[16px]" },
      { shape: "split-right-square", size: ["default", "icon"], className: "rounded-r-[12px] rounded-l-[4px] data-[pressed=true]:rounded-r-[20px] data-[pressed=true]:rounded-l-[20px] data-[state=open]:rounded-r-[20px] data-[state=open]:rounded-l-[20px]" },
      { shape: "split-right-square", size: ["lg", "icon-lg"], className: "rounded-r-[16px] rounded-l-[4px] data-[pressed=true]:rounded-r-[28px] data-[pressed=true]:rounded-l-[28px] data-[state=open]:rounded-r-[28px] data-[state=open]:rounded-l-[28px]" },
      { shape: "split-right-square", size: ["xl", "icon-xl"], className: "rounded-r-[28px] rounded-l-[6px] data-[pressed=true]:rounded-r-[48px] data-[pressed=true]:rounded-l-[48px] data-[state=open]:rounded-r-[48px] data-[state=open]:rounded-l-[48px]" },
      { shape: "split-right-square", size: ["2xl", "icon-2xl"], className: "rounded-r-[28px] rounded-l-[12px] data-[pressed=true]:rounded-r-[68px] data-[pressed=true]:rounded-l-[68px] data-[state=open]:rounded-r-[68px] data-[state=open]:rounded-l-[68px]" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      shape: "round",
    },
  }
);

// --- 4. CORE BUTTON COMPONENT ---
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  noRipple?: boolean;
  noMorph?: boolean;
  /** Enable a subtle scale-down on press for tactile feedback. */
  scaleOnPress?: boolean;
  /** When set, clicking opens this URL in a new tab (with a same-tab fallback
   *  if the browser blocks the popup) — keeps real <button> semantics instead
   *  of an anchor, so the button can't be dragged like a link. */
  href?: string;
  /** Applies the Play Store badge treatment: vertical gradient fill plus a
   *  5-layer depth shadow (seam ring, contact shadow, ambient drop, inset
   *  top light, inset bottom bevel) tuned per variant. Ghost shows shadow
   *  only on hover; other variants show it at idle, deepen on hover, and
   *  contract on press. No hover lift — shadows only. */
  depthShadow?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      shape,
      asChild = false,
      noRipple = false,
      noMorph = false,
      scaleOnPress = false,
      depthShadow = false,
      href,
      onClick,
      style,
      children,
      ...props
    },
    ref
  ) => {
    const isRippleLogicDisabled = props.disabled || (noRipple && noMorph);
    // Keep hover/pressed tracking alive when depthShadow is on, even if ripple
    // visuals are disabled, so the shadow can respond to hover/press states.
    const { surfaceRef, rippleEffectRef, hovered, pressed, events } =
      useMaterialRipple(isRippleLogicDisabled && !depthShadow);

    const { shadow: depthShadowValue, gradient: depthGradient } =
      resolveDepthShadow(variant, depthShadow, hovered, pressed);

    const componentProps = {
      className: cn(buttonVariants({ variant, size, shape, className })),
      style: {
        ...style,
        ...(scaleOnPress && pressed ? { transform: "scale(0.97)" } : {}),
        ...(depthShadowValue && !props.disabled ? { boxShadow: depthShadowValue } : {}),
        ...(depthGradient && !props.disabled ? { backgroundImage: depthGradient } : {}),
      },
      "data-pressed": noMorph ? undefined : pressed,
      "data-scale-on-press": scaleOnPress ? "true" : undefined,
      ...events,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        // Fire ripple and standard events
        events.onClick();
        
        // --- NEW FEATURE: Auditory Feedback for Prominent Buttons ---
        if (size && ["xl", "2xl", "icon-xl", "icon-2xl"].includes(size)) {
          playTactilePopSound();
        }

        // Open external URLs as a real button (new tab, same-tab fallback)
        if (href) {
          openExternalUrl(href);
        }

        // Fire user's custom onClick if provided
        onClick?.(e);
      },
      ...props,
    };

    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<{ children?: React.ReactNode }>;

      return (
        <Slot ref={ref} {...componentProps}>
          {React.cloneElement(child, {
            children: (
              <>
                {(!noRipple && variant !== "link") && (
                  <Ripple
                    ref={surfaceRef}
                    rippleEffectRef={rippleEffectRef}
                    hovered={hovered}
                    pressed={pressed}
                  />
                )}
                <span className="relative z-10 flex items-center justify-center gap-[inherit] pointer-events-none">
                  {child.props.children}
                </span>
              </>
            ),
          })}
        </Slot>
      );
    }

    return (
      <button ref={ref} {...componentProps}>
        {(!noRipple && variant !== "link") && (
          <Ripple
            ref={surfaceRef}
            rippleEffectRef={rippleEffectRef}
            hovered={hovered}
            pressed={pressed}
          />
        )}
        <span className="relative z-10 flex items-center justify-center gap-[inherit] pointer-events-none">
          {children}
        </span>
      </button>
    );
  }
);
Button.displayName = "Button";

// --- 5. MD3 SPLIT BUTTON / CONNECTED BUTTON GROUP ---
const SplitButton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { square?: boolean }>(
  ({ className, children, square, ...props }, ref) => {
    const childrenArray = React.Children.toArray(children);
    
    return (
      <div
        ref={ref}
        // Flex items-stretch guarantees the child buttons evaluate to perfectly identical heights
        className={cn("inline-flex items-stretch justify-center gap-[2px]", className)}
        {...props}
      >
        {childrenArray.map((child, index) => {
          if (!React.isValidElement(child)) return child;
          
          const isFirst = index === 0;
          const isLast = index === childrenArray.length - 1;
          const typedChild = child as React.ReactElement<{ className?: string; shape?: string }>;

          let shape: string;
          if (square) {
            shape = isFirst ? "split-left-square" : isLast ? "split-right-square" : "square";
          } else {
            shape = isFirst ? "split-left" : isLast ? "split-right" : "square";
          }
          
          return React.cloneElement(typedChild, {
            shape,
            className: cn(typedChild.props.className, "!h-auto self-stretch")
          });
        })}
      </div>
    );
  }
);
SplitButton.displayName = "SplitButton";

// --- 6. GROUPED BUTTONS (Dynamic segmented group) ---
/**
 * Connected segmented button group — design and press motion are identical to
 * SplitButton (same gap, corner radii, and ripple), but it supports any number
 * of children (2, 3, 4, 5+): first gets split-left, last gets split-right, and
 * any middle children get the square shape.
 */
const GroupedButtons = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { square?: boolean }
>(({ className, children, square, ...props }, ref) => {
    const childrenArray = React.Children.toArray(children);

    return (
      <div
        ref={ref}
        className={cn("inline-flex items-stretch justify-center gap-[2px]", className)}
        {...props}
      >
        {childrenArray.map((child, index) => {
          if (!React.isValidElement(child)) return child;

          const isFirst = index === 0;
          const isLast = index === childrenArray.length - 1;

          let shape: string;
          if (square) {
            shape = isFirst ? "split-left-square" : isLast ? "split-right-square" : "square";
          } else {
            shape = isFirst ? "split-left" : isLast ? "split-right" : "square";
          }

          return React.cloneElement(
            child as React.ReactElement<{ className?: string; shape?: string }>,
            {
              shape,
              className: cn(
                (child as React.ReactElement<{ className?: string }>).props.className,
                "!h-auto self-stretch"
              ),
            }
          );
        })}
      </div>
    );
  }
);
GroupedButtons.displayName = "GroupedButtons";

export { Button, buttonVariants, SplitButton, GroupedButtons };
