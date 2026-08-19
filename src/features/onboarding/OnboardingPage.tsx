"use client";

import { useState, useEffect, useRef } from 'react'
import { Check, Sparkles, ArrowRight, RefreshCw, ShieldAlert, Search as SearchIcon, Globe as GlobeIcon, Image as ImageIcon, AtSign, List, Eye, Send, CornerUpLeft, Newspaper, Heart, Repeat2, Bookmark, UserPlus, Info, Layers, BookOpen, MessageCircle, BadgeCheck, Flame, ThumbsUp, Database, Lightbulb, ShieldCheck, Gauge, Crosshair, SquarePen, RotateCcw, CalendarClock, Save, Download, Briefcase, Users, Package, Target, FileText, Trash2, TrendingUp, MessageSquare, Plus, KeyRound } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { Message, MessageContent } from 'src/components/ai-elements/message'
import { ChainOfThoughtStep } from 'src/components/ai-elements/chain-of-thought'
import {
  Conversation, ConversationContent, ConversationScrollButton
} from 'src/components/ai-elements/conversation'
import { RichContent } from 'src/components/rich-content'
import { Reasoning, ReasoningTrigger, ReasoningContent } from 'src/components/ai-elements/reasoning'
import { QuestionInput, QuestionData } from 'src/components/ui/question-input'
import { AppLogo } from 'src/components/ui/app-logo'
import { ErrorBoundary } from 'src/components/ui/error-boundary'
import { TransientRetryStep } from 'src/components/ui/transient-retry-step'
import { OperationalError } from 'src/components/ui/operational-error'
import { cn } from 'src/lib/utils'
import { getToolLabel, getToolCallDescription } from 'src/lib/tool-labels'
import { useOnboardingForm } from 'src/features/onboarding/use-onboarding-form'
import type { AppError } from 'src/types/app-error'

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

const GOALS = ['Client acquisition', 'Job hunting', 'Audience building', 'Thought leadership', 'Product promotion', 'Community building']

const GOAL_ICONS: Record<string, any> = {
  'Client acquisition': Briefcase,
  'Job hunting': SearchIcon,
  'Audience building': Users,
  'Thought leadership': Lightbulb,
  'Product promotion': Package,
  'Community building': Heart,
}

function parseResumeCheckpoint(checkpointJson: string): { runId: string; messages: any[] } | null {
  try {
    const checkpoint = JSON.parse(checkpointJson)
    if (
      checkpoint?.version !== 1
      || typeof checkpoint.runId !== 'string'
      || !Array.isArray(checkpoint.messages)
      || checkpoint.messages.some((message: any) => !message || typeof message.role !== 'string' || (typeof message.content !== 'string' && message.content !== null))
    ) return null
    return { runId: checkpoint.runId, messages: checkpoint.messages }
  } catch {
    return null
  }
}

function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function RedditLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.07 2.961-.913a.361.361 0 00.029-.463.33.33 0 00-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.232-.095z" />
    </svg>
  )
}

function BackgroundGlow() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      <div
        className="absolute top-[-15%] left-[25%] w-[800px] h-[800px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-[-10%] right-[12%] w-[600px] h-[600px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.04) 0%, transparent 70%)' }}
      />
    </div>
  )
}

const springTransition = {
  type: "spring" as const,
  stiffness: 450,
  damping: 38
}

const toggleSpring = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30
}

const stepVariants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 350,
      damping: 30,
      staggerChildren: 0.08,
      delayChildren: 0.1
    }
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: { duration: 0.25 }
  }
}

const childVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 350, damping: 30 } }
}

export default function Onboarding({ onComplete }: { onComplete: (sessionId?: number) => void }) {
  const { step, setStep, formData, update } = useOnboardingForm()

  return (
    <div className="flex h-full min-h-screen bg-[#050507]">
      <BackgroundGlow />

      <div className={`flex-1 flex flex-col ${step === 4 ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            variants={stepVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            className={step === 4
              ? "flex-1 flex flex-col h-full relative overflow-hidden"
              : "max-w-[720px] mx-auto px-8 py-20 w-full"
            }
          >
            {step === 0 && <StepWelcome onNext={() => setStep(1)} />}
            {step === 1 && <StepIdentity formData={formData} update={update} onNext={() => setStep(2)} />}
            {step === 2 && <StepApiKey formData={formData} update={update} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
            {step === 3 && <StepPlatforms formData={formData} update={update} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
            {step === 4 && (
              <ErrorBoundary>
                <StepAiOnboarding formData={formData} onComplete={onComplete} onBack={() => setStep(3)} />
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function Input({ label, value, onChange, placeholder, type = 'text', hint, icon: Icon }: any) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold block ml-1">{label}</label>
      <div className="relative flex items-center group">
        <input
          type={type}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "w-full bg-[#040406]/50 hover:bg-[#040406]/80 focus:bg-black/90 border border-white/[0.05] hover:border-white/[0.08] focus:border-blue-500/40 rounded-xl px-4 py-3.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:outline-none transition-all shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.9)] focus:ring-1 focus:ring-blue-500/10",
            Icon ? "pl-11" : "px-4"
          )}
        />
        {Icon && <Icon className="size-4 text-zinc-600 group-focus-within:text-blue-500/50 absolute left-4 transition-colors" />}
      </div>
      {hint && <p className="mt-2 text-xs text-zinc-500/50 ml-1">{hint}</p>}
    </div>
  )
}

function Textarea({ label, value, onChange, placeholder, hint }: any) {
  return (
    <div className="space-y-2">
      <label className="block text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold block ml-1">{label}</label>
      <div className="relative flex items-center">
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-[#040406]/50 hover:bg-[#040406]/80 focus:bg-black/90 border border-white/[0.05] hover:border-white/[0.08] focus:border-blue-500/40 rounded-xl px-4 py-3.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:outline-none transition-all shadow-[inset_0_1.5px_3px_rgba(0,0,0,0.9)] focus:ring-1 focus:ring-blue-500/10 resize-none"
        />
      </div>
      {hint && <p className="mt-2 text-xs text-zinc-500/50 ml-1">{hint}</p>}
    </div>
  )
}

function PrimaryButton({ children, onClick, disabled, className = '' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.96 }}
      className={`group flex items-center justify-center gap-3 rounded-full text-[13px] font-bold disabled:opacity-25 disabled:pointer-events-none
      transition-all duration-300 hover:bg-zinc-100 ${className}`}
    >
      <span>{children}</span>
      <span className="w-7 h-7 rounded-full bg-zinc-900/15 flex items-center justify-center transition-transform duration-300 group-hover:translate-x-0.5">
        <ArrowRight className="size-3.5 stroke-[2.5]" />
      </span>
    </motion.button>
  )
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center py-8">
      <motion.div variants={childVariants} className="mb-8">
        <div className="size-16 rounded-2xl bg-white/[0.02] border border-white/[0.05] shadow-[0_8px_32px_rgba(0,0,0,0.4)] inset-glow flex items-center justify-center">
          <AppLogo 
            showLabel={false} 
            iconClassName="size-9"
          />
        </div>
      </motion.div>
      <motion.h1 variants={childVariants} className="text-[32px] md:text-4xl font-bold text-white tracking-tight leading-none max-w-md">
        Hi, I&rsquo;m Soxial
      </motion.h1>
      <motion.p variants={childVariants} className="text-zinc-400 text-sm leading-relaxed mt-4 max-w-sm font-medium">
        A personal social media manager that studies your voice, audience, and current standing, then builds a growth system you approve before anything goes public.
      </motion.p>

      <motion.div variants={childVariants} className="flex items-center gap-8 mt-10 text-xs text-zinc-500 font-bold">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] shadow-sm hover:text-white transition-colors">
          <XLogo className="size-3.5" />
          <span>X / Twitter</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] shadow-sm hover:text-white transition-colors">
          <RedditLogo className="size-3.5" />
          <span>Reddit</span>
        </div>
      </motion.div>

      <motion.div variants={childVariants} className="mt-12 w-full flex justify-center">
        <PrimaryButton onClick={onNext} className="bg-white text-zinc-950 py-3.5 px-8 shadow-lg">
          Get Started
        </PrimaryButton>
      </motion.div>

      <motion.p variants={childVariants} className="text-[10px] text-zinc-600 font-bold uppercase tracking-[0.16em] mt-8 leading-relaxed max-w-xs">
        One-time setup · Takes about 5 minutes
      </motion.p>
    </div>
  )
}

function StepIdentity({ formData, update, onNext }: any) {
  return (
    <div className="space-y-10">
      <motion.div variants={childVariants}>
        <h1 className="text-3xl font-bold text-white tracking-tight leading-none">Tell me about you</h1>
        <p className="text-zinc-500 mt-2 text-sm font-semibold">Basic info to personalize your strategy.</p>
      </motion.div>

      {/* Sheet panel enclosing inputs */}
      <motion.div variants={childVariants} className="p-1.5 rounded-3xl bg-white/[0.02] border border-white/[0.04] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
        <div className="p-6 md:p-8 rounded-[calc(1.5rem+4px)] bg-[#0c0c10]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name" value={formData.name} onChange={(v: string) => update('name', v)} placeholder="Jane Doe" />
            <Input label="Timezone" value={formData.timezone} onChange={(v: string) => update('timezone', v)} placeholder="UTC+1" />
          </div>
          <Input label="What do you do?" value={formData.niche} onChange={(v: string) => update('niche', v)} placeholder="e.g., Frontend developer specializing in motion UI" />
          <Input label="What makes you different?" value={formData.superpower} onChange={(v: string) => update('superpower', v)} placeholder="e.g., I combine design sense with deep technical knowledge" />

          {/* Primary goal grid */}
          <div className="space-y-3">
            <label className="block text-[10px] uppercase tracking-[0.16em] text-zinc-500 font-bold ml-1">Primary goal</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 relative">
              {GOALS.map(g => {
                const Icon = GOAL_ICONS[g] || Target
                const selected = formData.primary_goal === g
                return (
                  <motion.button
                    key={g}
                    onClick={() => update('primary_goal', g)}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "group relative flex items-center gap-3.5 p-3 rounded-xl border transition-colors text-left",
                      selected 
                        ? "text-white border-transparent" 
                        : "bg-white/[0.01] hover:bg-white/[0.02] border-white/[0.04] hover:border-white/[0.08] text-zinc-400 hover:text-white"
                    )}
                  >
                    {selected && (
                      <motion.span 
                        layoutId="selectedGoalBackdrop"
                        className="absolute inset-0 rounded-xl bg-white/[0.04] border border-white/[0.03] shadow-sm z-0"
                        transition={springTransition}
                      />
                    )}
                    <div className={cn(
                      "w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0 transition-colors z-10",
                      selected ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400' : 'bg-white/[0.02] text-zinc-500 group-hover:text-zinc-300'
                    )}>
                      <Icon strokeWidth={2} className="size-4" />
                    </div>
                    <span className="text-[13px] font-semibold tracking-tight relative z-10">{g}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>

          <Textarea label="Describe your voice" value={formData.voice_description} onChange={(v: string) => update('voice_description', v)} placeholder="e.g., Casual but technical. I explain complex things simply." />
        </div>
      </motion.div>

      <motion.div variants={childVariants} className="pt-2">
        <PrimaryButton onClick={onNext} disabled={!formData.name || !formData.niche} className="w-full bg-white text-zinc-950 py-4 px-6 shadow-md justify-between">
          Continue
        </PrimaryButton>
      </motion.div>
    </div>
  )
}

function StepPlatforms({ formData, update, onBack, onNext }: any) {
  return (
    <div className="space-y-10">
      <motion.div variants={childVariants}>
        <h1 className="text-3xl font-bold text-white tracking-tight leading-none">Connect your platforms</h1>
        <p className="text-zinc-400 mt-2 text-sm font-medium leading-relaxed">
          Soxial securely connects to your active social accounts using session cookies from your default browser — no paid API keys required.
        </p>
      </motion.div>

      {/* Sheet panel enclosing platform discovery info */}
      <motion.div variants={childVariants} className="p-1.5 rounded-3xl bg-white/[0.02] border border-white/[0.04] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
        <div className="p-6 md:p-8 rounded-[calc(1.5rem+4px)] bg-[#0c0c10]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* X Card */}
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04] space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                  <XLogo className="size-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white leading-tight">X / Twitter</h3>
                  <span className="text-[11px] text-zinc-500 font-medium">Auto-detected from browser</span>
                </div>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                Reads your timeline, searches trends, drafts tweets, and assists engagement.
              </p>
            </div>

            {/* Reddit Card */}
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.04] space-y-2.5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#ff4500]/10 border border-[#ff4500]/20 flex items-center justify-center">
                  <RedditLogo className="size-4 text-[#ff4500]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white leading-tight">Reddit</h3>
                  <span className="text-[11px] text-zinc-500 font-medium">Auto-detected from browser</span>
                </div>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                Discovers niche subreddits, monitors discussions, and crafts helpful comments.
              </p>
            </div>
          </div>

          <Input
            label="Target audience"
            value={formData.target_audience}
            onChange={(v: string) => update('target_audience', v)}
            placeholder="e.g., Startup founders, indie developers, AI engineers"
            hint="Describe who you want to reach across your content strategy."
          />

          <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex items-start gap-3">
            <Check className="size-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-zinc-300 leading-relaxed font-medium">
              Make sure you are logged into your preferred accounts in your browser (Chrome, Brave, Edge, Firefox, Arc, etc.). If you only want to use X or Reddit, you can proceed with a single platform.
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div variants={childVariants} className="flex items-center gap-3 pt-1">
        <motion.button
          onClick={onBack}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-bold text-zinc-500 hover:text-white transition-colors"
        >
          Back
        </motion.button>
        <PrimaryButton onClick={onNext} className="flex-1 bg-white text-zinc-950 py-4 px-6 shadow-md justify-between">
          Start AI Onboarding
        </PrimaryButton>
      </motion.div>
    </div>
  )
}

function StepApiKey({ formData, update, onBack, onNext }: any) {
  const [activeTab, setActiveTab] = useState<'google' | 'zhipu'>('google')
  const [primaryGoogleKey, setPrimaryGoogleKey] = useState(formData.gemini_api_key || '')
  const [primaryZhipuKey, setPrimaryZhipuKey] = useState(formData.zai_api_key || '')
  const [googleExtras, setGoogleExtras] = useState<Array<{ id?: number; value: string; masked?: string }>>([])
  const [zhipuExtras, setZhipuExtras] = useState<Array<{ id?: number; value: string; masked?: string }>>([])
  const [codingPlan, setCodingPlan] = useState(formData.zai_coding_plan === 1)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.getApiKeys('google').then((keys: any[]) => {
      setGoogleExtras((keys || []).filter(k => k.name !== 'Primary').map(k => ({ id: k.id, value: '', masked: k.masked })))
    })
    window.api.getApiKeys('zhipu').then((keys: any[]) => {
      setZhipuExtras((keys || []).filter(k => k.name !== 'Primary').map(k => ({ id: k.id, value: '', masked: k.masked })))
    })
  }, [])

  const handleContinue = async () => {
    setSaving(true)
    try {
      await window.api.updateProfile({
        gemini_api_key: primaryGoogleKey.trim(),
        zai_api_key: primaryZhipuKey.trim(),
        zai_coding_plan: codingPlan ? 1 : 0,
      })

      // Persist Google backup keys
      const existingGoogle = ((await window.api.getApiKeys('google')) as any[]).filter(k => k.name !== 'Primary')
      const keptGoogleIds = new Set(googleExtras.filter(e => e.id).map(e => e.id))
      for (const k of existingGoogle) {
        if (!keptGoogleIds.has(k.id)) await window.api.removeApiKey(k.id)
      }
      for (const e of googleExtras) {
        if (!e.id && e.value.trim()) await window.api.addApiKey(e.value.trim(), 'google')
      }

      // Persist Zhipu backup keys
      const existingZhipu = ((await window.api.getApiKeys('zhipu')) as any[]).filter(k => k.name !== 'Primary')
      const keptZhipuIds = new Set(zhipuExtras.filter(e => e.id).map(e => e.id))
      for (const k of existingZhipu) {
        if (!keptZhipuIds.has(k.id)) await window.api.removeApiKey(k.id)
      }
      for (const e of zhipuExtras) {
        if (!e.id && e.value.trim()) await window.api.addApiKey(e.value.trim(), 'zhipu')
      }

      update('gemini_api_key', primaryGoogleKey.trim())
      update('zai_api_key', primaryZhipuKey.trim())
      update('zai_coding_plan', codingPlan ? 1 : 0)
      onNext()
    } catch (err) {
      console.error('Failed to save API keys:', err)
      alert('Failed to save API keys. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const hasAnyKey = primaryGoogleKey.trim() || primaryZhipuKey.trim() || googleExtras.some(e => e.value.trim()) || zhipuExtras.some(e => e.value.trim())

  return (
    <div className="space-y-10">
      <motion.div variants={childVariants}>
        <h1 className="text-3xl font-bold text-white tracking-tight leading-none">Credentials</h1>
        <p className="text-zinc-500 mt-2 text-sm font-semibold">
          Configure Google AI Studio or Z.AI (Zhipu) API access credentials to authenticate agent actions.
        </p>
      </motion.div>

      {/* Sheet panel enclosing inputs */}
      <motion.div variants={childVariants} className="p-1.5 rounded-3xl bg-white/[0.02] border border-white/[0.04] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
        <div className="p-6 md:p-8 rounded-[calc(1.5rem+4px)] bg-[#0c0c10]/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] space-y-6">
          {/* Sliding Tab Selector */}
          <div className="p-0.5 rounded-xl bg-white/[0.02] border border-white/[0.04] flex max-w-[240px] relative">
            <button
              onClick={() => setActiveTab('google')}
              className={cn(
                "flex-1 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-colors duration-300 relative z-10",
                activeTab === 'google' ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {activeTab === 'google' && (
                <motion.span 
                  layoutId="activeTabBackdropOnboarding"
                  className="absolute inset-0 rounded-lg bg-white/[0.04] border border-white/[0.03] shadow-sm"
                  transition={springTransition}
                />
              )}
              Google
            </button>
            <button
              onClick={() => setActiveTab('zhipu')}
              className={cn(
                "flex-1 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-lg transition-colors duration-300 relative z-10",
                activeTab === 'zhipu' ? "text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {activeTab === 'zhipu' && (
                <motion.span 
                  layoutId="activeTabBackdropOnboarding"
                  className="absolute inset-0 rounded-lg bg-white/[0.04] border border-white/[0.03] shadow-sm"
                  transition={springTransition}
                />
              )}
              Z.AI
            </button>
          </div>

          <div className="min-h-[220px]">
            <AnimatePresence mode="wait">
              {activeTab === 'google' ? (
                <motion.div 
                  key="google"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  <Input
                    label="Primary Google API key"
                    value={primaryGoogleKey}
                    onChange={(v: string) => setPrimaryGoogleKey(v.trim())}
                    placeholder="AIza..."
                    type="password"
                    hint="Create one at aistudio.google.com"
                    icon={KeyRound}
                  />
                  {googleExtras.map((k, i) => (
                    <div key={k.id ?? `new-g-${i}`} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Input
                          label="Backup API key"
                          value={k.value}
                          onChange={(v: string) => setGoogleExtras(prev => prev.map((item, idx) => idx === i ? { ...item, value: v } : item))}
                          placeholder="AIza..."
                          type="password"
                          icon={KeyRound}
                        />
                      </div>
                      <button
                        onClick={() => setGoogleExtras(prev => prev.filter((_, idx) => idx !== i))}
                        aria-label="Remove key"
                        className="flex items-center justify-center w-12 h-[51px] rounded-xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.04] hover:border-red-500/20 hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors shrink-0 shadow-sm"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setGoogleExtras(prev => [...prev, { value: '' }])}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors font-semibold ml-1 mt-1"
                  >
                    <Plus className="size-3.5" /> Add backup Google key
                  </button>
                </motion.div>
              ) : (
                <motion.div 
                  key="zhipu"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <Input
                    label="Primary Z.AI API key"
                    value={primaryZhipuKey}
                    onChange={(v: string) => setPrimaryZhipuKey(v.trim())}
                    placeholder="Z.AI api key..."
                    type="password"
                    hint="Create one on bigmodel.cn or docs.z.ai"
                    icon={KeyRound}
                  />

                  {/* Coding Plan Mode */}
                  <div className="flex items-center justify-between p-5 rounded-2xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.04] shadow-sm transition-colors">
                    <div>
                      <div className="text-xs font-semibold text-white tracking-tight">Coding Plan Mode</div>
                      <div className="text-[10px] text-zinc-500 font-medium mt-0.5">Toggle to use dedicated coding endpoint: https://api.z.ai/api/coding/paas/v4</div>
                    </div>
                    {/* Apple style physical switch */}
                    <button
                      onClick={() => setCodingPlan(!codingPlan)}
                      className={cn(
                        "w-11 h-6 rounded-full relative p-0.5 transition-colors duration-300 flex items-center border shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]",
                        codingPlan 
                          ? "bg-blue-600 border-blue-500/10" 
                          : "bg-[#0c0c0f] border-white/[0.04]"
                      )}
                    >
                      <motion.span 
                        layout
                        transition={toggleSpring}
                        className="size-5 rounded-full bg-white shadow-md block" 
                        style={{ marginLeft: codingPlan ? 'auto' : '0px' }}
                      />
                    </button>
                  </div>

                  {zhipuExtras.map((k, i) => (
                    <div key={k.id ?? `new-z-${i}`} className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Input
                          label="Backup API key"
                          value={k.value}
                          onChange={(v: string) => setZhipuExtras(prev => prev.map((item, idx) => idx === i ? { ...item, value: v } : item))}
                          placeholder="Z.AI backup api key..."
                          type="password"
                          icon={KeyRound}
                        />
                      </div>
                      <button
                        onClick={() => setZhipuExtras(prev => prev.filter((_, idx) => idx !== i))}
                        aria-label="Remove key"
                        className="flex items-center justify-center w-12 h-[51px] rounded-xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.04] hover:border-red-500/20 hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors shrink-0 shadow-sm"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setZhipuExtras(prev => [...prev, { value: '' }])}
                    className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors font-semibold ml-1 mt-1"
                  >
                    <Plus className="size-3.5" /> Add backup Z.AI key
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      <motion.div variants={childVariants} className="flex items-center gap-3 pt-1">
        <motion.button
          onClick={onBack}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-6 py-3.5 rounded-full text-sm font-bold text-zinc-500 hover:text-white transition-colors"
        >
          Back
        </motion.button>
        <PrimaryButton onClick={handleContinue} disabled={!hasAnyKey || saving} className="flex-1 bg-white text-zinc-950 py-4 px-6 shadow-md justify-between">
          {saving ? 'Saving...' : 'Continue'}
        </PrimaryButton>
      </motion.div>
    </div>
  )
}

type StepItem = {
  type: 'reasoning'
  text: string
} | {
  type: 'tool'
  id: number
  name: string
  args: any
  result?: any
  status: 'calling' | 'complete'
} | {
  type: 'text'
  text: string
} | {
  type: 'question'
  id: string
  text: string
  qtype: 'single' | 'multi' | 'text'
  options?: string[]
  answer?: string | string[]
  status: 'asking' | 'answered'
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  steps?: StepItem[]
}

const toolIcons: Record<string, any> = {
  connect_twitter: Sparkles, connect_reddit: Sparkles,
  twitter_search: SearchIcon, twitter_user: AtSign, twitter_user_posts: List,
  twitter_status: BadgeCheck, twitter_whoami: BadgeCheck,
  twitter_followers: Users, twitter_following: Users, twitter_likes: Heart,
  twitter_article: FileText, twitter_list: List, twitter_delete: RotateCcw,
  twitter_tweet: Eye, twitter_post: Send, twitter_reply: CornerUpLeft, twitter_quote: Send,
  twitter_feed: Newspaper, twitter_like: Heart, twitter_retweet: Repeat2, twitter_bookmark: Bookmark, twitter_bookmarks: Bookmark,
  twitter_follow: UserPlus, twitter_replies: CornerUpLeft,
  reddit_search: SearchIcon, reddit_sub: Layers, reddit_sub_info: Info, reddit_read: BookOpen,
  reddit_user: AtSign, reddit_user_posts: List, reddit_user_comments: MessageCircle,
  reddit_login: BadgeCheck, reddit_whoami: BadgeCheck, reddit_feed: Newspaper, reddit_popular: Flame,
  reddit_all: GlobeIcon, reddit_saved: Bookmark, reddit_upvoted: ThumbsUp,
  reddit_comment: Send, reddit_upvote: ThumbsUp, reddit_save: Bookmark, reddit_subscribe: UserPlus,
  read_profile: AtSign, read_hooks: Lightbulb, read_voice_rules: MessageCircle,
  read_pillars: Layers, read_algorithm: Gauge, read_targets: Crosshair,
  read_replies: CornerUpLeft, read_social_content: Database, read_memory: Database,
  save_hook: Lightbulb, save_voice_rule: ShieldCheck, save_pillar: Save,
  save_algorithm_rule: Gauge, save_target: Crosshair, save_reply: CornerUpLeft,
  save_memory: Database, update_soxial_profile: SquarePen, reset_strategy_defaults: RotateCcw,
  delete_voice_rules: Trash2, delete_hooks: Trash2, delete_pillars: Trash2,
  delete_targets: Trash2, delete_algorithm_rules: Trash2, save_milestone: TrendingUp,
  generate_image: ImageIcon, schedule_post: CalendarClock, get_scheduled_posts: CalendarClock,
}
function getToolIcon(name: string) {
  return toolIcons[name] || GlobeIcon
}

function StepAiOnboarding({ formData, onComplete, onBack }: { formData: any; onComplete: (sessionId?: number) => void; onBack: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [steps, setSteps] = useState<StepItem[]>([])
  const [streamText, setStreamText] = useState('')
  const [streaming, setStreaming] = useState(true)
  const [pendingQuestions, setPendingQuestions] = useState<QuestionData[] | null>(null)
  const [pendingBatchId, setPendingBatchId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appError, setAppError] = useState<AppError | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [savedConversationState, setSavedConversationState] = useState<any[] | null>(null)
  const [pendingAuth, setPendingAuth] = useState<{
    id: string
    twitter: { needed: boolean; ok: boolean; username?: string; name?: string }
    reddit: { needed: boolean; ok: boolean; username?: string; name?: string }
    canSkipTwitter?: boolean
    canSkipReddit?: boolean
    canProceedPartial?: boolean
  } | null>(null)
  const [transientRetry, setTransientRetry] = useState<{ attempt: number; maxAttempts: number; backoffMs: number; model: string } | null>(null)
  const mountedRef = useRef(true)

  const stepsRef = useRef<StepItem[]>([])
  const stepCounter = useRef(0)
  const streamTextRef = useRef('')
  const messagesRef = useRef<ChatMessage[]>([])
  const [inputEl, setInputEl] = useState<HTMLDivElement | null>(null)
  const [inputAreaHeight, setInputAreaHeight] = useState(0)
  const [scrollbarW, setScrollbarW] = useState(6)

  useEffect(() => {
    if (!inputEl) return
    const update = () => setInputAreaHeight(inputEl.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(inputEl)
    return () => ro.disconnect()
  }, [inputEl])

  useEffect(() => {
    const sb = document.createElement('div')
    sb.style.cssText = 'width:50px;height:50px;overflow:scroll;position:absolute;opacity:0;'
    document.body.appendChild(sb)
    setScrollbarW(sb.offsetWidth - sb.clientWidth || 6)
    document.body.removeChild(sb)
  }, [])

  const commitStreamingMessage = () => {
    const text = streamTextRef.current.trim()
    const completedSteps = [...stepsRef.current]
    if (text || completedSteps.length > 0) {
      setMessages(prev => [...prev, {
        role: 'assistant' as const,
        content: text,
        steps: completedSteps.length > 0 ? completedSteps : undefined,
      }])
    }
    streamTextRef.current = ''
    setStreamText('')
    stepsRef.current = []
    setSteps([])
  }

  const handleAllAnswers = (answers: { id: string; answer: string | string[] }[]) => {
    const display = answers.map(a => {
      const q = pendingQuestions?.find(qq => qq.id === a.id)
      const ansText = Array.isArray(a.answer) ? a.answer.join(', ') : a.answer
      return `**Q:** ${q?.text || a.id}\n**A:** ${ansText}`
    }).join('\n\n')
    const nextMessages = [...messagesRef.current, { role: 'user' as const, content: display }]
    setMessages(nextMessages)
    if (runId) {
      window.api.checkpointOnboarding(runId, 'interview', nextMessages, {
        batchId: pendingBatchId || 'batch',
        questionIds: answers.map(answer => answer.id),
      }).catch(() => {})
    }
    window.api.sendOnboardingAnswer(pendingBatchId || 'batch', answers)
    setPendingQuestions(null)
    setPendingBatchId(null)
  }

  const startOnboarding = (resume?: { runId: string; messages: any[] }) => {
    setMessages(resume?.messages || [])
    stepsRef.current = []
    stepCounter.current = 0
    streamTextRef.current = ''
    setSteps([]) // Clear the initial loading state
    setStreamText('')
    setStreaming(true)
    setPendingQuestions(null)
    setError(null)
    setAppError(null)
    setComplete(false)
    setSavedConversationState(resume?.messages || null)
    setTransientRetry(null)

    window.api.runOnboarding(formData, resume?.messages, resume?.runId)
      .then(result => {
        if (!mountedRef.current) return
        setStreaming(false)
        if (result?.runId) setRunId(result.runId)
         if (result?.success) {
          commitStreamingMessage()
          setComplete(true)
        } else if (result?.aborted) {
          // user backed out of the auth gate; parent already navigated away
        } else {
          setAppError(result?.appError || null)
          setError(result?.error || 'Failed to complete onboarding')
        }
      })
      .catch(err => {
        if (!mountedRef.current) return
        setStreaming(false)
        setError(err.message || 'An error occurred during onboarding')
        setAppError(null)
        // Save conversation state for retry (use the ref so we get the latest, not the stale closure)
        setSavedConversationState(messagesRef.current.map(m => ({
          role: m.role,
          content: m.content,
          steps: m.steps
        })))
      })
  }

  const retryOnboarding = () => {
    // Preserve current state and retry
    setError(null)
    setAppError(null)
    setStreaming(true)
    
    // Use saved conversation state if available, otherwise use current messages
    const messagesToContinue = savedConversationState || messages.map(m => ({
      role: m.role,
      content: m.content,
      steps: m.steps
    }))
    
    // Continue with current context - pass existing messages
    window.api.runOnboarding(formData, messagesToContinue, runId || undefined)
      .then(result => {
        if (!mountedRef.current) return
        setStreaming(false)
        if (result?.runId) setRunId(result.runId)
        if (result?.success) {
          commitStreamingMessage()
          setComplete(true)
        } else if (result?.aborted) {
          // no-op
        } else {
          setAppError(result?.appError || null)
          setError(result?.error || 'Failed to complete onboarding')
        }
      })
      .catch(err => {
        if (!mountedRef.current) return
        setStreaming(false)
        setError(err.message || 'An error occurred during onboarding')
        setAppError(null)
        // Save conversation state for retry (use the ref so we get the latest, not the stale closure)
        setSavedConversationState(messagesRef.current.map(m => ({
          role: m.role,
          content: m.content,
          steps: m.steps
        })))
      })
  }

  useEffect(() => {
    // Reset on every mount; StrictMode unmounts/remounts effects in dev, and the
    // cleanup below would otherwise leave this false and silence the run's .then().
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    // Show initial loading state immediately
    setSteps([{ type: 'reasoning', text: 'Initializing onboarding...' }])

    const cleanup = [
      window.api.onOnboardingChunk((text) => {
    if (text === 'PHASE:gather' || text === 'PHASE:interview') return
    setTransientRetry(null)   // stream resumed → clear high-demand banner
    streamTextRef.current += text
    setStreamText(streamTextRef.current)
      }),

      window.api.onOnboardingReasoning((text) => {
      const s = stepsRef.current
      const last = s[s.length - 1]
      if (last && last.type === 'reasoning') {
        last.text += text
      } else {
        s.push({ type: 'reasoning', text })
      }
      setSteps([...s])
      }),

      window.api.onOnboardingToolCall((data) => {
      if (data.name === 'ask_user_questions') return
      const tool: StepItem = { type: 'tool', id: stepCounter.current++, name: data.name, args: data.args, status: 'calling' }
      stepsRef.current = [...stepsRef.current, tool]
      setSteps(stepsRef.current)
      }),

      window.api.onOnboardingToolResult((data) => {
      if (data.name === 'ask_user_questions') return
      let found = false
      stepsRef.current = stepsRef.current.map(s => {
        if (!found && s.type === 'tool' && s.name === data.name && s.status === 'calling') {
          found = true
          return { ...s, status: 'complete', result: data.result }
        }
        return s
      })
      setSteps([...stepsRef.current])
      }),

      window.api.onOnboardingQuestion((payload: { batchId: string; questions: QuestionData[] }) => {
      commitStreamingMessage()
      setPendingBatchId(payload.batchId)
      setPendingQuestions(payload.questions)
      }),

      window.api.onOnboardingAuthRequired((payload) => {
      setPendingAuth(payload)
      }),

      window.api.onOnboardingTransientRetry((info) => {
      setTransientRetry(info)
      }),
    ]

    // Start onboarding after a brief delay to allow UI to render
    const timer = setTimeout(() => {
      window.api.getOnboardingResume().then(resume => {
        if (!resume || !mountedRef.current) {
          startOnboarding()
          return
        }
        const checkpoint = parseResumeCheckpoint(resume.checkpointJson)
        if (checkpoint && checkpoint.messages.length > 0) {
          setRunId(checkpoint.runId)
          startOnboarding(checkpoint)
        } else {
          startOnboarding()
        }
      }).catch(() => startOnboarding())
    }, 300)

    return () => {
      clearTimeout(timer)
      cleanup.forEach(remove => remove())
    }
  }, [])

  const hasActivity = steps.length > 0
  const allToolsDone = steps.length > 0 && steps.every(s => s.type === 'tool' ? s.status === 'complete' : true)
  const hasNextAction = complete && messages.some(m => m.role === 'assistant' && m.content.includes('"nxan"'))

  const renderStep = (step: StepItem, key: number, isStreaming = false) => {
    const description =
      step.type === 'tool'
        ? getToolCallDescription(step.name, step.status, step.args)
        : undefined

    if (step.type === 'reasoning') {
      return (
        <Reasoning key={key} isStreaming={isStreaming} defaultOpen={true}>
          <ReasoningTrigger />
          <ReasoningContent>{step.text}</ReasoningContent>
        </Reasoning>
      )
    }

    if (step.type === 'tool') {
      return (
        <ChainOfThoughtStep
          key={key}
          icon={getToolIcon(step.name)}
          label={getToolLabel(step.name)}
          description={description}
          status={step.status === 'calling' ? 'active' : 'complete'}
        />
      )
    }

    if (step.type === 'text') {
      return (
        <RichContent key={key} isAnimating={isStreaming}>
          {step.text}
        </RichContent>
      )
    }

    return (
      <ChainOfThoughtStep
        key={key}
        icon={MessageSquare}
        label={step.status === 'answered'
          ? `${step.text} → ${Array.isArray(step.answer) ? step.answer.join(', ') : step.answer}`
          : step.text}
        status={step.status === 'answered' ? 'complete' : 'active'}
      />
    )
  }

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="max-w-3xl mx-auto w-full pt-16">
          {messages.map((msg, i) => (
            <Message key={i} from={msg.role}>
              <MessageContent>
                {msg.steps?.length ? (
                  <div className="flex flex-col gap-1.5 mb-2">
                    {msg.steps.map((step, si) => {
                      const hide =
                        (step.type === 'reasoning' || step.type === 'tool') &&
                        msg.steps!.some((s, idx) => idx > si && s.type === 'text')
                      if (hide) return null
                      return renderStep(step, si)
                    })}
                  </div>
                ) : null}
                {(!msg.steps || !msg.steps.some((s) => s.type === 'text')) && msg.content && (
                  <RichContent>{msg.content}</RichContent>
                )}
              </MessageContent>
            </Message>
          ))}

          {streaming && !pendingQuestions && !pendingAuth && (
            <Message from="assistant">
              <MessageContent>
                {(hasActivity || transientRetry) ? (
                  <div className="flex flex-col gap-1.5 mb-2">
                    {steps.map((step, si) => {
                      const hide =
                        (step.type === 'reasoning' || step.type === 'tool') &&
                        steps.some((s, idx) => idx > si && s.type === 'text')
                      if (hide) return null
                      return renderStep(step, si, si === steps.length - 1 && streaming)
                    })}
                    {transientRetry && (
                      <TransientRetryStep
                        key={transientRetry.attempt}
                        attempt={transientRetry.attempt}
                        maxAttempts={transientRetry.maxAttempts}
                        backoffMs={transientRetry.backoffMs}
                        model={transientRetry.model}
                        onExpire={() => setTransientRetry(null)}
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

                {streamText && <RichContent isAnimating>{streamText}</RichContent>}

                {!hasActivity && !streamText && !transientRetry && (
                  <div className="flex items-center gap-1 py-2">
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </MessageContent>
            </Message>
          )}

          <div style={{ height: inputAreaHeight + 48 }} />
        </ConversationContent>
        {messages.length > 0 && <ConversationScrollButton bottomOffset={inputAreaHeight + 56} />}
      </Conversation>

      <div
        className="absolute bottom-0 left-0 px-4 pb-6 bg-gradient-to-t from-[#050507] via-[#050507]/95 to-transparent pointer-events-none"
        style={{
          right: scrollbarW,
          paddingTop: Math.max(32, Math.round(inputAreaHeight * 0.25) || 48),
        }}
      >
        <div ref={setInputEl} className="max-w-3xl mx-auto flex justify-center">
          {pendingAuth ? (
            <div className="w-full max-w-lg rounded-2xl px-6 py-5 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-500 bg-[#0c0c10]/70 border border-white/[0.06] shadow-2xl backdrop-blur-xl">
              {(() => {
                const twitterOk = pendingAuth.twitter?.ok
                const redditOk = pendingAuth.reddit?.ok

                return (
                  <>
                    <div className="text-sm text-white/90 leading-relaxed font-semibold">
                      {twitterOk && !redditOk ? (
                        <span>Connected to X as <span className="text-blue-400">@{pendingAuth.twitter.username}</span>. Reddit session was not found in browser.</span>
                      ) : !twitterOk && redditOk ? (
                        <span>Connected to Reddit as <span className="text-orange-400">u/{pendingAuth.reddit.username}</span>. X session was not found in browser.</span>
                      ) : (
                        <span>No active browser sessions found. Please log into x.com and/or reddit.com in your default browser, then confirm below.</span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {twitterOk ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 font-semibold shadow-sm">
                          <XLogo className="size-3" /> @{pendingAuth.twitter.username} connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 font-semibold shadow-sm">
                          <ShieldAlert className="size-3" /> X not connected
                        </span>
                      )}

                      {redditOk ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 font-semibold shadow-sm">
                          <RedditLogo className="size-3 text-[#ff4500]" /> u/{pendingAuth.reddit.username} connected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 font-semibold shadow-sm">
                          <ShieldAlert className="size-3" /> Reddit not connected
                        </span>
                      )}
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-white/[0.04]">
                      <button
                        onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'abort'); setPendingAuth(null); onBack() }}
                        className="px-4 py-2 rounded-full text-xs font-bold text-zinc-500 hover:text-white transition-colors"
                      >
                        Back
                      </button>

                      <div className="flex flex-wrap items-center gap-2.5">
                        {pendingAuth.canSkipReddit && (
                          <button
                            onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'skip_reddit'); setPendingAuth(null) }}
                            className="px-4 py-2 rounded-full text-xs font-bold text-zinc-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors"
                          >
                            Continue with X only
                          </button>
                        )}
                        {pendingAuth.canSkipTwitter && (
                          <button
                            onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'skip_twitter'); setPendingAuth(null) }}
                            className="px-4 py-2 rounded-full text-xs font-bold text-zinc-300 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors"
                          >
                            Continue with Reddit only
                          </button>
                        )}
                        <button
                          onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'retry'); setPendingAuth(null) }}
                          className="group flex items-center gap-2 px-5 py-2 rounded-full bg-white text-zinc-950 text-xs font-bold transition-transform active:scale-[0.96] hover:bg-zinc-100 shadow-lg"
                        >
                          Logged in
                          <span className="w-5 h-5 rounded-full bg-zinc-900/15 flex items-center justify-center">
                            <ArrowRight className="size-3 stroke-[2.5]" />
                          </span>
                        </button>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          ) : error ? (
            appError ? (
              <OperationalError error={appError} onRetry={appError.retryable ? retryOnboarding : undefined} />
            ) : (
              <div className="flex items-center justify-between gap-3 w-full max-w-md rounded-2xl px-5 py-3 pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-500 bg-red-500/5 border border-red-500/10 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-2.5 text-red-400 text-xs min-w-0 font-semibold">
                  <ShieldAlert className="size-4 shrink-0 stroke-[2]" />
                  <span className="truncate">{error}</span>
                </div>
                <button onClick={retryOnboarding} className="group flex items-center gap-2 px-4 py-2 rounded-full bg-white text-zinc-950 text-xs font-bold hover:bg-zinc-100 transition-transform active:scale-[0.96] shrink-0 shadow-lg">
                  <RefreshCw className="size-3 stroke-[2.5]" /> Retry
                </button>
              </div>
            )
          ) : complete ? (
            hasNextAction ? (
              <div className="flex items-center gap-3 pointer-events-auto animate-in fade-in zoom-in-95 duration-500">
                <button
                  onClick={() => onComplete()}
                  className="flex items-center gap-2 px-5 py-3 rounded-full text-xs font-bold text-zinc-500 hover:text-white transition-colors"
                >
                  Skip to Dashboard
                </button>
                <button
                  onClick={async () => {
                    try {
                      const stripped = messages
                        .filter(m => m.content.trim())
                        .map(m => ({ role: m.role, content: m.content }))
                      const sessionId = await window.api.saveOnboardingConversation(stripped)
                      onComplete(sessionId)
                    } catch {
                      onComplete()
                    }
                  }}
                  className="group flex items-center gap-3 px-5 py-3 rounded-full bg-white text-zinc-950 text-xs font-bold transition-transform active:scale-[0.96] hover:bg-zinc-100 shadow-lg"
                >
                  <span>Review Next Action</span>
                  <span className="w-5 h-5 rounded-full bg-zinc-900/15 flex items-center justify-center transition-transform group-hover:translate-x-0.5">
                    <ArrowRight className="size-3 stroke-[2.5]" />
                  </span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => onComplete()}
                className="group flex items-center gap-3 px-5 py-3 rounded-full bg-white text-zinc-950 text-xs font-bold pointer-events-auto animate-in fade-in zoom-in-95 duration-500 transition-transform active:scale-[0.96] hover:bg-zinc-100 shadow-lg"
              >
                <span>Continue to Dashboard</span>
                <span className="w-5 h-5 rounded-full bg-zinc-900/15 flex items-center justify-center transition-transform group-hover:translate-x-0.5">
                  <ArrowRight className="size-3 stroke-[2.5]" />
                </span>
              </button>
            )
          ) : pendingQuestions ? (
            <QuestionInput questions={pendingQuestions} onSubmit={handleAllAnswers} />
          ) : null}
        </div>
      </div>
    </>
  )
}
