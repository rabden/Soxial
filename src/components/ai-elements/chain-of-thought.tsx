"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "src/components/ui/collapsible";
import { cn } from "src/lib/utils";
import type { LucideIcon } from "lucide-react";
import { BrainIcon, ChevronDownIcon, DotIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, memo, useContext, useMemo, useRef, useEffect, useState } from "react";

interface ChainOfThoughtContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const ChainOfThoughtContext = createContext<ChainOfThoughtContextValue | null>(
  null
);

const useChainOfThought = () => {
  const context = useContext(ChainOfThoughtContext);
  if (!context) {
    throw new Error(
      "ChainOfThought components must be used within ChainOfThought"
    );
  }
  return context;
};

export type ChainOfThoughtProps = ComponentProps<"div"> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export const ChainOfThought = memo(
  ({
    className,
    open,
    defaultOpen = false,
    onOpenChange,
    children,
    ...props
  }: ChainOfThoughtProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      defaultProp: defaultOpen,
      onChange: onOpenChange,
      prop: open,
    });

    const chainOfThoughtContext = useMemo(
      () => ({ isOpen, setIsOpen }),
      [isOpen, setIsOpen]
    );

    return (
      <ChainOfThoughtContext.Provider value={chainOfThoughtContext}>
        <div className={cn("not-prose w-full space-y-4", className)} {...props}>
          {children}
        </div>
      </ChainOfThoughtContext.Provider>
    );
  }
);

export type ChainOfThoughtHeaderProps = ComponentProps<
  typeof CollapsibleTrigger
> & {
  icon?: ReactNode;
};

export const ChainOfThoughtHeader = memo(
  ({ className, children, icon, ...props }: ChainOfThoughtHeaderProps) => {
    const { isOpen, setIsOpen } = useChainOfThought();

    return (
      <Collapsible onOpenChange={setIsOpen} open={isOpen} className="w-full">
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground",
            className
          )}
          {...props}
        >
          {icon ?? <BrainIcon className="size-4" />}
          <span className="flex-1 text-left">
            {children ?? "Chain of Thought"}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              isOpen ? "rotate-180" : "rotate-0"
            )}
          />
        </CollapsibleTrigger>
      </Collapsible>
    );
  }
);

export type ChainOfThoughtStepProps = ComponentProps<"div"> & {
  icon?: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: "complete" | "active" | "pending";
};

const stepStatusStyles = {
  active: "text-foreground",
  complete: "text-muted-foreground",
  pending: "text-muted-foreground/50",
};

const chevronPattern = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3),
    c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

function StepTimer() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d: number) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  return (
    <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0 ml-auto pl-2">
      {total < 60 ? `${total.toFixed(1)}s` : `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`}
    </span>
  );
}

function StepPixelGrid() {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px] mr-0.5">
      {chevronPattern.map((delay, index) => (
        <span
          key={index}
          className="size-[4px] bg-white rounded-[1px]"
          style={{
            opacity: 0.15,
            animation: `pixel-on 650ms ease-in-out ${delay}ms infinite`,
          }}
        />
      ))}
    </span>
  );
}

export const ChainOfThoughtStep = memo(
  ({
    className,
    icon: Icon = DotIcon,
    label,
    description,
    status = "complete",
    children,
    ...props
  }: ChainOfThoughtStepProps) => {
    const isActive = status === "active";

    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm min-w-0 py-0.5",
          stepStatusStyles[status],
          "fade-in-0 animate-in",
          className
        )}
        {...props}
      >
        {isActive ? (
          <StepPixelGrid />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground/80" />
        )}
        <div className="truncate flex-1 min-w-0 flex items-baseline gap-2">
          {isActive ? (
            <span
              className="bg-clip-text font-medium text-transparent truncate"
              style={{
                backgroundImage:
                  "linear-gradient(90deg, rgba(255,255,255,0.4) 30%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0.4) 70%)",
                backgroundSize: "200% 100%",
                animation: "shimmer-text 1.4s linear infinite",
              }}
            >
              {label}
            </span>
          ) : (
            <span className="truncate">{label}</span>
          )}
          {description && (
            <span className="text-muted-foreground/60 text-xs truncate font-normal">
              {description}
            </span>
          )}
        </div>
        {isActive && <StepTimer />}
        {children}
      </div>
    );
  }
);

export type ChainOfThoughtContentProps = ComponentProps<
  typeof CollapsibleContent
>;

export const ChainOfThoughtContent = memo(
  ({ className, children, ...props }: ChainOfThoughtContentProps) => {
    const { isOpen } = useChainOfThought();
    const scrollRef = useRef<HTMLDivElement>(null);
    const topFadeRef = useRef<HTMLDivElement>(null);
    const bottomFadeRef = useRef<HTMLDivElement>(null);

    const updateFades = () => {
      const el = scrollRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (topFadeRef.current)
        topFadeRef.current.style.opacity = Math.min(scrollTop / 20, 1).toString();
      if (bottomFadeRef.current)
        bottomFadeRef.current.style.opacity = Math.min(
          Math.max(scrollHeight - clientHeight - scrollTop - 16, 0) / 10,
          1,
        ).toString();
    };

    useEffect(() => {
      const el = scrollRef.current;
      if (!el || !isOpen) return;
      updateFades();
      el.addEventListener("scroll", updateFades);
      const ro = new ResizeObserver(updateFades);
      ro.observe(el);
      return () => {
        el.removeEventListener("scroll", updateFades);
        ro.disconnect();
      };
    }, [isOpen]);

    return (
      <Collapsible open={isOpen} className="w-full">
        <CollapsibleContent
          className={cn(
            "mt-2 max-h-96 overflow-hidden text-popover-foreground outline-none data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=open]:animate-in",
            className
          )}
          {...props}
        >
          <div className="relative">
            <div
              ref={scrollRef}
              className="max-h-96 overflow-y-auto scrollbar-none space-y-3"
              onScroll={updateFades}
            >
              {children}
            </div>
            <div
              ref={topFadeRef}
              className="pointer-events-none absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-background via-background/90 to-transparent"
              style={{ opacity: 0 }}
            />
            <div
              ref={bottomFadeRef}
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background via-background/90 to-transparent"
              style={{ opacity: 0 }}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
);
ChainOfThought.displayName = "ChainOfThought";
ChainOfThoughtHeader.displayName = "ChainOfThoughtHeader";
ChainOfThoughtStep.displayName = "ChainOfThoughtStep";
ChainOfThoughtContent.displayName = "ChainOfThoughtContent";
