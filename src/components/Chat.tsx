import { useState, useEffect, useRef, useCallback } from "react";
import { Message, MessageContent } from "src/components/ai-elements/message";
import {
  ChainOfThoughtStep,
} from "src/components/ai-elements/chain-of-thought";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "src/components/ai-elements/conversation";
import { RichContent } from "src/components/rich-content";
import { TransientRetryStep } from "src/components/ui/transient-retry-step";
import { PromptInput } from "src/components/ui/prompt-input";
import { PostAttachments } from "src/components/ui/post-attachment";
import {
  SearchIcon,
  GlobeIcon,
  FileTextIcon,
  ImageIcon,
  MessageSquare,
  PanelLeft,
  AtSign,
  List,
  Eye,
  Send,
  CornerUpLeft,
  Quote,
  Newspaper,
  Heart,
  Repeat2,
  Bookmark,
  UserPlus,
  Info,
  Layers,
  BookOpen,
  MessageCircle,
  BadgeCheck,
  Flame,
  ThumbsUp,
  Database,
  Lightbulb,
  ShieldCheck,
  Gauge,
  Crosshair,
  SquarePen,
  RotateCcw,
  CalendarClock,
  Save,
  Download,
  Users,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { AppLogo } from "src/components/ui/app-logo";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "src/components/ai-elements/reasoning";
import Sidebar, { View } from "src/components/Sidebar";
import ScheduledPosts from "src/components/ScheduledPosts";
import ProfileView from "src/components/Profile";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  steps?: StepItem[];
  isToolAnswer?: boolean;
  attachments?: ChatAttachment[];
}

interface ChatAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

type ApiMessage = {
  role: string;
  content: string | null;
  parts?: {
    text?: string;
    inlineData?: { mimeType: string; data: string };
  }[];
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

function buildApiMessages(msgs: ChatMessage[]): ApiMessage[] {
  const result: ApiMessage[] = [];
  for (const msg of msgs) {
    if (msg.isToolAnswer) continue;
    if (msg.role === "user") {
      const parts: NonNullable<ApiMessage["parts"]> = [];
      if (msg.content.trim()) parts.push({ text: msg.content });
      for (const att of msg.attachments || []) {
        parts.push({
          inlineData: {
            mimeType: att.mimeType || "image/png",
            data: att.dataUrl.split(",")[1] || "",
          },
        });
      }
      result.push({
        role: "user",
        content: msg.content,
        parts: parts.length > 0 ? parts : undefined,
      });
    } else {
      const toolSteps =
        msg.steps?.filter(
          (s): s is StepItem & { type: "tool" } => s.type === "tool",
        ) ?? [];
      if (toolSteps.length > 0) {
        result.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: toolSteps.map((s) => ({
            id: String(s.id),
            type: "function" as const,
            function: { name: s.name, arguments: JSON.stringify(s.args) },
          })),
        });
        for (const ts of toolSteps) {
          result.push({
            role: "tool",
            tool_call_id: String(ts.id),
            content:
              typeof ts.result === "string"
                ? ts.result
                : JSON.stringify(ts.result ?? ""),
          });
        }
      } else {
        result.push({ role: "assistant", content: msg.content });
      }
    }
  }
  return result;
}

async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mimeType: file.type || "image/png",
    dataUrl,
  };
}

type StepItem =
  | {
      type: "reasoning";
      text: string;
    }
  | {
      type: "tool";
      id: number;
      name: string;
      args: any;
      result?: any;
      status: "calling" | "complete";
    }
  | {
      type: "text";
      text: string;
    }
  | {
      type: "question";
      id: string;
      text: string;
      qtype: "single" | "multi" | "text";
      options?: string[];
      answer?: string | string[];
      status: "asking" | "answered";
    };

interface ChatSession {
  id: number;
  title: string;
  msg_count: number;
  updated_at: string;
}

const toolIcons: Record<string, any> = {
  // Twitter
  twitter_search: SearchIcon,
  twitter_user: AtSign,
  twitter_user_posts: List,
  twitter_replies: CornerUpLeft,
  twitter_status: BadgeCheck,
  twitter_whoami: BadgeCheck,
  twitter_followers: Users,
  twitter_following: Users,
  twitter_likes: Heart,
  twitter_article: FileTextIcon,
  twitter_list: List,
  twitter_delete: RotateCcw,
  twitter_tweet: Eye,
  twitter_post: Send,
  twitter_reply: CornerUpLeft,
  twitter_quote: Quote,
  twitter_feed: Newspaper,
  twitter_like: Heart,
  twitter_retweet: Repeat2,
  twitter_bookmark: Bookmark,
  twitter_follow: UserPlus,
  connect_twitter: Download,
  connect_reddit: Download,
  reddit_search: SearchIcon,
  reddit_sub: Layers,
  reddit_sub_info: Info,
  reddit_read: BookOpen,
  reddit_user: AtSign,
  reddit_user_posts: List,
  reddit_user_comments: MessageCircle,
  reddit_login: BadgeCheck,
  reddit_whoami: BadgeCheck,
  reddit_feed: Newspaper,
  reddit_popular: Flame,
  reddit_all: GlobeIcon,
  reddit_saved: Bookmark,
  reddit_upvoted: ThumbsUp,
  reddit_comment: Send,
  reddit_upvote: ThumbsUp,
  reddit_save: Bookmark,
  reddit_subscribe: UserPlus,
  // Strategy reads
  read_profile: AtSign,
  read_hooks: Lightbulb,
  read_voice_rules: MessageCircle,
  read_pillars: Layers,
  read_algorithm: Gauge,
  read_targets: Crosshair,
  read_replies: CornerUpLeft,
  read_social_content: Database,
  read_memory: Database,
  // Strategy saves
  save_hook: Lightbulb,
  save_voice_rule: ShieldCheck,
  save_pillar: Save,
  save_algorithm_rule: Gauge,
  save_target: Crosshair,
  save_reply: CornerUpLeft,
  save_memory: Database,
  update_profile: SquarePen,
  reset_strategy_defaults: RotateCcw,
  delete_voice_rules: Trash2,
  delete_hooks: Trash2,
  delete_pillars: Trash2,
  delete_targets: Trash2,
  delete_algorithm_rules: Trash2,
  save_milestone: TrendingUp,
  twitter_bookmarks: Bookmark,
  // Other
  inspect_image_url: ImageIcon,
  generate_image: ImageIcon,
  schedule_post: CalendarClock,
  get_scheduled_posts: CalendarClock,
};
function getToolIcon(name: string) {
  return toolIcons[name] || GlobeIcon;
}

function MainScreen({
  suggestions,
  onSend,
  selectedModel,
  selectedEffort,
}: {
  suggestions: string[];
  onSend: (text: string, model: string, effort: string) => void;
  selectedModel: string;
  selectedEffort: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-40">
      <div className="flex flex-col items-center">
        <AppLogo
          className="mb-5"
          showLabel={false}
          iconClassName="size-20 rounded-[1.75rem] object-contain shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
        />
        <h1 className="text-[1.65rem] font-bold text-foreground tracking-tight mb-2">Soxial</h1>
        <p className="text-sm text-muted-foreground/60 font-medium mb-8 text-center max-w-sm">
          AI-powered multi-platform social media manager
        </p>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 max-w-md">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSend(s, selectedModel, selectedEffort)}
                className="px-4 py-2 rounded-full text-xs font-medium text-muted-foreground/60 border border-white/[0.06] hover:border-white/[0.15] hover:text-foreground transition-premium-fast bg-white/[0.02] hover:bg-white/[0.04] haptic-lift"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface SessionState {
  messages: ChatMessage[];
  streaming: boolean;
  streamText: string;
  steps: StepItem[];
  stepCounter: number;
  pendingQuestion: {
    id: string;
    text: string;
    type: "single" | "multi" | "text";
    options?: string[];
  } | null;
  transientRetry: { attempt: number; maxAttempts: number; backoffMs: number; model: string } | null;
  status: "idle" | "running" | "completed-unread" | "question-unread" | "error-unread";
}

export default function Chat({ initialSessionId }: { initialSessionId?: number | null }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [sessionStates, setSessionStates] = useState<Record<number, SessionState>>({});

  const streamTextRefs = useRef<Record<number, string>>({});
  const stepsRefs = useRef<Record<number, StepItem[]>>({});

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModelState] = useState("gemini-3.5-flash-lite");

  const setSelectedModel = useCallback((model: string) => {
    setSelectedModelState(model);
    window.api.setSelectedModel(model).catch(() => {});
  }, []);
  const [selectedEffort, setSelectedEffort] = useState("Medium");
  const currentSessionIdRef = useRef<number | null>(null);
  const [inputEl, setInputEl] = useState<HTMLDivElement | null>(null);
  const [inputAreaHeight, setInputAreaHeight] = useState(0);
  const [scrollbarW, setScrollbarW] = useState(6);
  const contextSummaryRef = useRef<string | null>(null);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const fetchedQuickActions = useRef(false);
  const [view, setView] = useState<View>("chat");
  const [profile, setProfile] = useState<any>(null);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [apiTier, setApiTier] = useState<{ tier: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelExhaustionStatus, setModelExhaustionStatus] = useState<Record<string, { exhausted: boolean; availableAt: string | null }>>({});

  const getOrCreateSessionState = (sid: number, initialMsgs: ChatMessage[] = []): SessionState => {
    if (sessionStates[sid]) return sessionStates[sid];
    return {
      messages: initialMsgs,
      streaming: false,
      streamText: "",
      steps: [],
      stepCounter: 0,
      pendingQuestion: null,
      transientRetry: null,
      status: "idle",
    };
  };

  const currentSessionState = currentSessionId !== null ? getOrCreateSessionState(currentSessionId) : null;
  const messages = currentSessionState ? currentSessionState.messages : [];
  const streaming = currentSessionState ? currentSessionState.streaming : false;
  const streamText = currentSessionState ? currentSessionState.streamText : "";
  const steps = currentSessionState ? currentSessionState.steps : [];
  const pendingQuestion = currentSessionState ? currentSessionState.pendingQuestion : null;
  const transientRetry = currentSessionState ? currentSessionState.transientRetry : null;

  function parseAttachments(raw: any): ChatAttachment[] | undefined {
    if (!raw) return undefined;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(parsed)) return undefined;
      const attachments = parsed
        .map((att: any) => {
          const dataUrl =
            typeof att?.dataUrl === "string" && att.dataUrl.startsWith("data:")
              ? att.dataUrl
              : typeof att?.data === "string"
                ? `data:${att.mimeType || "image/png"};base64,${att.data}`
                : "";
          if (!dataUrl) return null;
          return {
            name: String(att?.name || "image"),
            mimeType: String(att?.mimeType || "image/png"),
            dataUrl,
            width: typeof att?.width === "number" ? att.width : undefined,
            height: typeof att?.height === "number" ? att.height : undefined,
          } satisfies ChatAttachment;
        })
        .filter(Boolean) as ChatAttachment[];
      return attachments.length > 0 ? attachments : undefined;
    } catch {
      return undefined;
    }
  }

  function partsToAttachments(parts: any[] | undefined): ChatAttachment[] | undefined {
    if (!Array.isArray(parts) || parts.length === 0) return undefined;
    const attachments = parts
      .map((part: any, index: number) => {
        const inlineData = part?.inlineData;
        if (!inlineData?.data) return null;
        const mimeType = String(inlineData.mimeType || "image/png");
        return {
          name: `attachment-${index + 1}`,
          mimeType,
          dataUrl: `data:${mimeType};base64,${inlineData.data}`,
        } satisfies ChatAttachment;
      })
      .filter(Boolean) as ChatAttachment[];
    return attachments.length > 0 ? attachments : undefined;
  }

  function resultToAttachments(result: any): ChatAttachment[] | undefined {
    if (!result) return undefined;
    const items = Array.isArray(result)
      ? result
      : Array.isArray(result.attachments)
        ? result.attachments
        : Array.isArray(result.parts)
          ? result.parts
          : [result];
    const attachments = items
      .map((item: any, index: number) => {
        const inlineData = item?.inlineData;
        const data = inlineData?.data || item?.data;
        if (typeof data !== "string" || !data) return null;
        const mimeType = String(
          inlineData?.mimeType || item?.mimeType || item?.mime_type || "image/png",
        );
        return {
          name: String(item?.name || item?.filename || `image-${index + 1}`),
          mimeType,
          dataUrl: data.startsWith("data:")
            ? data
            : `data:${mimeType};base64,${data}`,
        } satisfies ChatAttachment;
      })
      .filter(Boolean) as ChatAttachment[];
    return attachments.length > 0 ? attachments : undefined;
  }

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (!inputEl) return;
    const update = () => setInputAreaHeight(inputEl.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(inputEl);
    return () => ro.disconnect();
  }, [inputEl]);

  useEffect(() => {
    const sb = document.createElement("div");
    sb.style.cssText =
      "width:50px;height:50px;overflow:scroll;position:absolute;opacity:0;";
    document.body.appendChild(sb);
    setScrollbarW(sb.offsetWidth - sb.clientWidth || 6);
    document.body.removeChild(sb);
  }, []);

  useEffect(() => {
    loadSessions();
    window.api.getProfile().then(setProfile);
    loadScheduledCount();
    loadApiInfo();
  }, []);

  async function loadApiInfo() {
    try {
      const tier = await window.api.getTier();
      setApiTier(tier);
      
      const models = await window.api.getAvailableModels();
      setAvailableModels(models);
      
      // Load persisted model preference, fall back to default if not available
      const persisted = await window.api.getSelectedModel();
      if (persisted && models.includes(persisted)) {
        setSelectedModelState(persisted);
      } else if (models.length > 0 && !models.includes(selectedModel)) {
        const defaultModel = await window.api.getDefaultModel();
        setSelectedModelState(defaultModel);
      }

      // Load model exhaustion status for all models
      const exhaustionInfo: Record<string, { exhausted: boolean; availableAt: string | null }> = {};
      for (const model of models) {
        const status = await window.api.getModelExhaustionStatus(model);
        exhaustionInfo[model] = status;
      }
      setModelExhaustionStatus(exhaustionInfo);
    } catch (err) {
      console.error('Failed to load API info:', err);
    }
  }

  const autoSendDone = useRef(false);
  const [pendingAutoSend, setPendingAutoSend] = useState<string | null>(null);

  useEffect(() => {
    if (!initialSessionId || autoSendDone.current) return;
    autoSendDone.current = true;
    selectSession(initialSessionId).then(() => {
      setPendingAutoSend("approved nxan");
    });
  }, [initialSessionId]);

  useEffect(() => {
    if (pendingAutoSend && !streaming && messages.length > 0) {
      const msg = pendingAutoSend;
      setPendingAutoSend(null);
      send(msg);
    }
  }, [pendingAutoSend, messages, streaming]);

  useEffect(() => {
    if (currentSessionId === null) {
      if (!fetchedQuickActions.current) {
        fetchedQuickActions.current = true;
        window.api.generateQuickActions().then((r: any) => {
          if (r.success) setQuickActions(r.suggestions);
        });
      }
    } else {
      fetchedQuickActions.current = false;
    }
  }, [currentSessionId]);

  async function loadSessions() {
    const s = await window.api.getSessions();
    setSessions(s);
  }

  async function loadScheduledCount() {
    const posts = await window.api.dbQuery(
      "scheduled_posts",
      "status = ? OR status = ?",
      ["draft", "scheduled"],
    );
    setScheduledCount(posts?.length || 0);
  }

  function parseSteps(
    reasoningRaw: string | null | undefined,
    toolCallsRaw: string | null | undefined,
  ): StepItem[] | undefined {
    if (!reasoningRaw && !toolCallsRaw) return undefined;
    const parsed: StepItem[] = [];
    if (reasoningRaw) {
      try {
        const r = JSON.parse(reasoningRaw);
        if (Array.isArray(r)) {
          if (r.length > 0 && r[0].type) {
            return r as StepItem[];
          }
          for (const seg of r) {
            parsed.push({ type: "reasoning", text: seg.text || seg });
          }
        }
      } catch {
        parsed.push({ type: "reasoning", text: reasoningRaw });
      }
    }
    if (toolCallsRaw) {
      try {
        const tc = JSON.parse(toolCallsRaw);
        if (Array.isArray(tc)) {
          for (const t of tc) {
            parsed.push({
              type: "tool",
              id: t.id,
              name: t.name,
              args: t.args,
              result: t.result,
              status: "complete",
            });
          }
        }
      } catch {}
    }
    return parsed.length > 0 ? parsed : undefined;
  }

  async function selectSession(id: number) {
    setView("chat");
    setCurrentSessionId(id);
    const msgs = await window.api.getMessages(id);
    const parsed = msgs.map((m: any) => ({
      role: m.role,
      content: m.content || "",
      steps: parseSteps(m.reasoning, m.tool_calls_json),
      attachments: parseAttachments(m.attachments_json),
    }));
    
    setSessionStates((prev) => {
      const current = prev[id] || {
        messages: parsed,
        streaming: false,
        streamText: "",
        steps: [],
        stepCounter: 0,
        pendingQuestion: null,
        transientRetry: null,
        status: "idle",
      };
      return {
        ...prev,
        [id]: {
          ...current,
          messages: parsed,
          status: "idle", // we entered the chat, mark as read
        },
      };
    });

    contextSummaryRef.current = await window.api.getSessionSummary(id);
  }

  async function newChat() {
    setView("chat");
    setCurrentSessionId(null);
    contextSummaryRef.current = null;
  }

  async function deleteSession(id: number) {
    await window.api.deleteSession(id);
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (currentSessionId === id) {
      setCurrentSessionId(null);
      contextSummaryRef.current = null;
    }
  }

  useEffect(() => {
    window.api.onChatToolCall((data: { name: string; args: any; sessionId: number }) => {
      const sid = data.sessionId;
      setSessionStates((prev) => {
        const state = prev[sid] || {
          messages: [],
          streaming: true,
          streamText: "",
          steps: [],
          stepCounter: 0,
          pendingQuestion: null,
          transientRetry: null,
          status: "running",
        };
        const nextSteps = [...state.steps];
        const nextStepCounter = state.stepCounter + 1;
        
        const tool: StepItem = {
          type: "tool",
          id: state.stepCounter,
          name: data.name,
          args: data.args,
          status: "calling",
        };
        nextSteps.push(tool);
        stepsRefs.current[sid] = nextSteps;

        return {
          ...prev,
          [sid]: {
            ...state,
            streaming: true,
            status: "running",
            stepCounter: nextStepCounter,
            steps: nextSteps,
          },
        };
      });
    });

    window.api.onChatToolResult((data: { name: string; result: any; sessionId: number }) => {
      const sid = data.sessionId;
      setSessionStates((prev) => {
        const state = prev[sid];
        if (!state) return prev;
        let found = false;
        const nextSteps = state.steps.map((s) => {
          if (
            !found &&
            s.type === "tool" &&
            s.name === data.name &&
            s.status === "calling"
          ) {
            found = true;
            return { ...s, status: "complete" as const, result: data.result };
          }
          return s;
        });
        stepsRefs.current[sid] = nextSteps;

        return {
          ...prev,
          [sid]: {
            ...state,
            steps: nextSteps,
          },
        };
      });
    });

    window.api.onChatReasoning((data: { text: string; sessionId: number }) => {
      const sid = data.sessionId;
      setSessionStates((prev) => {
        const state = prev[sid] || {
          messages: [],
          streaming: true,
          streamText: "",
          steps: [],
          stepCounter: 0,
          pendingQuestion: null,
          transientRetry: null,
          status: "running",
        };
        const nextSteps = [...state.steps];
        const lastIdx = nextSteps.length - 1;
        const last = nextSteps[lastIdx];
        if (last && last.type === "reasoning") {
          nextSteps[lastIdx] = { ...last, text: last.text + data.text };
        } else {
          nextSteps.push({ type: "reasoning", text: data.text });
        }
        stepsRefs.current[sid] = nextSteps;

        return {
          ...prev,
          [sid]: {
            ...state,
            streaming: true,
            status: "running",
            steps: nextSteps,
          },
        };
      });
    });

    window.api.onChatError((data: { error: string; sessionId: number }) => {
      const sid = data.sessionId;
      setSessionStates((prev) => {
        const state = prev[sid] || {
          messages: [],
          streaming: false,
          streamText: "",
          steps: [],
          stepCounter: 0,
          pendingQuestion: null,
          transientRetry: null,
          status: "idle",
        };
        const nextMessages: ChatMessage[] = [
          ...state.messages,
          { role: "assistant" as const, content: `Error: ${data.error}` },
        ];
        return {
          ...prev,
          [sid]: {
            ...state,
            streaming: false,
            transientRetry: null,
            messages: nextMessages,
            status: currentSessionIdRef.current === sid ? "idle" : "error-unread",
          },
        };
      });
    });

    window.api.onChatQuestion((q: { id: string; text: string; type: "single" | "multi" | "text"; options?: string[]; sessionId: number }) => {
      const sid = q.sessionId;
      setSessionStates((prev) => {
        const state = prev[sid] || {
          messages: [],
          streaming: true,
          streamText: "",
          steps: [],
          stepCounter: 0,
          pendingQuestion: null,
          transientRetry: null,
          status: "running",
        };
        const nextSteps = [...state.steps];
        const step: StepItem = {
          type: "question",
          id: q.id,
          text: q.text,
          qtype: q.type,
          options: q.options,
          status: "asking",
        };
        nextSteps.push(step);
        stepsRefs.current[sid] = nextSteps;

        return {
          ...prev,
          [sid]: {
            ...state,
            streaming: true, // make sure we keep streaming true if background
            steps: nextSteps,
            pendingQuestion: q,
            status: currentSessionIdRef.current === sid ? "running" : "question-unread",
          },
        };
      });
    });

    window.api.onChatTransientRetry((info: { attempt: number; maxAttempts: number; backoffMs: number; model: string; sessionId: number }) => {
      const sid = info.sessionId;
      setSessionStates((prev) => {
        const state = prev[sid];
        if (!state) return prev;
        return {
          ...prev,
          [sid]: {
            ...state,
            transientRetry: info,
          },
        };
      });
    });

    window.api.onChatInjected((data: { messages: any[]; sessionId: number }) => {
      const sid = data.sessionId;
      const injectedContents = data.messages
        .filter((m) => m.role === "user" && (m.content?.trim() || m.parts?.length))
        .map((m: any) => {
          const attachments = partsToAttachments(m.parts) || [];
          const content = String(m.content || "").trim();
          return {
            content,
            label:
              content ||
              (attachments.length > 0
                ? `[Image attachment${attachments.length > 1 ? "s" : ""}]`
                : "[Queued message]"),
            attachments,
          };
        });
      if (injectedContents.length === 0) return;

      // Compute values OUTSIDE the updater — StrictMode invokes updaters twice
      const assistantContent = streamTextRefs.current[sid] || "";
      const assistantSteps = stepsRefs.current[sid] || [];
      const assistantMsg =
        assistantContent.trim() || assistantSteps.length > 0
          ? {
              role: "assistant" as const,
              content: assistantContent,
              steps: assistantSteps.length > 0 ? assistantSteps : undefined,
            }
          : null;

      // Side effects outside updater (prevents double DB inserts in StrictMode)
      void (async () => {
        if (assistantMsg) {
          const stepsJson = assistantMsg.steps
            ? JSON.stringify(assistantMsg.steps)
            : undefined;
          await window.api.addMessage(
            sid,
            "assistant",
            assistantMsg.content,
            stepsJson,
          );
        }
        for (const injected of injectedContents) {
          await window.api.addMessage(
            sid,
            "user",
            injected.content,
            undefined,
            undefined,
            injected?.attachments?.length
              ? JSON.stringify(injected.attachments)
              : undefined,
          );
        }
      })();

      setQueuedMessages((qPrev) => {
        const next = [...qPrev];
        for (const { label } of injectedContents) {
          const idx = next.indexOf(label);
          if (idx !== -1) next.splice(idx, 1);
        }
        return next;
      });

      streamTextRefs.current[sid] = "";
      stepsRefs.current[sid] = [];

      setSessionStates((prev) => {
        const state = prev[sid];
        if (!state) return prev;

        const userMsgs = injectedContents.map(({ content, attachments }) => ({
          role: "user" as const,
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
        }));

        const nextMessages = [
          ...state.messages,
          ...(assistantMsg ? [assistantMsg] : []),
          ...userMsgs,
        ];

        return {
          ...prev,
          [sid]: {
            ...state,
            messages: nextMessages,
            streamText: "",
            steps: [],
          },
        };
      });
    });

    window.api.onChatModelSwitch((data: { model: string; sessionId: number }) => {
      if (data.sessionId === currentSessionIdRef.current) {
        setSelectedModelState(data.model);
        window.api.setSelectedModel(data.model).catch(() => {});
      }
    });

    return () => {
      window.api.removeAllListeners("chat:toolCall");
      window.api.removeAllListeners("chat:toolResult");
      window.api.removeAllListeners("chat:reasoning");
      window.api.removeAllListeners("chat:error");
      window.api.removeAllListeners("chat:question");
      window.api.removeAllListeners("chat:transientRetry");
      window.api.removeAllListeners("chat:injected");
      window.api.removeAllListeners("chat:modelSwitch");
    };
  }, []);

  const handleAnswer = (answer: string | string[]) => {
    if (!pendingQuestion) return;
    const sid = currentSessionId;
    if (sid === null) return;

    setSessionStates((prev) => {
      const state = prev[sid];
      if (!state) return prev;
      const nextSteps = state.steps.map((s) =>
        s.type === "question" && s.id === pendingQuestion.id
          ? { ...s, status: "answered" as const, answer }
          : s
      );
      stepsRefs.current[sid] = nextSteps;
      return {
        ...prev,
        [sid]: {
          ...state,
          steps: nextSteps,
          pendingQuestion: null,
        },
      };
    });

    window.api.sendChatAnswer(pendingQuestion.id, answer);
  };

  const handleCardAction = (type: string, data: any) => {
    if (streaming) return;
    const cardId = data.id || data.tweetId || data.postId;
    if (cardId) {
      send(`approved ${cardId}`);
    } else {
      send("Go ahead and post this");
    }
  };

  const send = async (
    text: string,
    model?: string,
    effort?: string,
    files: File[] = [],
  ) => {
    const content = text.trim();
    const preparedAttachments =
      files.length > 0 ? await Promise.all(files.map(fileToAttachment)) : [];
    if (!content && preparedAttachments.length === 0) return;
    const queuedLabel =
      content ||
      (preparedAttachments.length > 0
        ? `[Image attachment${preparedAttachments.length > 1 ? "s" : ""}]`
        : "");
    if (streaming) {
      setQueuedMessages((prev) => [...prev, queuedLabel]);
      const sid = currentSessionId;
      window.api
        .chatInject(
          preparedAttachments.length > 0
            ? {
                content,
                attachments: preparedAttachments.map((att) => ({
                  name: att.name,
                  mimeType: att.mimeType,
                  data: att.dataUrl.split(",")[1] || "",
                })),
              }
            : content,
          sid ?? undefined
        )
        .then((r: any) => {
          if (r?.success) return;
          setQueuedMessages((prev) => {
            const next = [...prev];
            const idx = next.indexOf(queuedLabel);
            if (idx !== -1) next.splice(idx, 1);
            return next;
          });
          if (sid !== null) {
            setSessionStates((prev) => {
              const state = prev[sid];
              if (!state) return prev;
              return {
                ...prev,
                [sid]: {
                  ...state,
                  messages: [
                    ...state.messages,
                    {
                      role: "assistant",
                      content: `Error: Could not inject message into the active run${r?.error ? ` (${r.error})` : ""}.`,
                    },
                  ],
                },
              };
            });
          }
        });
      return;
    }

    const useModel = model || selectedModel;
    const useEffort = effort || selectedEffort;
    setSelectedModel(useModel);
    setSelectedEffort(useEffort);

    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await window.api.createSession();
      setCurrentSessionId(sessionId);
      setSessions(await window.api.getSessions());
    }

    const sid = sessionId;

    setSessionStates((prev) => ({
      ...prev,
      [sid]: {
        messages: [...(prev[sid]?.messages || []), { role: "user", content, attachments: preparedAttachments.length > 0 ? preparedAttachments : undefined }],
        streaming: true,
        streamText: "",
        steps: [],
        stepCounter: 0,
        pendingQuestion: null,
        transientRetry: null,
        status: "running",
      },
    }));

    await window.api.addMessage(
      sid,
      "user",
      content,
      undefined,
      undefined,
      preparedAttachments.length > 0 ? JSON.stringify(preparedAttachments) : undefined,
    );

    const summary = contextSummaryRef.current;
    
    // Build API messages from the updated state messages
    const currentMsgs = [
      ...(sessionStates[sid]?.messages || []),
      { role: "user" as const, content, attachments: preparedAttachments.length > 0 ? preparedAttachments : undefined }
    ];
    const fullApiMessages = buildApiMessages(currentMsgs);
    const textOnlyMessages = currentMsgs.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    let apiMessages: (ApiMessage | { role: "system"; content: string })[];
    if (summary) {
      apiMessages = [
        {
          role: "system",
          content: `Previous conversation summary: ${summary}`,
        },
        ...fullApiMessages.slice(-12),
      ];
    } else {
      apiMessages = fullApiMessages;
    }

    const unlistenChunk = window.api.onChatChunk((data: { text: string; sessionId: number }) => {
      if (data.sessionId !== sid) {
        // Handle background chunk
        setSessionStates((prev) => {
          const state = prev[data.sessionId];
          if (!state) return prev;
          const nextStreamText = state.streamText + data.text;
          streamTextRefs.current[data.sessionId] = nextStreamText;
          const nextSteps = [...state.steps];
          const lastIdx = nextSteps.length - 1;
          const last = nextSteps[lastIdx];
          if (last && last.type === "text") {
            nextSteps[lastIdx] = { ...last, text: last.text + data.text };
          } else {
            nextSteps.push({ type: "text", text: data.text });
          }
          stepsRefs.current[data.sessionId] = nextSteps;
          return {
            ...prev,
            [data.sessionId]: {
              ...state,
              streamText: nextStreamText,
              steps: nextSteps,
            },
          };
        });
        return;
      }

      setSessionStates((prev) => {
        const state = prev[sid];
        if (!state) return prev;
        const nextStreamText = state.streamText + data.text;
        streamTextRefs.current[sid] = nextStreamText;
        const nextSteps = [...state.steps];
        const lastIdx = nextSteps.length - 1;
        const last = nextSteps[lastIdx];
        if (last && last.type === "text") {
          nextSteps[lastIdx] = { ...last, text: last.text + data.text };
        } else {
          nextSteps.push({ type: "text", text: data.text });
        }
        stepsRefs.current[sid] = nextSteps;
        return {
          ...prev,
          [sid]: {
            ...state,
            transientRetry: null,
            streamText: nextStreamText,
            steps: nextSteps,
          },
        };
      });
    });

    const result = await window.api.chatSend(apiMessages, {
      model: useModel,
      effort: useEffort,
    }, sid);

    unlistenChunk();

    // Read latest values from REFS (always current — sessionStates closure is stale)
    const finalContent = result.fullText || streamTextRefs.current[sid] || "";
    const completedSteps = stepsRefs.current[sid] || [];
    const stepsJson = completedSteps.length > 0 ? JSON.stringify(completedSteps) : undefined;

    // Side effects OUTSIDE updater (StrictMode invokes updaters twice → double DB inserts)
    void window.api.addMessage(sid, "assistant", finalContent, stepsJson, undefined);

    const prevMsgCount = sessionStates[sid]?.messages.length || 0;
    const userMsgCount = Math.ceil((prevMsgCount + 2) / 2);
    if (userMsgCount === 1) {
      window.api.generateTitle(sid, textOnlyMessages).then(async () => {
        setSessions(await window.api.getSessions());
      });
    }

    const prevContentLen = (sessionStates[sid]?.messages || []).reduce((sum: number, m: ChatMessage) => sum + m.content.length, 0);
    const contextEstimate = prevContentLen + finalContent.length;
    if (userMsgCount > 0 && userMsgCount % 50 === 0) {
      window.api.reTitle(sid, textOnlyMessages);
    } else if (contextEstimate >= 150000) {
      window.api.reTitle(sid, textOnlyMessages);
    }

    if (contextEstimate >= 100000 && !summary) {
      window.api.generateSummary(sid, textOnlyMessages).then((r: any) => {
        if (r.success) contextSummaryRef.current = r.summary;
      });
    }

    // Clear refs AFTER reading values
    streamTextRefs.current[sid] = "";
    stepsRefs.current[sid] = [];

    // Pure state update — no side effects inside (StrictMode safe)
    setSessionStates((prev) => {
      const state = prev[sid];
      if (!state) return prev;
      return {
        ...prev,
        [sid]: {
          ...state,
          streaming: false,
          messages: [
            ...state.messages,
            {
              role: "assistant" as const,
              content: finalContent,
              steps: completedSteps.length > 0 ? completedSteps : undefined,
            },
          ],
          streamText: "",
          steps: [],
          status: currentSessionIdRef.current === sid ? "idle" : "completed-unread",
        },
      };
    });

    setSessions(await window.api.getSessions());
    loadScheduledCount();

    // Refresh model exhaustion status (models may have been rate-limited during the run)
    const models = await window.api.getAvailableModels();
    const exhaustionInfo: Record<string, { exhausted: boolean; availableAt: string | null }> = {};
    for (const model of models) {
      exhaustionInfo[model] = await window.api.getModelExhaustionStatus(model);
    }
    setModelExhaustionStatus(exhaustionInfo);
  };

  const handleStop = async () => {
    if (currentSessionId !== null) {
      await window.api.chatStop(currentSessionId);
    }
  };

  const hasActivity = steps.length > 0;
  const allToolsDone =
    steps.length > 0 &&
    steps.every((s) => (s.type === "tool" ? s.status === "complete" : true));
  const onMainScreen = currentSessionId === null;

  return (
    <div className="flex h-full overflow-hidden">
      {sidebarOpen && (
        <Sidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          currentView={view}
          streaming={streaming}
          profile={profile}
          scheduledCount={scheduledCount}
          sessionStates={sessionStates}
          onNewChat={newChat}
          onSelectSession={selectSession}
          onDeleteSession={deleteSession}
          onNavigate={setView}
          onToggleSidebar={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col relative min-w-0">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className={`absolute left-3 z-20 p-2 rounded-xl text-muted-foreground/40 hover:text-muted-foreground hover:bg-white/[0.04] transition-premium-fast border border-transparent hover:border-white/[0.06] ${window.api.platform === 'darwin' ? 'top-10' : 'top-3'}`}
          >
            <PanelLeft className="size-3.5" />
          </button>
        )}

        {view === "scheduled" ? (
          <ScheduledPosts profile={profile} onBack={() => setView("chat")} />
        ) : view === "profile" ? (
          <ProfileView
            profile={profile}
            onSaved={() => {
              window.api.getProfile().then(setProfile);
              loadApiInfo();
            }}
            onBack={() => {
              window.api.getProfile().then(setProfile);
              loadApiInfo();
              setView("chat");
            }}
          />
        ) : (
          <>
            {onMainScreen ? (
              <MainScreen
                suggestions={quickActions}
                onSend={(text, model, effort) => send(text, model, effort)}
                selectedModel={selectedModel}
                selectedEffort={selectedEffort}
              />
            ) : (
              <Conversation className="flex-1">
                <ConversationContent className="max-w-3xl mx-auto w-full pt-16 [&>*]:transition-premium-fast">
                  {messages.length === 0 && !streaming ? (
                    <ConversationEmptyState
                      icon={<AppLogo showLabel={false} iconClassName="size-14 rounded-[1.1rem]" />}
                      title="What would you like to work on?"
                      description="Craft posts, research topics, plan content, or analyze performance."
                    />
                  ) : (
                    <>
                      {contextSummaryRef.current && (
                        <div className="text-[10px] text-muted-foreground/35 font-medium px-4 py-2 border-l border-white/[0.04] tracking-wide">
                          Compacted history — context active
                        </div>
                      )}
                      {messages.map((msg, i) => (
                        <Message key={i} from={msg.role}>
                          <MessageContent>
                            {msg.role === "user" && msg.attachments?.length ? (
                              <div className="mb-2">
                                <PostAttachments
                                  attachments={msg.attachments.map((att) => ({
                                    type: "image",
                                    url: att.dataUrl,
                                    alt: att.name,
                                  }))}
                                />
                              </div>
                            ) : null}
                            {msg.steps?.length ? (
                              <div className="flex flex-col gap-1.5 mb-2">
                                {msg.steps.map((step, si) => {
                                  const hide = (step.type === "reasoning" || step.type === "tool") && 
                                    msg.steps!.some((s, idx) => idx > si && s.type === "text");
                                  if (hide) return null;
                                  
                                  return step.type === "reasoning" ? (
                                    <Reasoning key={si} defaultOpen={true}>
                                      <ReasoningTrigger />
                                      <ReasoningContent>
                                        {step.text}
                                      </ReasoningContent>
                                    </Reasoning>
                                  ) : step.type === "tool" ? (
                                    <div key={si} className="space-y-2">
                                      <ChainOfThoughtStep
                                        icon={getToolIcon(step.name)}
                                        label={step.name}
                                        status="complete"
                                      />
                                      {step.status === "complete" &&
                                      resultToAttachments(step.result)?.length ? (
                                        <PostAttachments
                                          attachments={resultToAttachments(step.result)!.map(
                                            (att) => ({
                                              type: "image",
                                              url: att.dataUrl,
                                              alt: att.name,
                                            }),
                                          )}
                                        />
                                      ) : null}
                                    </div>
                                  ) : step.type === "text" ? (
                                    <RichContent key={si} onCardAction={handleCardAction}>
                                      {step.text}
                                    </RichContent>
                                  ) : step.type === "question" ? (
                                    <ChainOfThoughtStep
                                      key={si}
                                      icon={step.status === "answered" ? MessageSquare : MessageSquare}
                                      label={step.status === "answered"
                                        ? `${step.text} → ${Array.isArray(step.answer) ? step.answer.join(", ") : step.answer}`
                                        : step.text}
                                      status={step.status === "answered" ? "complete" : "active"}
                                    />
                                  ) : null;
                                })}
                              </div>
                            ) : null}
                            {(!msg.steps || !msg.steps.some((s) => s.type === "text")) && msg.content && (
                              <RichContent onCardAction={handleCardAction}>
                                {msg.content}
                              </RichContent>
                            )}
                          </MessageContent>
                        </Message>
                      ))}

                      {streaming && (
                        <Message from="assistant">
                          <MessageContent>
                            {(hasActivity || transientRetry) ? (
                              <div className="flex flex-col gap-1.5 mb-2">
                                {steps.map((step, si) => {
                                  const hide = (step.type === "reasoning" || step.type === "tool") && 
                                    steps.some((s, idx) => idx > si && s.type === "text");
                                  if (hide) return null;

                                  return step.type === "reasoning" ? (
                                    <Reasoning
                                      key={si}
                                      isStreaming={
                                        si === steps.length - 1 && streaming
                                      }
                                      defaultOpen={true}
                                    >
                                      <ReasoningTrigger />
                                      <ReasoningContent>
                                        {step.text}
                                      </ReasoningContent>
                                    </Reasoning>
                                  ) : step.type === "tool" ? (
                                    <div key={si} className="space-y-2">
                                      <ChainOfThoughtStep
                                        icon={getToolIcon(step.name)}
                                        label={step.name}
                                        description={
                                          step.status === "calling"
                                            ? JSON.stringify(step.args)
                                            : undefined
                                        }
                                        status={
                                          step.status === "calling"
                                            ? "active"
                                            : "complete"
                                        }
                                      />
                                      {step.status === "complete" &&
                                      resultToAttachments(step.result)?.length ? (
                                        <PostAttachments
                                          attachments={resultToAttachments(step.result)!.map(
                                            (att) => ({
                                              type: "image",
                                              url: att.dataUrl,
                                              alt: att.name,
                                            }),
                                          )}
                                        />
                                      ) : null}
                                    </div>
                                  ) : step.type === "text" ? (
                                    <RichContent
                                      key={si}
                                      isAnimating={si === steps.length - 1 && streaming}
                                      onCardAction={handleCardAction}
                                    >
                                      {step.text}
                                    </RichContent>
                                  ) : step.type === "question" ? (
                                    <ChainOfThoughtStep
                                      key={si}
                                      icon={MessageSquare}
                                      label={step.status === "answered"
                                        ? `${step.text} → ${Array.isArray(step.answer) ? step.answer.join(", ") : step.answer}`
                                        : step.text}
                                      status={step.status === "answered" ? "complete" : "active"}
                                    />
                                  ) : null;
                                })}
                                {transientRetry && (
                                  <TransientRetryStep
                                    key={transientRetry.attempt}
                                    attempt={transientRetry.attempt}
                                    maxAttempts={transientRetry.maxAttempts}
                                    backoffMs={transientRetry.backoffMs}
                                    model={transientRetry.model}
                                    onExpire={() => {
                                      const sid = currentSessionId;
                                      if (sid !== null) {
                                        setSessionStates((prev) => {
                                          const state = prev[sid];
                                          if (!state) return prev;
                                          return {
                                            ...prev,
                                            [sid]: {
                                              ...state,
                                              transientRetry: null,
                                            },
                                          };
                                        });
                                      }
                                    }}
                                  />
                                )}
                                {allToolsDone && !streamText && !transientRetry && (
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                                    <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                                    <span>Continuing...</span>
                                  </div>
                                )}
                              </div>
                            ) : null}

                            {!hasActivity && !streamText && !transientRetry && (
                              <div className="flex items-center gap-1.5 py-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '0ms', animationDuration: '1.2s' }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '200ms', animationDuration: '1.2s' }} />
                                <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '400ms', animationDuration: '1.2s' }} />
                              </div>
                            )}
                          </MessageContent>
                        </Message>
                      )}
                    </>
                  )}
                  <div style={{ height: inputAreaHeight + 48 }} />
                </ConversationContent>
                {messages.length > 0 && (
                  <ConversationScrollButton
                    bottomOffset={inputAreaHeight + 56}
                  />
                )}
              </Conversation>
            )}

            <div
              className="absolute bottom-0 left-0 px-4 pb-5 bg-gradient-to-t from-background via-background via-60% to-transparent pointer-events-none"
              style={{
                right: scrollbarW,
                paddingTop: Math.max(
                  32,
                  Math.round(inputAreaHeight * 0.25) || 48,
                ),
              }}
            >
              <div ref={setInputEl} className="max-w-3xl mx-auto flex justify-center">
                <PromptInput
                  placeholder={
                    onMainScreen
                      ? "Start a new conversation..."
                      : "Message Soxial..."
                  }
                  models={availableModels.length > 0 ? availableModels : ["gemini-3.5-flash-lite"]}
                  model={selectedModel}
                  modelSupportsEffort={(model) => model !== "gemini-3.1-pro" && !model.startsWith("glm")}
                  isStreaming={streaming}
                  onStop={handleStop}
                  queue={queuedMessages}
                  onRemoveQueued={(i) =>
                    setQueuedMessages((prev) =>
                      prev.filter((_, idx) => idx !== i),
                    )
                  }
                  question={pendingQuestion || undefined}
                  onAnswer={handleAnswer}
                  onSubmit={(value, meta) => send(value, meta.model, meta.effort, meta.attachments)}
                  modelExhaustionStatus={modelExhaustionStatus}
                  onModelChange={(model) => setSelectedModel(model)}
                  onEffortChange={(effort) => setSelectedEffort(effort)}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
