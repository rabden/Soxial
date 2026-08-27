"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronRight, ChevronLeft, Check, Circle } from "lucide-react";
import { cn } from "src/lib/utils";
import { useMaterialRipple } from "src/components/ui/use-ripple";

// --- 0. HELPER: DYNAMIC RADIUS EXTRACTOR ---
function extractBorderRadius(className?: string): string {
  if (!className) return "12px";
  const arbitraryMatch = className.match(/rounded-\[([^\]]+)\]/);
  if (arbitraryMatch) return arbitraryMatch[1];

  if (className.includes("rounded-none")) return "0px";
  if (className.includes("rounded-sm")) return "0.125rem";
  if (className.includes("rounded-md")) return "0.375rem";
  if (className.includes("rounded-lg")) return "0.5rem";
  if (className.includes("rounded-xl")) return "0.75rem";
  if (className.includes("rounded-2xl")) return "1rem";
  if (className.includes("rounded-3xl")) return "1.5rem";
  if (className.includes("rounded-full")) return "9999px";
  if (className.includes("rounded")) return "0.25rem";

  return "12px";
}

// --- 1. DRILL-DOWN CONTEXT ENGINE ---
type DrilldownContextType = {
  activePage: string;
  history: string[];
  navigate: (page: string) => void;
  goBack: () => void;
  menuHeight: number | null;
  setMenuHeight: (h: number) => void;
};

const DrilldownContext = React.createContext<DrilldownContextType | null>(null);

function useDrilldown() {
  const ctx = React.useContext(DrilldownContext);
  if (!ctx) throw new Error("Component must be used within a DropdownMenu");
  return ctx;
}

// --- 2. RIPPLE OVERLAY ---
type RippleVariant = "trigger" | "item";

const RippleLayer = ({ pressed, rippleEffectRef, variant = "item" }: { pressed: boolean; rippleEffectRef: React.RefObject<HTMLDivElement | null>; variant?: RippleVariant }) => (
  <div className="absolute inset-0 overflow-hidden rounded-[inherit] pointer-events-none z-0">
    <div className="absolute inset-0 bg-current opacity-0 transition-opacity duration-200 group-hover:opacity-[0.08] group-data-[highlighted]:opacity-[0.08]" />
    <div
      ref={rippleEffectRef}
      className="absolute rounded-full opacity-0 bg-current"
      style={{
        background: variant === "trigger"
            ? "radial-gradient(closest-side, currentColor 65%, transparent 100%)"
            : "radial-gradient(closest-side, currentColor max(calc(100% - 70px), 65%), transparent 100%)",
        transition: "opacity 375ms linear",
        opacity: pressed ? "0.12" : "0",
        transitionDuration: pressed ? "100ms" : "375ms",
        top: 0,
        left: 0,
      }}
    />
  </div>
);

// --- 3. SSR COMPATIBLE CINEMATIC STYLES ---
const M3Styles = () => (
  <style id="m3-dropdown-styles" dangerouslySetInnerHTML={{ __html: `
    @media (prefers-reduced-motion: no-preference) {
      @keyframes m3-sweep-down { 0% { clip-path: inset(0 0 100% 0 round var(--m3-menu-radius, 12px)); } 100% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); } }
      @keyframes m3-sweep-up { 0% { clip-path: inset(100% 0 0 0 round var(--m3-menu-radius, 12px)); } 100% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); } }
      @keyframes m3-sweep-right { 0% { clip-path: inset(0 100% 0 0 round var(--m3-menu-radius, 12px)); } 100% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); } }
      @keyframes m3-sweep-left { 0% { clip-path: inset(0 0 0 100% round var(--m3-menu-radius, 12px)); } 100% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); } }

      @keyframes m3-sweep-out-up { 0% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); opacity: 1; } 100% { clip-path: inset(0 0 100% 0 round var(--m3-menu-radius, 12px)); opacity: 0; } }
      @keyframes m3-sweep-out-down { 0% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); opacity: 1; } 100% { clip-path: inset(100% 0 0 0 round var(--m3-menu-radius, 12px)); opacity: 0; } }
      @keyframes m3-sweep-out-left { 0% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); opacity: 1; } 100% { clip-path: inset(0 100% 0 0 round var(--m3-menu-radius, 12px)); opacity: 0; } }
      @keyframes m3-sweep-out-right { 0% { clip-path: inset(0 0 0 0 round var(--m3-menu-radius, 12px)); opacity: 1; } 100% { clip-path: inset(0 0 0 100% round var(--m3-menu-radius, 12px)); opacity: 0; } }

      @keyframes m3-item-cinematic {
        0% { opacity: 0; transform: translateY(8px) scale(0.98); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes m3-item-exit {
        0% { opacity: 1; transform: translateY(0) scale(1); }
        100% { opacity: 0; transform: translateY(4px) scale(0.95); }
      }

      .m3-content[data-state="open"] { opacity: 1; }
      .m3-content[data-state="closed"] { opacity: 0; transition: opacity 200ms linear; }

      .m3-content[data-state="open"][data-side="bottom"] { animation: m3-sweep-down 400ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; }
      .m3-content[data-state="open"][data-side="top"] { animation: m3-sweep-up 400ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; }
      .m3-content[data-state="open"][data-side="right"] { animation: m3-sweep-right 400ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; }
      .m3-content[data-state="open"][data-side="left"] { animation: m3-sweep-left 400ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; }

      .m3-content[data-state="closed"][data-side="bottom"] { animation: m3-sweep-out-up 300ms cubic-bezier(0.4, 0, 1, 1) forwards; }
      .m3-content[data-state="closed"][data-side="top"] { animation: m3-sweep-out-down 300ms cubic-bezier(0.4, 0, 1, 1) forwards; }
      .m3-content[data-state="closed"][data-side="right"] { animation: m3-sweep-out-left 300ms cubic-bezier(0.4, 0, 1, 1) forwards; }
      .m3-content[data-state="closed"][data-side="left"] { animation: m3-sweep-out-right 300ms cubic-bezier(0.4, 0, 1, 1) forwards; }

      .m3-content[data-state="open"] .m3-item-enter { opacity: 0; animation: m3-item-cinematic 350ms cubic-bezier(0.1, 0.8, 0.2, 1) forwards; animation-delay: calc(var(--m3-stagger, 0) * 30ms + 40ms); }
      .m3-content[data-state="closed"] .m3-item-enter { animation: m3-item-exit 200ms cubic-bezier(0.4, 0, 1, 1) forwards; }
    }
  `}} />
);

// --- 4. EXPORTED COMPONENTS ---

const DropdownMenu = ({ onOpenChange, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>) => {
  const [history, setHistory] = React.useState(["main"]);
  const activePage = history[history.length - 1] || "main";
  const [menuHeight, setMenuHeight] = React.useState<number | null>(null);

  const navigate = React.useCallback((page: string) => {
    setHistory((prev) => {
      if (prev[prev.length - 1] === page) return prev;
      return [...prev, page].slice(-10);
    });
  },[]);

  const goBack = React.useCallback(() => {
    setHistory((prev) => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  },[]);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setHistory(["main"]);
      setMenuHeight(null);
    }
    onOpenChange?.(open);
  };

  return (
    <DrilldownContext.Provider value={{ activePage, history, navigate, goBack, menuHeight, setMenuHeight }}>
      <DropdownMenuPrimitive.Root onOpenChange={handleOpenChange} {...props} />
    </DrilldownContext.Provider>
  );
};

const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ children, className, asChild = false, ...props }, ref) => {
  const { surfaceRef, rippleEffectRef, pressed, events } = useMaterialRipple();

  if (asChild && React.isValidElement(children)) {
    return (
      <DropdownMenuPrimitive.Trigger
        ref={ref}
        asChild
        className={cn("group relative overflow-hidden outline-none", className)}
        {...events}
        {...props}
      >
        {React.cloneElement(children as React.ReactElement<any>, {
          children: (
            <>
              <RippleLayer rippleEffectRef={rippleEffectRef} pressed={pressed} variant="trigger" />
              <span ref={surfaceRef as React.RefObject<HTMLSpanElement>} className="absolute inset-0 z-0" />
              <div className="relative z-10 flex w-full h-full items-center justify-center gap-[inherit] pointer-events-none">
                {(children.props as any).children}
              </div>
            </>
          ),
        })}
      </DropdownMenuPrimitive.Trigger>
    );
  }

  return (
    <DropdownMenuPrimitive.Trigger ref={ref} asChild {...props}>
      <button className={cn("group relative overflow-hidden outline-none flex items-center justify-center rounded-xl transition-all", className)} {...events}>
        <RippleLayer rippleEffectRef={rippleEffectRef} pressed={pressed} variant="trigger" />
        <span ref={surfaceRef as React.RefObject<HTMLSpanElement>} className="absolute inset-0 z-0" />
        <div className="relative z-10 flex w-full h-full items-center justify-center gap-[inherit] pointer-events-none">
          {children}
        </div>
      </button>
    </DropdownMenuPrimitive.Trigger>
  );
});

const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Content>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>>(
  ({ className, sideOffset = 8, children, ...props }, ref) => {
    const ctx = React.useContext(DrilldownContext);

    const staggeredChildren = React.Children.map(children, (child, index) => {
      if (React.isValidElement(child)) return React.cloneElement(child as React.ReactElement<any>, { style: { ...(child.props as any).style, "--m3-stagger": index } as React.CSSProperties });
      return child;
    });

    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          style={{
            height: ctx?.menuHeight ? `${ctx.menuHeight}px` : "auto",
            transition: ctx?.menuHeight ? "height 350ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms linear" : "opacity 200ms linear",
            "--m3-menu-radius": extractBorderRadius(className),
            ...props.style,
          } as React.CSSProperties}
          className={cn(
            "m3-content z-50 rounded-xl bg-popover/95 backdrop-blur-xl text-popover-foreground shadow-[0px_8px_32px_rgba(0,0,0,0.12)] border border-border/20 outline-none overflow-hidden relative py-0",
            "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
            className
          )}
          {...props}
        >
          <M3Styles />
          {staggeredChildren}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    );
  }
);

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean; delayDuration?: number; enterAnimation?: boolean
  }
>(({ className, inset, children, delayDuration = 250, enterAnimation = true, asChild = false, ...props }, ref) => {
  const { surfaceRef, rippleEffectRef, pressed, events } = useMaterialRipple(props.disabled);

  const handleSelect = (e: Event) => {
    const isKeyboard = (e as any).detail?.originalEvent?.type === "keydown";
    if (delayDuration > 0 && !isKeyboard) {
      e.preventDefault();
      setTimeout(() => props.onSelect?.(e), delayDuration);
    } else {
      props.onSelect?.(e);
    }
  };

  const baseClassName = cn(
    "group relative flex cursor-pointer select-none items-stretch px-0 min-h-[48px] text-sm font-medium tracking-[0.01em] outline-none transition-colors",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-40 overflow-hidden rounded-none",
    enterAnimation && "m3-item-enter",
    className
  );

  if (asChild && React.isValidElement(children)) {
    return (
      <DropdownMenuPrimitive.Item
        ref={ref}
        asChild
        className={baseClassName}
        {...events}
        {...props}
        onSelect={handleSelect}
      >
        {React.cloneElement(children as React.ReactElement<any>, {
          children: (
            <div
              ref={(node) => { (surfaceRef as any).current = node; }}
              className={cn("relative flex flex-1 items-center px-4", inset && "pl-12")}
            >
              <RippleLayer rippleEffectRef={rippleEffectRef} pressed={pressed} variant="item" />
              <span className="relative z-10 flex w-full items-center gap-3 pointer-events-none">
                {(children.props as any).children}
              </span>
            </div>
          ),
        })}
      </DropdownMenuPrimitive.Item>
    );
  }

  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={baseClassName}
      {...events}
      {...props}
      onSelect={handleSelect}
    >
      <div
        ref={(node) => { (surfaceRef as any).current = node; }}
        className={cn("relative flex flex-1 items-center px-4", inset && "pl-12")}
      >
        <RippleLayer rippleEffectRef={rippleEffectRef} pressed={pressed} variant="item" />
        <span className="relative z-10 flex w-full items-center gap-3 pointer-events-none">{children}</span>
      </div>
    </DropdownMenuPrimitive.Item>
  );
});

const DropdownMenuCheckboxItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & { delayDuration?: number; enterAnimation?: boolean }>(
  ({ className, children, checked, delayDuration = 250, enterAnimation = true, ...props }, ref) => {
    const { surfaceRef, rippleEffectRef, pressed, events } = useMaterialRipple(props.disabled);
    return (
      <DropdownMenuPrimitive.CheckboxItem
        ref={ref}
        className={cn(
          "group relative flex cursor-pointer select-none items-stretch px-0 min-h-[48px] text-sm font-medium tracking-[0.01em] outline-none transition-colors",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-40 overflow-hidden rounded-none",
          enterAnimation && "m3-item-enter",
          className
        )}
        checked={checked}
        {...events}
        {...props}
        onSelect={(e) => {
          const isKeyboard = (e as any).detail?.originalEvent?.type === "keydown";
          if (delayDuration > 0 && !isKeyboard) {
            e.preventDefault();
            setTimeout(() => props.onSelect?.(e), delayDuration);
          } else props.onSelect?.(e);
        }}
      >
        <div ref={(node) => { (surfaceRef as any).current = node; }} className="relative flex flex-1 items-center px-4">
          <RippleLayer rippleEffectRef={rippleEffectRef} pressed={pressed} variant="item" />
          <span className="relative z-10 flex w-full items-center gap-3 pointer-events-none">
            <span className="flex h-5 w-5 items-center justify-center">
              <DropdownMenuPrimitive.ItemIndicator>
                <Check className="h-4 w-4" />
              </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
          </span>
        </div>
      </DropdownMenuPrimitive.CheckboxItem>
    );
  }
);

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuRadioItem = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & { delayDuration?: number; enterAnimation?: boolean }>(
  ({ className, children, delayDuration = 250, enterAnimation = true, ...props }, ref) => {
    const { surfaceRef, rippleEffectRef, pressed, events } = useMaterialRipple(props.disabled);
    return (
      <DropdownMenuPrimitive.RadioItem
        ref={ref}
        className={cn(
          "group relative flex cursor-pointer select-none items-stretch px-0 min-h-[48px] text-sm font-medium tracking-[0.01em] outline-none transition-colors",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-40 overflow-hidden rounded-none",
          enterAnimation && "m3-item-enter",
          className
        )}
        {...events}
        {...props}
        onSelect={(e) => {
          const isKeyboard = (e as any).detail?.originalEvent?.type === "keydown";
          if (delayDuration > 0 && !isKeyboard) {
            e.preventDefault();
            setTimeout(() => props.onSelect?.(e), delayDuration);
          } else props.onSelect?.(e);
        }}
      >
        <div ref={(node) => { (surfaceRef as any).current = node; }} className="relative flex flex-1 items-center px-4">
          <RippleLayer rippleEffectRef={rippleEffectRef} pressed={pressed} variant="item" />
          <span className="relative z-10 flex w-full items-center gap-3 pointer-events-none">
            <span className="flex h-5 w-5 items-center justify-center">
              <DropdownMenuPrimitive.ItemIndicator>
                <Circle className="h-2.5 w-2.5 fill-current" />
              </DropdownMenuPrimitive.ItemIndicator>
            </span>
            {children}
          </span>
        </div>
      </DropdownMenuPrimitive.RadioItem>
    );
  }
);

const DropdownMenuSeparator = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Separator>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>>(
  ({ className, ...props }, ref) => (
    <DropdownMenuPrimitive.Separator
        ref={ref}
        className={cn(
            "h-[1px] w-full m3-item-enter my-0",
            "bg-gradient-to-r from-transparent via-border to-transparent opacity-80 my-0.5",
            className
        )}
        {...props}
    />
  )
);

const DropdownMenuLabel = React.forwardRef<React.ElementRef<typeof DropdownMenuPrimitive.Label>, React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }>(
  ({ className, inset, ...props }, ref) => (
    <DropdownMenuPrimitive.Label ref={ref} className={cn("px-5 py-4 text-[10px] font-black tracking-[0.15em] text-primary/80 uppercase m3-item-enter", inset && "pl-12", className)} {...props} />
  )
);

const DropdownMenuInternalBack = () => {
  const ctx = useDrilldown();
  return (
    <DropdownMenuItem delayDuration={0} onSelect={(e) => { e.preventDefault(); ctx.goBack(); }} enterAnimation={false} style={{ "--m3-stagger": 0 } as React.CSSProperties}>
      <ChevronLeft className="w-5 h-5 text-foreground" />
      <span>Back</span>
    </DropdownMenuItem>
  );
};

const DropdownMenuPage = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { id: string }>(
  ({ id, children, className, ...props }, ref) => {
    const ctx = useDrilldown();
    const { activePage, history, setMenuHeight } = ctx;
    const isActive = activePage === id;
    const isLeft = history.includes(id) && !isActive;

    const[pageNode, setPageNode] = React.useState<HTMLDivElement | null>(null);

    React.useEffect(() => {
      if (isActive && pageNode) {
        const observer = new ResizeObserver((entries) => {
          setMenuHeight(entries[0].borderBoxSize?.[0]?.blockSize ?? entries[0].contentRect.height);
        });
        observer.observe(pageNode);
        return () => observer.disconnect();
      }
    }, [isActive, pageNode, setMenuHeight]);

    const staggeredChildren = React.Children.map(children, (child, index) => {
      if (React.isValidElement(child)) return React.cloneElement(child as React.ReactElement<any>, { style: { ...(child.props as any).style, "--m3-stagger": id === "main" ? index : index + 1 } as React.CSSProperties });
      return child;
    });

    return (
      <div
        ref={(node) => { setPageNode(node); if (typeof ref === "function") ref(node); else if (ref) (ref as any).current = node; }}
        className={cn(
          "w-full absolute top-0 left-0 transition-all duration-[350ms] ease-[cubic-bezier(0.2,0,0,1)] py-0",
          isActive ? "translate-x-0 opacity-100 scale-100 pointer-events-auto" :
          isLeft ? "-translate-x-[20%] opacity-0 scale-[0.98] pointer-events-none" :
          "translate-x-[20%] opacity-0 scale-[0.98] pointer-events-none",
          className
        )}
        {...props}
      >
        {id !== "main" && <DropdownMenuInternalBack />}
        {staggeredChildren}
      </div>
    );
  }
);

const DropdownMenuPageTrigger = React.forwardRef<React.ElementRef<typeof DropdownMenuItem>, React.ComponentPropsWithoutRef<typeof DropdownMenuItem> & { targetId: string }>(
  ({ targetId, children, ...props }, ref) => {
    const ctx = useDrilldown();
    return (
      <DropdownMenuItem
        ref={ref}
        delayDuration={0}
        onSelect={(e) => { e.preventDefault(); ctx.navigate(targetId); }}
        {...props}
      >
        {children}
        <ChevronRight className="ml-auto w-4 h-4 text-muted-foreground opacity-70" />
      </DropdownMenuItem>
    );
  }
);

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuPage,
  DropdownMenuPageTrigger
};
