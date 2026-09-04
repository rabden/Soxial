"use client";

import { Button } from "src/components/ui/button";
import { cn } from "src/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-hidden", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 p-4", className)}
    {...props}
  />
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export const ConversationEmptyState = ({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps) => (
  <div
    className={cn(
      "flex size-full flex-col items-center justify-center gap-4 p-8 text-center",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        {icon && <div className="text-muted-foreground mb-1">{icon}</div>}
        <div className="space-y-1.5">
          <h3 className="font-semibold text-[15px] text-foreground/90">{title}</h3>
          {description && (
            <p className="text-muted-foreground/60 text-sm font-[425] max-w-xs mx-auto">{description}</p>
          )}
        </div>
      </>
    )}
  </div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button> & {
  bottomOffset?: number;
};

export const ConversationScrollButton = ({
  className,
  bottomOffset = 16,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
        <Button
          className={cn(
            "absolute left-[50%] translate-x-[-50%] rounded-full dark:bg-background dark:hover:bg-muted",
            className
          )}
          style={{ bottom: bottomOffset }}
          onClick={handleScrollToBottom}
          size="icon"
          type="button"
          variant="secondary"
          noMorph
          {...props}
        >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};
