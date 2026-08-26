import * as React from "react";
import { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "src/lib/utils";
import { Check } from "lucide-react";

const SPRING =
  "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
const SMOOTH =
  "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.15s ease-out";

const MODEL_DISPLAY: Record<string, string> = {
  "gemini-3.7-flash": "Gemini 3.7 Flash",
  "gemini-3.1-pro": "Gemini 3.1 Pro",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite",
  "glm-5.3": "GLM 5.3",
  "glm-5-turbo": "GLM 5 Turbo",
  "glm-4.7-flash": "GLM 4.7 Flash",
  "glm-4.5-flash": "GLM 4.5 Flash",
  // Main normalizes at every boundary; these exist only for stale payloads.
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "glm-5.2": "GLM 5.2",
};
const modelLabel = (id: string) => MODEL_DISPLAY[id] || id;

interface Attachment {
  id: string;
  file: File;
  url: string;
  name: string;
  width?: number;
  height?: number;
}

function MorphingText({ text }: { text: string }) {
  const [width, setWidth] = useState<number | "auto">("auto");
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth);
  }, [text]);
  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden transition-all duration-300"
      style={{
        width,
        transitionTimingFunction: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
      }}
    >
      <span ref={ref} className="invisible whitespace-nowrap px-1">
        {text}
      </span>
      <span
        key={text}
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap animate-in fade-in zoom-in-95 duration-300"
      >
        {text}
      </span>
    </span>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none">
      <path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.3L19.5 8 12 11.7 4.5 8 12 4.3zM4 9.5l7 3.5v7L4 16.5v-7zm9 10.5v-7l7-3.5v7l-7 3.5z" fill="currentColor" />
    </svg>
  );
}

function ZaiIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M5 4h14v3l-9 9h9v4H5v-3l9-9H5V4z" />
    </svg>
  );
}

function ProviderIcon({ model, className }: { model: string; className?: string }) {
  return model.startsWith("glm")
    ? <ZaiIcon className={className} />
    : <GoogleIcon className={className} />;
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 2.5V11.5M2.5 7H11.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 14 14" fill="none">
      <path
        d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DynamicBarsIcon({ level }: { level: string }) {
  const med = level === "Medium" || level === "High" || level === "Max Effort";
  const max = level === "High" || level === "Max Effort";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect
        x="1.5"
        y="8"
        width="2.5"
        height="4.5"
        rx="1"
        fill="currentColor"
        opacity={1}
      />
      <rect
        x="5.75"
        y="5"
        width="2.5"
        height="7.5"
        rx="1"
        fill="currentColor"
        opacity={med ? 1 : 0.3}
      />
      <rect
        x="10"
        y="2"
        width="2.5"
        height="10.5"
        rx="1"
        fill="currentColor"
        opacity={max ? 1 : 0.3}
      />
    </svg>
  );
}

export interface PromptInputProps {
  onSubmit?: (
    value: string,
    meta: { model: string; effort: string; attachments: File[] },
  ) => void;
  placeholder?: string;
  className?: string;
  models?: string[];
  model?: string;
  efforts?: string[];
  modelSupportsEffort?: (model: string) => boolean;
  disabled?: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  queue?: string[];
  onRemoveQueued?: (index: number) => void;
  question?: {
    id: string;
    text: string;
    type: "single" | "multi" | "text";
    options?: string[];
  };
  onAnswer?: (answer: string | string[]) => void;
  modelExhaustionStatus?: Record<string, { exhausted: boolean; availableAt: string | null }>;
  onModelChange?: (model: string) => void;
  onEffortChange?: (effort: string) => void;
}

export const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  ({
    onSubmit,
    placeholder = "Ask anything",
    className,
    models = ["Gemini 3.5 Flash Lite"],
    model: controlledModel,
    efforts = ["Low", "Medium", "High"],
    modelSupportsEffort = () => true,
    disabled = false,
    isStreaming = false,
    onStop,
    queue = [],
    onRemoveQueued,
    question,
    onAnswer,
    modelExhaustionStatus,
    onModelChange,
    onEffortChange,
  }) => {
    const [expanded, setExpanded] = useState(false);
    const [isSmooth, setIsSmooth] = useState(false);
    const [value, setValue] = useState("");
    const [selectedModel, setSelectedModel] = useState(models[0]);

    // Keep selectedModel in sync when the `models` prop list changes (e.g. after
    // availableModels loads async). Preserve the user's choice if it's still valid.
    useEffect(() => {
      if (models.length > 0 && !models.includes(selectedModel)) {
        setSelectedModel(models[0]);
        onModelChange?.(models[0]);
      }
    }, [models]);

    // Sync with controlled model prop (e.g. when agent falls back to a different model)
    useEffect(() => {
      if (controlledModel && controlledModel !== selectedModel) {
        setSelectedModel(controlledModel);
      }
    }, [controlledModel]);
    const [effortIndex, setEffortIndex] = useState(1);
    const [modelOpen, setModelOpen] = useState(false);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [hoverStyle, setHoverStyle] = useState({
      opacity: 0,
      transform: "translateY(0px) scale(0.95)",
      transition: "none",
    });
    const [containerH, setContainerH] = useState(116);
    const [taH, setTaH] = useState(68);
    const [isScrolling, setIsScrolling] = useState(false);
    const [qAnswer, setQAnswer] = useState<string | string[]>("");
    const [customInput, setCustomInput] = useState("");
    const qTextRef = useRef<HTMLTextAreaElement>(null);
    const customInputRef = useRef<HTMLInputElement>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const internalRef = useRef<HTMLDivElement>(null);
    const topFadeRef = useRef<HTMLDivElement>(null);
    const bottomFadeRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const thumbRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

    const showEffort = modelSupportsEffort(selectedModel);
    const hasValue = value.trim() !== "" || attachments.length > 0;

    const updateFades = () => {
      const el = textareaRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (topFadeRef.current)
        topFadeRef.current.style.opacity = Math.min(
          scrollTop / 20,
          1,
        ).toString();
      if (bottomFadeRef.current)
        bottomFadeRef.current.style.opacity = Math.min(
          Math.max(scrollHeight - clientHeight - scrollTop - 16, 0) / 10,
          1,
        ).toString();
    };

    const qHasAnswer = question
      ? question.type === "multi"
        ? Array.isArray(qAnswer) && qAnswer.length > 0
        : typeof qAnswer === "string" && qAnswer.trim() !== ""
      : false;

    // All prompt-input children use absolute positioning, so the container needs
    // an explicit height. Calculate based on content, capped at 80vh.
    const maxQH = typeof window !== "undefined" ? window.innerHeight * 0.8 : 600;
    const effectiveContainerH = question
      ? question.type === "text"
        ? Math.min(maxQH, Math.max(180, taH + 140))
        : Math.min(maxQH, Math.max(180, 140 + (question.options?.length || 0) * 52))
      : containerH;

    const toggleMulti = (opt: string) => {
      const list = Array.isArray(qAnswer) ? qAnswer : [];
      setQAnswer(list.includes(opt) ? list.filter((x) => x !== opt) : [...list, opt]);
    };

    const submitAnswer = () => {
      if (!qHasAnswer || !onAnswer) return;
      onAnswer(qAnswer);
      setQAnswer("");
    };

    const expand = () => {
      setIsSmooth(false);
      setExpanded(true);
    };

    useEffect(() => {
      if ((value.trim() !== "" || attachments.length > 0) && !expanded && !question) {
        setIsSmooth(false);
        setExpanded(true);
      }
    }, [value, attachments, expanded, question]);

    useEffect(() => {
      if (queue.length > 0 && !expanded) {
        setIsSmooth(false);
        setExpanded(true);
      }
    }, [queue.length, expanded]);

    useEffect(() => {
      if (question) {
        setIsSmooth(false);
        setExpanded(true);
        setQAnswer(question.type === "multi" ? [] : "");
        setCustomInput("");
        if (question.type === "text") {
          const t = setTimeout(() => qTextRef.current?.focus(), 300);
          return () => clearTimeout(t);
        }
      }
    }, [question?.id]);

    useEffect(() => {
      if (expanded) {
        const t = setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
        return () => clearTimeout(t);
      }
    }, [expanded]);

    useEffect(() => {
      if (!textareaRef.current) return;
      const el = textareaRef.current;
      const ch = el.style.height;
      el.style.transition = "none";
      el.style.height = "0px";
      const sh = el.scrollHeight;
      el.style.height = ch;
      void el.offsetHeight;
      el.style.transition = "";
      const nh = Math.max(68, Math.min(sh, 160));
      el.style.height = `${nh}px`;
      setTaH(nh);
      setIsScrolling(sh > 160);
      setTimeout(updateFades, 0);
    }, [value, expanded]);

    useEffect(() => {
      setContainerH(Math.max(116, taH + 48));
      setTimeout(updateFades, 0);
    }, [taH]);

    useEffect(() => {
      if (!modelOpen) return;
      const handler = (e: MouseEvent) => {
        if (
          internalRef.current &&
          !internalRef.current.contains(e.target as Node)
        )
          setModelOpen(false);
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [modelOpen]);

    const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
      if (
        internalRef.current &&
        internalRef.current.contains(e.relatedTarget as Node)
      )
        return;
      if (
        value.trim() === "" &&
        attachments.length === 0 &&
        queue.length === 0
      ) {
        setIsSmooth(false);
        setExpanded(false);
        setModelOpen(false);
      }
    };

    const handleSubmit = () => {
      if (value.trim() === "" && attachments.length === 0) return;
      setIsSmooth(false);
      onSubmit?.(value, {
        model: selectedModel,
        effort: efforts[effortIndex],
        attachments: attachments.map((a) => a.file),
      });
      setValue("");
      attachments.forEach((a) => URL.revokeObjectURL(a.url));
      setAttachments([]);
      setExpanded(
        isStreaming || queue.length > 0 || attachments.length > 0 || !!question,
      );
      setModelOpen(false);
    };

    const cycleEffort = (e: React.MouseEvent) => {
      e.stopPropagation();
      setEffortIndex((p) => {
        const next = (p + 1) % efforts.length;
        onEffortChange?.(efforts[next]);
        return next;
      });
    };

    const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      e.target.value = "";
      if (!expanded) {
        setIsSmooth(false);
        setExpanded(true);
      } else {
        setIsSmooth(true);
      }
      for (const file of files.slice(0, 6 - attachments.length)) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const id = `${file.name}-${Math.random().toString(36).slice(2, 8)}`;
          setAttachments((p) => [
            ...p,
            {
              id,
              file,
              url,
              name: file.name,
              width: img.naturalWidth,
              height: img.naturalHeight,
            },
          ]);
        };
        img.onerror = () => {
          const id = `${file.name}-${Math.random().toString(36).slice(2, 8)}`;
          setAttachments((p) => [...p, { id, file, url, name: file.name }]);
        };
        img.src = url;
      }
    };

    const removeAttachment = (id: string) => {
      setIsSmooth(true);
      setAttachments((prev) => {
        const t = prev.find((a) => a.id === id);
        if (t) URL.revokeObjectURL(t.url);
        return prev.filter((a) => a.id !== id);
      });
      thumbRefs.current.delete(id);
    };

    return (
      <div
        ref={(node) => {
          internalRef.current = node;
        }}
        onBlur={handleBlur}
        className={cn(
          "relative flex flex-col w-full pointer-events-auto",
          disabled && "opacity-50 pointer-events-none",
          className,
        )}
        style={{
          maxWidth: question || expanded ? 680 : 360,
          transition: isSmooth
            ? "max-width 0.15s ease-out"
            : "max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />

        {/* Attachment strip */}
        <div
          aria-hidden={!attachments.length}
          style={{
            height: attachments.length && expanded ? 68 : 0,
            transition: isSmooth
              ? "height 0.15s ease-out"
              : "height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          }}
          className="w-full relative z-0 overflow-hidden"
        >
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 16,
              right: 16,
              height: 68,
              transform:
                attachments.length && expanded
                  ? "translateY(0)"
                  : "translateY(100%)",
              opacity: attachments.length && expanded ? 1 : 0,
              transition: isSmooth
                ? "transform 0.15s ease-out, opacity 0.15s ease-out"
                : "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out",
            }}
            className="border border-border border-b-0 bg-muted/50 backdrop-blur-md rounded-t-2xl px-2 pt-2 pb-2 flex items-start gap-2 overflow-x-auto"
          >
            {attachments.map((att, i) => (
              <button
                key={att.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAttachment(att.id);
                }}
                style={{
                  animationDelay: `${i * 35}ms`,
                  animationFillMode: "backwards",
                }}
                className="group relative size-12 shrink-0 overflow-hidden rounded-xl border border-border bg-muted transition-transform duration-200 hover:scale-[1.04] active:scale-[0.96] animate-in fade-in slide-in-from-top-3 zoom-in-90 duration-400"
              >
                <img
                  src={att.url}
                  alt={att.name}
                  className="size-full object-cover"
                  draggable={false}
                />
                <span className="absolute inset-0 flex items-start justify-end bg-black/0 group-hover:bg-black/25 transition-colors">
                  <span className="m-1 flex size-4 items-center justify-center rounded-full bg-background/90 text-foreground/70 opacity-0 group-hover:opacity-100 transition-all">
                    <CloseIcon />
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Queue strip */}
        <div
          aria-hidden={!queue.length}
          style={{
            height: queue.length ? Math.min(16 + queue.length * 28, 132) : 0,
            transition: isSmooth
              ? "height 0.15s ease-out"
              : "height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
          }}
          className="w-full relative z-0 overflow-hidden"
        >
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: queue.length ? Math.min(16 + queue.length * 28, 132) : 0,
              transform: queue.length ? "translateY(0)" : "translateY(100%)",
              opacity: queue.length ? 1 : 0,
              transition: isSmooth
                ? "transform 0.15s ease-out, opacity 0.15s ease-out"
                : "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out",
            }}
            className="border border-border border-b-0 bg-muted/50 backdrop-blur-md rounded-t-2xl px-3 py-2 flex flex-col gap-1 overflow-y-auto"
          >
            {queue.map((msg, i) => (
              <div
                key={i}
                style={{
                  animationDelay: `${i * 35}ms`,
                  animationFillMode: "backwards",
                }}
                className="group flex w-full items-center gap-2 text-[11px] text-foreground/70 animate-in fade-in slide-in-from-top-3 duration-300"
              >
                <span className="min-w-0 flex-1 truncate leading-4">{msg}</span>
                {onRemoveQueued && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveQueued(i); }}
                    className="flex size-4 shrink-0 items-center justify-center rounded-full text-foreground/35 opacity-0 transition-opacity hover:text-foreground/60 group-hover:opacity-100"
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Main card */}
        <div
          onMouseDown={(e) => {
            if (question) return;
            if (expanded && e.target !== textareaRef.current) {
              e.preventDefault();
              textareaRef.current?.focus();
            }
          }}
          style={{
            borderRadius: 24,
            height: question ? effectiveContainerH : expanded ? containerH : 48,
            maxHeight: question ? "80vh" : undefined,
            transition: isSmooth ? SMOOTH : SPRING,
            overflow: question ? "hidden" : expanded ? "visible" : "hidden",
          }}
          className="bg-card relative w-full border border-white/[0.06] shadow-lg focus-within:border-white/[0.12] focus-within:ring-1 focus-within:ring-white/[0.06] hover:border-white/[0.10] z-10 ambient-shadow"
        >
          {/* Question content layer */}
          {question && (
            <div className="absolute inset-0 z-[5] flex flex-col">
              <div className="px-4 pt-3 pb-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wide">
                    Question
                  </span>
                  <span className={cn("text-[11px] font-medium", qHasAnswer ? "text-primary" : "text-muted-foreground/60")}>
                    {qHasAnswer ? "Ready to submit" : "Answer to submit"}
                  </span>
                </div>
                <p className="text-sm font-medium text-foreground leading-snug">
                  {question.text}
                </p>
              </div>

              <div className={cn("flex-1 px-3 overflow-y-auto scrollbar-none", question.type === 'text' ? 'pb-2' : 'pb-3')}>
                {question.type === "single" && (
                  <div className="space-y-1">
                    {question.options?.map((opt, i) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setQAnswer(opt); setCustomInput(""); }}
                        style={{ animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all animate-in fade-in slide-in-from-left-2 duration-300",
                          qAnswer === opt && customInput === ""
                            ? "bg-primary/10 text-foreground font-medium ring-1 ring-primary/30"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                    <div className={cn(
                      "flex items-center gap-2 mt-1 px-3 py-2 rounded-xl border transition-all",
                      customInput !== ""
                        ? "border-primary/30 bg-primary/10 ring-1 ring-primary/30"
                        : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10]",
                    )}>
                      <input
                        ref={customInputRef}
                        type="text"
                        value={customInput}
                        onChange={(e) => {
                          setCustomInput(e.target.value);
                          setQAnswer(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customInput.trim()) {
                            e.preventDefault();
                            submitAnswer();
                          }
                        }}
                        placeholder="Other..."
                        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                      />
                    </div>
                  </div>
                )}
                {question.type === "multi" && (
                  <div className="space-y-1">
                    {question.options?.map((opt, i) => {
                      const list = Array.isArray(qAnswer) ? qAnswer : [];
                      const isSelected = list.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => toggleMulti(opt)}
                          style={{ animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}
                          className={cn(
                            "w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center justify-between animate-in fade-in slide-in-from-left-2 duration-300",
                            isSelected
                              ? "bg-primary/10 text-foreground font-medium ring-1 ring-primary/30"
                              : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <span>{opt}</span>
                          {isSelected && (
                            <Check className="size-4 text-primary" />
                          )}
                        </button>
                      );
                    })}
                    <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] transition-all focus-within:border-primary/30 focus-within:bg-primary/10 focus-within:ring-1 focus-within:ring-primary/30">
                      <input
                        ref={customInputRef}
                        type="text"
                        value={customInput}
                        onChange={(e) => setCustomInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customInput.trim()) {
                            e.preventDefault();
                            const val = customInput.trim();
                            const list = Array.isArray(qAnswer) ? qAnswer : [];
                            if (!list.includes(val)) setQAnswer([...list, val]);
                            setCustomInput("");
                          }
                        }}
                        placeholder="Add your own..."
                        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
                      />
                      {customInput.trim() && (
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">↵ to add</span>
                      )}
                    </div>
                    {/* Custom selections not in options */}
                    {(Array.isArray(qAnswer) ? qAnswer : [])
                      .filter((v) => !question.options?.includes(v))
                      .map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setQAnswer((Array.isArray(qAnswer) ? qAnswer : []).filter((x) => x !== v))}
                          className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center justify-between bg-primary/10 text-foreground font-medium ring-1 ring-primary/30"
                        >
                          <span>{v}</span>
                          <Check className="size-4 text-primary" />
                        </button>
                      ))}
                  </div>
                )}
                {question.type === "text" && (
                  <textarea
                    ref={qTextRef}
                    value={typeof qAnswer === "string" ? qAnswer : ""}
                    onChange={(e) => setQAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && qHasAnswer) {
                        e.preventDefault();
                        submitAnswer();
                      }
                    }}
                    placeholder="Type your answer..."
                    className="w-full resize-none bg-transparent px-1 py-2 text-sm leading-[22px] text-foreground outline-none placeholder:text-muted-foreground/80"
                    style={{ height: taH }}
                  />
                )}
              </div>

              <div className="flex items-center justify-end px-3 pb-2.5 pt-0.5 mt-auto">
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    submitAnswer();
                  }}
                  disabled={!qHasAnswer}
                  className="flex h-8 items-center gap-1.5 px-3 rounded-full text-xs font-medium transition-all bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Submit <ArrowUpIcon />
                </button>
              </div>
            </div>
          )}

          {/* Normal content — fades out when question is active */}
          <div className={cn("transition-all duration-300", question && "opacity-0 pointer-events-none")}>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setIsSmooth(true);
              setValue(e.target.value);
            }}
            onScroll={updateFades}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
              if (
                e.key === "Escape" &&
                value.trim() === "" &&
                attachments.length === 0
              ) {
                setIsSmooth(false);
                setExpanded(false);
                setModelOpen(false);
              }
            }}
            placeholder={placeholder}
            aria-label="Prompt"
            className={cn(
              "absolute top-0 inset-x-0 z-[1] w-full resize-none bg-transparent pl-4 pr-12 py-3.5 text-sm leading-[22px] text-foreground outline-none placeholder:text-muted-foreground/80",
              expanded
                ? "opacity-100 scale-100 translate-y-0"
                : "opacity-0 scale-95 -translate-y-1 pointer-events-none",
              isScrolling ? "overflow-y-auto scrollbar-none" : "overflow-y-hidden",
            )}
          />

          <div
            ref={topFadeRef}
            className="absolute left-4 right-12 top-0 z-[2] h-8 bg-gradient-to-b from-card via-card/90 to-transparent pointer-events-none"
          />
          <div
            ref={bottomFadeRef}
            className="absolute left-4 right-12 z-[2] h-8 bg-gradient-to-t from-card via-card/90 to-transparent pointer-events-none"
            style={{ opacity: 0, top: `${taH - 32}px` }}
          />

          <button
            type="button"
            onClick={expand}
            style={{
              transition: "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
            }}
            className={cn(
              "absolute inset-x-0 top-0 z-[1] pl-4 pr-12 py-[15px] text-left text-sm font-medium text-muted-foreground/80 outline-none",
              !expanded
                ? "opacity-100 scale-100 translate-y-0"
                : "opacity-0 scale-105 translate-y-1 pointer-events-none",
            )}
          >
            {placeholder}
          </button>

          {/* Bottom actions */}
          <div
            className={cn(
              "absolute bottom-2 left-3 right-12 z-[10] flex items-center gap-0 transition-all duration-300",
              expanded
                ? "opacity-100 blur-0 translate-y-0 pointer-events-auto"
                : "opacity-0 blur-sm translate-y-2 pointer-events-none",
            )}
          >
            {/* Model selector */}
            <div className="relative">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  setModelOpen((p) => !p);
                }}
                className={cn(
                  "group flex items-center gap-1 rounded-full px-2 py-1 text-foreground/50 transition-all hover:bg-accent/60 hover:text-foreground",
                  modelOpen && "bg-accent/60 text-foreground",
                )}
              >
                <ProviderIcon model={selectedModel} className="size-3.5 opacity-70 group-hover:opacity-100" />
                <span className="text-xs font-semibold">
                  <MorphingText text={modelLabel(selectedModel)} />
                </span>
              </button>
              <div
                style={{ transformOrigin: "bottom left" }}
                className={cn(
                  "absolute bottom-full left-0 mb-2.5 z-50 w-48 rounded-2xl border border-border bg-card/95 p-1 shadow-xl backdrop-blur-md flex flex-col gap-0.5 transition-all duration-400",
                  modelOpen
                    ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
                    : "opacity-0 scale-95 translate-y-3 pointer-events-none",
                )}
              >
                {models.map((model, idx) => {
                  const isModelExhausted = modelExhaustionStatus?.[model]?.exhausted;
                  const availableAt = modelExhaustionStatus?.[model]?.availableAt;
                  const availableTime = availableAt ? new Date(availableAt.replace(' ', 'T') + 'Z') : null;
                  const timeRemaining = availableTime ? availableTime.getTime() - Date.now() : null;
                  const hoursRemaining = timeRemaining != null ? Math.ceil(timeRemaining / (1000 * 60 * 60)) : null;
                  
                  return (
                    <button
                      key={model}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() =>
                        setHoverStyle({
                          opacity: 1,
                          transform: `translateY(${idx * 34}px) scale(1)`,
                          transition:
                            "transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
                        })
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isModelExhausted) return;
                        setSelectedModel(model);
                        onModelChange?.(model);
                        setModelOpen(false);
                        if (!modelSupportsEffort(model)) {
                          setEffortIndex(0);
                          onEffortChange?.(efforts[0]);
                        }
                      }}
                      className={cn(
                        "group relative flex h-8 w-full items-center rounded-xl px-2.5 text-left text-xs font-medium text-foreground/80 hover:text-foreground",
                        selectedModel === model && "text-foreground",
                        isModelExhausted && "opacity-40 cursor-not-allowed",
                      )}
                      disabled={isModelExhausted}
                    >
                      <span className="flex items-center gap-2">
                        <ProviderIcon model={model} className="size-3.5 opacity-85 group-hover:opacity-100" />
                        {modelLabel(model)}
                      </span>
                      {isModelExhausted && hoursRemaining != null && hoursRemaining > 0 && (
                        <span className="ml-auto text-[10px] text-muted-foreground/60">
                          {hoursRemaining}h
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Effort toggle - only for models that support it */}
            {showEffort && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={cycleEffort}
                className="group flex items-center gap-1 rounded-full px-2 py-1 text-foreground/50 transition-all hover:bg-accent/60 hover:text-foreground"
              >
                <DynamicBarsIcon level={efforts[effortIndex]} />
                <span className="text-xs font-semibold">
                  <MorphingText text={efforts[effortIndex]} />
                </span>
              </button>
            )}

            {/* Attach button */}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              disabled={attachments.length >= 6}
              className="ml-auto flex size-7 items-center justify-center rounded-full text-foreground/50 transition-all hover:bg-accent/60 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            >
              <PlusIcon />
            </button>
          </div>
          </div>{/* end normal content wrapper */}

          {/* Send / Stop / Answer button */}
          {question ? null : isStreaming ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onStop?.();
              }}
              className="absolute right-2 bottom-2 z-[10] flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                if (hasValue) handleSubmit();
              }}
              disabled={!hasValue}
              className="absolute right-2 bottom-2 z-[10] flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
    );
  },
);
PromptInput.displayName = "PromptInput";
