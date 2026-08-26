"use client";

import { useState, useEffect, useMemo, useRef } from 'react'
import { Check, ArrowRight, ArrowLeft, ChevronDown, RefreshCw, ShieldAlert, Search as SearchIcon, Heart, Lightbulb, Briefcase, Users, Package, Trash2, Plus, KeyRound } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { Message, MessageContent } from 'src/components/ai-elements/message'
import {
  Conversation, ConversationContent, ConversationScrollButton
} from 'src/components/ai-elements/conversation'
import { RichContent } from 'src/components/rich-content'
import { MessageSegments } from '../chat/message-segments'
import { QuestionInput, QuestionData } from 'src/components/ui/question-input'
import { StrategyReview } from './StrategyReview'
import type { OnboardingEvent } from 'src/types/onboarding-events'
import { createOnboardingEventGate, OnboardingEventGate } from 'src/types/onboarding-events'
import {
  ACCOUNT_ANALYSIS_DISCLOSURE,
  IdentityStage,
  canAdvanceIdentityStage,
  getIdentityStageActionLabel,
  getOptionalStepActionLabel,
  parseResumeCheckpoint,
} from './onboarding-steps'
import { AppLogo } from 'src/components/ui/app-logo'
import { MountainVideo } from 'src/components/ui/mountain-video'
import { ErrorBoundary } from 'src/components/ui/error-boundary'
import { TransientRetryStep } from 'src/components/ui/transient-retry-step'
import { OperationalError } from 'src/components/ui/operational-error'
import { Button } from 'src/components/ui/button'
import { GradientButton } from 'src/components/ui/gradient-button'
import { Autocomplete, type AutocompleteItemData } from 'src/components/ui/autocomplete'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from 'src/components/ui/dropdown'
import { cn } from 'src/lib/utils'
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
  const [identityStartStage, setIdentityStartStage] = useState<'name' | 'goal'>('name')

  const startIdentity = (stage: 'name' | 'goal') => {
    setIdentityStartStage(stage)
    setStep(1)
  }

  return (
    <div className={`flex h-full bg-[#050507] ${step === 4 ? '' : 'min-h-screen'}`}>
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
              : step === 0
              ? "w-full flex-1 flex flex-col"
              : "max-w-[720px] mx-auto px-8 py-20 w-full"
            }
          >
            {step === 0 && <StepWelcome onNext={() => startIdentity('name')} />}
            {step === 1 && <StepIdentity initialStage={identityStartStage} formData={formData} update={update} onBack={() => setStep(0)} onNext={() => setStep(2)} />}
            {step === 2 && <StepApiKey formData={formData} update={update} onBack={() => startIdentity('goal')} onNext={() => setStep(3)} />}
            {step === 3 && <StepAccountAnalysisInfo formData={formData} update={update} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
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

function Input({ label, value, onChange, placeholder, type = 'text', hint, icon: Icon, name, autoComplete, ariaLabel, autoFocus, onKeyDown }: any) {
  return (
    <div className={cn(label || hint ? 'space-y-2' : '')}>
      {label && <label className="ml-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</label>}
      <div className="group relative flex h-11 items-center rounded-xl border border-input/60 bg-card px-4 shadow-sm transition-[background-color,border-color,box-shadow,border-radius] hover:border-input focus-within:rounded-[1.25rem] focus-within:border-input">
        <input
          type={type}
          name={name}
          autoComplete={autoComplete}
          aria-label={ariaLabel}
          autoFocus={autoFocus}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={cn(
            "h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground",
            Icon ? "pl-8" : ""
          )}
        />
        {Icon && <Icon className="absolute left-3 size-4 text-zinc-600 transition-colors group-focus-within:text-zinc-400" />}
      </div>
      {hint && <p className="ml-1 mt-2 text-xs text-zinc-500">{hint}</p>}
    </div>
  )
}

function Textarea({ label, value, onChange, placeholder, hint }: any) {
  return (
    <div className="space-y-2">
      <label className="ml-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{label}</label>
      <div className="relative flex items-center rounded-2xl border border-white/[0.06] bg-[#0c0c10]/70 px-3 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.18)] transition-[background-color,border-color,box-shadow] hover:border-white/[0.1] focus-within:border-white/[0.14] focus-within:bg-[#0e0e13] focus-within:ring-1 focus-within:ring-white/[0.06]">
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-6 text-white outline-none placeholder:text-zinc-600"
        />
      </div>
      {hint && <p className="ml-1 mt-2 text-xs text-zinc-500">{hint}</p>}
    </div>
  )
}

function PrimaryButton({ children, onClick, disabled, className = '' }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; className?: string }) {
  return (
    <Button
      variant="default"
      size="lg"
      shape="round"
      scaleOnPress
      depthShadow
      onClick={onClick}
      disabled={disabled}
      className={cn("w-full justify-between", className)}
    >
      {children}
    </Button>
  )
}

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="relative flex min-h-[100dvh] flex-1 items-center justify-center overflow-hidden px-6 py-12 sm:px-8">
      <MountainVideo className="pointer-events-none absolute inset-0 z-0 opacity-90" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[#050507]/15" />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(5,5,7,0.12)_72%,rgba(5,5,7,0.35)_100%)]" />
      <motion.div variants={childVariants} className="relative z-10 w-full max-w-[720px]">
          <motion.div variants={childVariants} className="flex justify-center">
            <div className="flex items-center justify-center gap-4">
              <AppLogo
                showLabel={false}
                iconClassName="size-14 md:size-16 rounded-2xl object-contain drop-shadow-[0_10px_24px_rgba(59,130,246,0.2)]"
              />
              <span className="text-2xl font-semibold tracking-tight text-white md:text-3xl">Soxial</span>
            </div>
          </motion.div>

          <motion.div variants={childVariants} className="mt-10 text-center">
            <h1 className="text-[32px] font-semibold leading-[1.08] tracking-[-0.04em] text-white text-balance sm:text-4xl">
              Set up your social workspace.
            </h1>
            <p className="mx-auto mt-4 max-w-none text-sm leading-6 text-white text-pretty mix-blend-difference sm:whitespace-nowrap">
              Your personal social media manager for thoughtful posts, replies, and growth.
            </p>
          </motion.div>

          <motion.div variants={childVariants} className="mt-2 flex flex-col items-center gap-3 py-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Works with</span>
            <div className="flex items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-xs font-medium text-zinc-300">
                <XLogo className="size-3.5 text-white" /> Twitter / X
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-xs font-medium text-zinc-300">
                <RedditLogo className="size-3.5 text-[#ff4500]" /> Reddit
              </span>
            </div>
          </motion.div>

          <motion.div variants={childVariants} className="mt-9 flex justify-center">
            <GradientButton onClick={onNext}>Begin setup</GradientButton>
          </motion.div>
      </motion.div>
    </div>
  )
}

function StepIdentity({ initialStage = 'name', formData, update, onBack, onNext }: any) {
  const [identityStage, setIdentityStage] = useState<IdentityStage>(initialStage)

  const timezoneItems = useMemo<AutocompleteItemData[]>(() => {
    const fallback = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney']
    const timezones = typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : fallback
    return timezones.map((timezone) => {
      const city = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone
      return { value: timezone, label: city }
    })
  }, [])

  const stageTitle = {
    name: 'Tell me about you',
    timezone: 'What time-zone are you in',
    niche: 'What do you do',
    superpower: 'What makes you different',
    goal: "What's your primary goal?",
  }[identityStage]

  const stageValue = {
    name: formData.name,
    timezone: formData.timezone,
    niche: formData.niche,
    superpower: formData.superpower,
    goal: formData.primary_goal,
  }[identityStage]

  const canAdvance = canAdvanceIdentityStage(identityStage, stageValue)
  const advanceLabel = getIdentityStageActionLabel(identityStage, stageValue)

  const advanceStage = () => {
    if (!canAdvance) return
    if (identityStage === 'name') setIdentityStage('timezone')
    else if (identityStage === 'timezone') setIdentityStage('niche')
    else if (identityStage === 'niche') setIdentityStage('superpower')
    else if (identityStage === 'superpower') setIdentityStage('goal')
    else onNext()
  }

  const goBack = () => {
    if (identityStage === 'timezone') setIdentityStage('name')
    else if (identityStage === 'niche') setIdentityStage('timezone')
    else if (identityStage === 'superpower') setIdentityStage('niche')
    else if (identityStage === 'goal') setIdentityStage('superpower')
  }

  const handleTextKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      advanceStage()
    }
  }

  return (
    <div className="space-y-10">
      <motion.div variants={childVariants} className="text-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.h1
            key={identityStage}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="text-3xl font-bold leading-none tracking-tight text-white"
          >
            {stageTitle}
          </motion.h1>
        </AnimatePresence>
      </motion.div>

      <div className="mx-auto w-full max-w-[480px]">
        <AnimatePresence mode="wait" initial={false}>
          {identityStage === 'name' && (
            <motion.div key="name" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12, scale: 0.985 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="space-y-4">
              <Input label={undefined} name="name" autoComplete="name" ariaLabel="Your name" autoFocus value={formData.name} onChange={(v: string) => update('name', v)} onKeyDown={handleTextKeyDown} placeholder="Your name" />
            </motion.div>
          )}

          {identityStage === 'timezone' && (
            <motion.div key="timezone" initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.985 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="space-y-4">
              <Autocomplete items={timezoneItems} value={formData.timezone} onValueChange={(timezone) => update('timezone', timezone)} placeholder="type your city name" aria-label="type your city name" autoFocus={!formData.timezone} virtualize />
            </motion.div>
          )}

          {identityStage === 'niche' && (
            <motion.div key="niche" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12, scale: 0.985 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="space-y-4">
              <Input label={undefined} name="niche" ariaLabel="What do you do" autoFocus value={formData.niche} onChange={(v: string) => update('niche', v)} onKeyDown={handleTextKeyDown} placeholder="e.g. I build developer tools" />
            </motion.div>
          )}

          {identityStage === 'superpower' && (
            <motion.div key="superpower" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12, scale: 0.985 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="space-y-4">
              <Input label={undefined} name="superpower" ariaLabel="What makes you different" autoFocus value={formData.superpower} onChange={(v: string) => update('superpower', v)} onKeyDown={handleTextKeyDown} placeholder="e.g. I make complex ideas feel simple" />
            </motion.div>
          )}

          {identityStage === 'goal' && (
            <motion.div key="goal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12, scale: 0.985 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="group relative flex h-11 w-full items-center rounded-xl border border-input/60 bg-card px-4 text-sm text-foreground shadow-sm outline-none transition-[background-color,border-color,box-shadow,border-radius] hover:border-input focus-visible:border-input data-[state=open]:rounded-[1.25rem]" aria-label="Choose your primary goal">
                    <span className={cn('w-full text-center', !formData.primary_goal && 'text-muted-foreground')}>
                      {formData.primary_goal || 'Choose your primary goal'}
                    </span>
                    <ChevronDown className="absolute right-4 size-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[min(480px,calc(100vw-3rem))]">
                  <DropdownMenuLabel>Primary goal</DropdownMenuLabel>
                  {GOALS.map((goal) => {
                    const GoalIcon = GOAL_ICONS[goal]
                    return (
                      <DropdownMenuItem key={goal} delayDuration={0} onSelect={() => update('primary_goal', goal)}>
                        <GoalIcon className="size-4 text-muted-foreground" />
                        <span>{goal}</span>
                        {formData.primary_goal === goal && <Check className="ml-auto size-4 text-primary" />}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex min-h-10 items-center justify-between">
          <Button variant="ghost" size="default" shape="round" scaleOnPress depthShadow onClick={identityStage === 'name' ? onBack : goBack}>
            <ArrowLeft className="size-4" />
            <span>Back</span>
          </Button>
          <AnimatePresence initial={false}>
            {canAdvance && (
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
                <Button variant={advanceLabel === 'Skip' ? 'ghost' : 'default'} size="default" shape="round" scaleOnPress depthShadow onClick={advanceStage}>
                  <span>{advanceLabel}</span>
                  <ArrowRight className="size-4" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function StepAccountAnalysisInfo({ formData, update, onBack, onNext }: any) {
  const audienceLabel = getOptionalStepActionLabel(formData.target_audience)

  return (
    <div className="space-y-10">
      <motion.div variants={childVariants} className="text-center">
        <h1 className="text-3xl font-bold leading-none tracking-tight text-white">Before we analyze your accounts</h1>
      </motion.div>

      <motion.div variants={childVariants} className="mx-auto w-full max-w-[480px] space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="w-[640px] max-w-[calc(100vw-4rem)] text-sm leading-relaxed text-zinc-400 text-pretty">
            Soxial uses the X and Reddit accounts currently signed in to your browser. You'll be asked to sign in if either account cannot be detected.
          </p>
          <div className="flex items-center gap-3 text-sm text-zinc-300">
            <span className="inline-flex items-center gap-2">
              <XLogo className="size-3.5 text-white" /> Twitter / X
            </span>
            <span className="text-zinc-700">•</span>
            <span className="inline-flex items-center gap-2">
              <RedditLogo className="size-3.5 text-[#ff4500]" /> Reddit
            </span>
          </div>
        </div>

        <Input
          label={undefined}
          name="target_audience"
          ariaLabel="Who's your target audience"
          autoFocus
          value={formData.target_audience}
          onChange={(value: string) => update('target_audience', value)}
          placeholder="Who's your target audience (optional)"
          hint="Not sure? Skip this and Soxial will infer it from your posts."
        />

        <div className="flex min-h-10 items-center justify-between pt-1">
          <Button variant="ghost" size="default" shape="round" scaleOnPress depthShadow onClick={onBack} className="text-zinc-500 hover:text-white">
            <ArrowLeft className="size-4" />
            <span>Back</span>
          </Button>
          <Button variant={audienceLabel === 'Skip' ? 'ghost' : 'default'} size="default" shape="round" scaleOnPress depthShadow onClick={onNext}>
            <span>{audienceLabel}</span>
            <ArrowRight className="size-4" />
          </Button>
        </div>

        <p className="border-t border-white/5 pt-4 text-center text-xs leading-relaxed text-zinc-500">
          {ACCOUNT_ANALYSIS_DISCLOSURE}
        </p>
      </motion.div>
    </div>
  )
}

type OnboardingProviderId = 'google' | 'zhipu' | 'openai' | 'anthropic'

const STEP_API_TABS: Array<{ id: OnboardingProviderId; label: string }> = [
  { id: 'google', label: 'Google' },
  { id: 'zhipu', label: 'Z.AI' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
]

function StepApiKey({ formData, update, onBack, onNext }: any) {
  const [activeTab, setActiveTab] = useState<OnboardingProviderId>('google')
  const [primaryKeys, setPrimaryKeys] = useState<Record<OnboardingProviderId, string>>({
    google: formData.gemini_api_key || '',
    zhipu: formData.zai_api_key || '',
    openai: formData.openai_api_key || '',
    anthropic: formData.anthropic_api_key || '',
  })
  const [extraKeys, setExtraKeys] = useState<Record<OnboardingProviderId, Array<{ id?: number; value: string; masked?: string | null }>>>({
    google: [], zhipu: [], openai: [], anthropic: [],
  })
  const [codingPlan, setCodingPlan] = useState(formData.zai_coding_plan === 1)
  const [saving, setSaving] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verificationStage, setVerificationStage] = useState<string>('')
  const [verificationError, setVerificationError] = useState<{ provider: OnboardingProviderId; message: string } | null>(null)

  useEffect(() => {
    for (const tab of STEP_API_TABS) {
      window.api.getApiKeys(tab.id).then((keys: any[]) => {
        setExtraKeys(prev => ({
          ...prev,
          [tab.id]: (keys || []).filter(k => k.name !== 'Primary').map(k => ({ id: k.id, value: '', masked: k.masked })),
        }))
      })
    }
  }, [])

  const handleContinue = async () => {
    if (saving || verifying) return

    // Verify before persisting: a rejected key must never be written to the
    // profile, and the run must not reach account gathering without a provider.
    setVerificationError(null)
    setVerifying(true)
    setVerificationStage('Checking your AI provider credentials…')

    try {
      // Verify only providers the user actually touched: a section with a
      // primary key, a new backup key, or stored keys up for re-verification.
      const request: Record<string, { primary?: string; additional?: string[]; storedKeyIds?: number[]; codingPlan?: boolean }> = {}
      for (const { id } of STEP_API_TABS) {
        const section: typeof request[string] = {
          primary: primaryKeys[id].trim() || undefined,
          additional: extraKeys[id].filter(e => !e.id && e.value.trim()).map(e => e.value.trim()),
          storedKeyIds: extraKeys[id].filter(e => e.id).map(e => e.id as number),
        }
        if (section.primary || (section.additional?.length ?? 0) > 0 || (section.storedKeyIds?.length ?? 0) > 0) {
          request[id] = section
        }
      }
      if (request.zhipu) request.zhipu.codingPlan = codingPlan

      const report = await window.api.verifyCredentials(request)

      if (!report?.ok) {
        const failure = report?.results?.find(result => !result.valid && result.slot !== 'stored')
          ?? report?.results?.find(result => !result.valid)
        setVerificationError({
          provider: failure?.provider ?? 'google',
          message: failure?.message ?? report?.message ?? 'Could not verify your API key.',
        })
        if (failure?.provider) setActiveTab(failure.provider)
        return
      }

      setVerificationStage('Credentials verified. Saving…')
      await persistKeys()
      onNext()
    } catch (err) {
      console.error('Failed to verify API keys:', err)
      setVerificationError({
        provider: activeTab,
        message: 'Could not verify your API key. Please try again.',
      })
    } finally {
      setVerifying(false)
      setVerificationStage('')
    }
  }

  const persistKeys = async () => {
    setSaving(true)
    try {
      await window.api.updateProfile({
        gemini_api_key: primaryKeys.google.trim(),
        zai_api_key: primaryKeys.zhipu.trim(),
        openai_api_key: primaryKeys.openai.trim(),
        anthropic_api_key: primaryKeys.anthropic.trim(),
        zai_coding_plan: codingPlan ? 1 : 0,
      })

      // Persist backup keys per provider: add new rows, drop removed ones.
      for (const { id } of STEP_API_TABS) {
        const extras = extraKeys[id]
        const existing = ((await window.api.getApiKeys(id)) as any[]).filter(k => k.name !== 'Primary')
        const keptIds = new Set(extras.filter(e => e.id).map(e => e.id))
        for (const k of existing) {
          if (!keptIds.has(k.id)) await window.api.removeApiKey(k.id)
        }
        for (const e of extras) {
          if (!e.id && e.value.trim()) await window.api.addApiKey(e.value.trim(), id)
        }
      }

      update('gemini_api_key', primaryKeys.google.trim())
      update('zai_api_key', primaryKeys.zhipu.trim())
      update('zai_coding_plan', codingPlan ? 1 : 0)
    } finally {
      setSaving(false)
    }
  }

  const hasAnyKey = STEP_API_TABS.some(({ id }) => primaryKeys[id].trim() || extraKeys[id].some(e => e.value.trim()))

  // One panel shape for every hosted provider, matching the Settings page.
  const renderStepPanel = (provider: OnboardingProviderId) => (
    <div className="space-y-4">
      <Input
        label={undefined}
        value={primaryKeys[provider]}
        onChange={(v: string) => setPrimaryKeys(prev => ({ ...prev, [provider]: v.trim() }))}
        placeholder="Paste your API key"
        type="password"
        icon={KeyRound}
      />

      {provider === 'zhipu' && (
        <div className="flex items-center justify-between p-5 rounded-2xl bg-white/[0.01] hover:bg-white/[0.02] border border-white/[0.04] shadow-sm transition-colors">
          <div>
            <div className="text-xs font-semibold text-white tracking-tight">Coding plan API</div>
            <div className="text-[10px] text-zinc-500 font-medium mt-0.5">Enable if your api is a Coding plan api key</div>
          </div>
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
      )}

      {extraKeys[provider].map((k, i) => (
        <div key={k.id ?? `new-${provider}-${i}`} className="flex gap-2 items-end">
          <div className="flex-1">
            <Input
              label={undefined}
              value={k.value}
              onChange={(v: string) => setExtraKeys(prev => ({ ...prev, [provider]: prev[provider].map((item, idx) => idx === i ? { ...item, value: v } : item) }))}
              placeholder="Paste your backup API key"
              type="password"
              icon={KeyRound}
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            shape="square"
            scaleOnPress
            depthShadow
            onClick={() => setExtraKeys(prev => ({ ...prev, [provider]: prev[provider].filter((_, idx) => idx !== i) }))}
            aria-label="Remove key"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <button
        onClick={() => setExtraKeys(prev => ({ ...prev, [provider]: [...prev[provider], { value: '' }] }))}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white transition-colors font-semibold ml-1 mt-1"
      >
        <Plus className="size-3.5" /> Add backup key
      </button>
    </div>
  )

  return (
    <div className="space-y-10">
      <motion.div variants={childVariants} className="text-center">
        <h1 className="text-3xl font-bold leading-none tracking-tight text-white">Add an AI provider</h1>
      </motion.div>

      <motion.div variants={childVariants} className="mx-auto w-full max-w-[480px]">
        <div className="space-y-6">
          {/* Sliding Tab Selector */}
          <div className="mx-auto flex w-full max-w-[420px] rounded-xl border border-input/60 bg-card p-1 relative">
            {STEP_API_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "relative z-10 flex-1 rounded-lg py-2 text-xs font-semibold tracking-wide transition-colors duration-300",
                  activeTab === tab.id ? "text-white" : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {activeTab === tab.id && (
                  <motion.span
                    layoutId="activeTabBackdropOnboarding"
                    className="absolute inset-0 rounded-lg border border-white/[0.06] bg-white/[0.06] shadow-sm"
                    transition={springTransition}
                  />
                )}
                {tab.label}
              </button>
            ))}
          </div>

          <div>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {renderStepPanel(activeTab)}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      <AnimatePresence initial={false}>
        {verificationError && !verifying && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            role="alert"
            className="mx-auto w-full max-w-[480px] rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3"
          >
            <p className="text-xs font-semibold text-red-300">
              {STEP_API_TABS.find(t => t.id === verificationError.provider)?.label ?? 'Provider'} verification failed
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-200/80">{verificationError.message}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div variants={childVariants} className="mx-auto flex w-full max-w-[480px] items-center justify-between gap-3 pt-1">
        <Button variant="ghost" size="default" shape="round" scaleOnPress depthShadow onClick={onBack} disabled={verifying || saving} className="text-zinc-500 hover:text-white">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button variant="default" size="default" shape="round" scaleOnPress depthShadow onClick={handleContinue} disabled={!hasAnyKey || saving || verifying}>
          {verifying ? 'Verifying...' : saving ? 'Saving...' : 'Continue'}
          <ArrowRight className="size-4" />
        </Button>
      </motion.div>

      {/* Verification status: blocks interaction while the check runs, and
          closes on both success and failure. */}
      <AnimatePresence>
        {verifying && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-label="Verifying API credentials"
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.99 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="w-[min(380px,calc(100vw-3rem))] rounded-2xl border border-white/[0.06] bg-[#0c0c0f] p-6 shadow-xl"
            >
              <div className="flex items-center gap-3">
                <span className="size-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
                <p className="text-sm font-semibold tracking-tight text-white">Verifying your API key</p>
              </div>
              <p aria-live="polite" className="mt-2 text-xs leading-relaxed text-zinc-400">
                {verificationStage || 'Contacting your AI provider…'}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
  const [review, setReview] = useState<{ runId: string; version?: number } | null>(null)
  const mountedRef = useRef(true)
  const runIdRef = useRef<string | null>(null)
  const gateRef = useRef<OnboardingEventGate | null>(null)

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
    // runIdRef is set before the run starts, so the first interview answer of a
    // fresh run is checkpointed too.
    const activeRunId = runIdRef.current
    if (activeRunId) {
      window.api.checkpointOnboarding(activeRunId, 'interview', nextMessages, {
        batchId: pendingBatchId || 'batch',
        questionIds: answers.map(answer => answer.id),
      }).catch(() => {})
    }
    window.api.sendOnboardingAnswer(pendingBatchId || 'batch', answers)
    setPendingQuestions(null)
    setPendingBatchId(null)
  }

  const startOnboarding = async (resume?: { runId: string; messages: any[] }) => {
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

    // Establish run identity before any long-running work so events can be
    // scoped and answers checkpointed from the first question onward.
    let activeRunId = resume?.runId
    if (!activeRunId) {
      try {
        const prepared = await window.api.prepareOnboarding()
        activeRunId = prepared?.runId
      } catch {
        // Fall through: the main process still assigns an id when executing.
      }
    }
    if (!mountedRef.current) return
    if (activeRunId) {
      runIdRef.current = activeRunId
      gateRef.current = createOnboardingEventGate(activeRunId)
      setRunId(activeRunId)
    }

    // Resume re-enters the persisted checkpoint in the main process (Plan 7);
    // the agent continues from persisted model messages, not this transcript.
    const runPromise = resume
      ? window.api.resumeOnboarding(resume.runId)
      : window.api.runOnboarding(formData, undefined, activeRunId)
    runPromise
      .then(result => {
        if (!mountedRef.current) return
        setStreaming(false)
        if (result?.runId) {
          runIdRef.current = result.runId
          setRunId(result.runId)
        }
         if (result?.reviewRequired) {
          commitStreamingMessage()
          setStreaming(false)
          const rid = result?.runId || activeRunId
          if (rid) {
            setRunId(rid)
            runIdRef.current = rid
            window.api.getStrategyDraft(rid).then(draft => {
              if (draft?.success && mountedRef.current) {
                setReview({ runId: rid, version: draft.version })
              }
            }).catch(() => {})
          }
        } else if (result?.success) {
          commitStreamingMessage()
          setComplete(true)
        } else if (result?.aborted) {
          // user backed out of the auth gate; parent already navigated away
        } else {
          // Preserve transcript even on failure — commit any in-flight streaming
          // content so thinking/toolcalls/response after the last user message
          // remain visible and retryable, and checkpoint it for reload.
          const pendingText = streamTextRef.current.trim()
          const pendingSteps = [...stepsRef.current]
          const hasPendingStream = pendingText.length > 0 || pendingSteps.length > 0
          let transcript: any[] | null = null
          if (hasPendingStream) {
            transcript = [...messagesRef.current, { role: 'assistant' as const, content: pendingText, steps: pendingSteps.length ? pendingSteps : undefined }]
            commitStreamingMessage()
          } else {
            transcript = [...messagesRef.current]
          }
          if (transcript.length > 0) {
            setSavedConversationState(transcript.map(m => ({ role: m.role, content: m.content, steps: (m as any).steps })))
            const rid = result?.runId || activeRunId || runIdRef.current
            if (rid) window.api.checkpointOnboarding(rid, 'interview', transcript).catch(() => {})
          }
          setAppError(result?.appError || null)
          setError(result?.error || 'Failed to complete onboarding')
        }
      })
      .catch(err => {
        if (!mountedRef.current) return
        setStreaming(false)
        const pendingText = streamTextRef.current.trim()
        const pendingSteps = [...stepsRef.current]
        const hasPendingStream = pendingText.length > 0 || pendingSteps.length > 0
        let transcript: any[] | null = null
        if (hasPendingStream) {
          transcript = [...messagesRef.current, { role: 'assistant' as const, content: pendingText, steps: pendingSteps.length ? pendingSteps : undefined }]
          commitStreamingMessage()
        } else {
          transcript = [...messagesRef.current]
        }
        setError(err.message || 'An error occurred during onboarding')
        setAppError(null)
        if (transcript && transcript.length > 0) {
          setSavedConversationState(transcript.map((m: any) => ({ role: m.role, content: m.content, steps: m.steps })))
          const rid = activeRunId || runIdRef.current
          if (rid) window.api.checkpointOnboarding(rid, 'interview', transcript).catch(() => {})
        } else {
          const snapshot: any[] = (savedConversationState as any) || []
          setSavedConversationState(snapshot.map((m: any) => ({ role: m.role, content: m.content, steps: m.steps })))
        }
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
    const activeRunId = runIdRef.current || runId || undefined
    if (activeRunId) gateRef.current = createOnboardingEventGate(activeRunId)
    window.api.runOnboarding(formData, messagesToContinue, activeRunId)
      .then(result => {
        if (!mountedRef.current) return
        setStreaming(false)
        if (result?.runId) {
          runIdRef.current = result.runId
          setRunId(result.runId)
        }
        if (result?.success) {
          commitStreamingMessage()
          setComplete(true)
        } else if (result?.aborted) {
          // no-op
        } else {
          const pendingText = streamTextRef.current.trim()
          const pendingSteps = [...stepsRef.current]
          const hasPendingStream = pendingText.length > 0 || pendingSteps.length > 0
          let transcript: any[] | null = null
          if (hasPendingStream) {
            transcript = [...messagesRef.current, { role: 'assistant' as const, content: pendingText, steps: pendingSteps.length ? pendingSteps : undefined }]
            commitStreamingMessage()
          } else {
            transcript = [...messagesRef.current]
          }
          if (transcript.length > 0) {
            setSavedConversationState(transcript.map((m: any) => ({ role: m.role, content: m.content, steps: m.steps })))
            const rid = (result as any)?.runId || activeRunId || runIdRef.current
            if (rid) window.api.checkpointOnboarding(rid, 'interview', transcript).catch(() => {})
          }
          setAppError(result?.appError || null)
          setError(result?.error || 'Failed to complete onboarding')
        }
      })
      .catch(err => {
        if (!mountedRef.current) return
        setStreaming(false)
        const pendingText = streamTextRef.current.trim()
        const pendingSteps = [...stepsRef.current]
        const hasPendingStream = pendingText.length > 0 || pendingSteps.length > 0
        let transcript: any[] | null = null
        if (hasPendingStream) {
          transcript = [...messagesRef.current, { role: 'assistant' as const, content: pendingText, steps: pendingSteps.length ? pendingSteps : undefined }]
          commitStreamingMessage()
        } else {
          transcript = [...messagesRef.current]
        }
        setError(err.message || 'An error occurred during onboarding')
        setAppError(null)
        // Save conversation state for retry (use the ref so we get the latest, not the stale closure)
        if (transcript && transcript.length > 0) {
          setSavedConversationState(transcript.map((m: any) => ({ role: m.role, content: m.content, steps: m.steps })))
          const rid = activeRunId || runIdRef.current
          if (rid) window.api.checkpointOnboarding(rid, 'interview', transcript).catch(() => {})
        } else {
          setSavedConversationState(messagesRef.current.map((m: any) => ({
            role: m.role,
            content: m.content,
            steps: m.steps
          })))
        }
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

    // Single run-scoped stream. The gate drops events from superseded runs and
    // any out-of-order or duplicated delivery.
    const cleanup = [
      window.api.onOnboardingEvent((raw) => {
        const gate = gateRef.current
        if (!gate || !gate.accept(raw)) return
        const { payload } = raw as OnboardingEvent

        switch (payload.type) {
          case 'phase':
            if ((payload as any).phase === 'review') {
              const rid = runIdRef.current
              if (rid) {
                window.api.getStrategyDraft(rid).then(draft => {
                  if (draft?.success && mountedRef.current) setReview({ runId: rid, version: draft.version })
                }).catch(() => {})
              }
            }
            return

          case 'text': {
            setTransientRetry(null)   // stream resumed → clear high-demand banner
            streamTextRef.current += payload.text
            setStreamText(streamTextRef.current)
            return
          }

          case 'reasoning': {
            const s = stepsRef.current
            const last = s[s.length - 1]
            if (last && last.type === 'reasoning') {
              last.text += payload.text
            } else {
              s.push({ type: 'reasoning', text: payload.text })
            }
            setSteps([...s])
            return
          }

          case 'tool-call': {
            if (payload.name === 'ask_user_questions') return
            const tool: StepItem = { type: 'tool', id: stepCounter.current++, name: payload.name, args: payload.args, status: 'calling' }
            stepsRef.current = [...stepsRef.current, tool]
            setSteps(stepsRef.current)
            return
          }

          case 'tool-result': {
            if (payload.name === 'ask_user_questions') return
            let found = false
            stepsRef.current = stepsRef.current.map(s => {
              if (!found && s.type === 'tool' && s.name === payload.name && s.status === 'calling') {
                found = true
                return { ...s, status: 'complete', result: payload.result }
              }
              return s
            })
            setSteps([...stepsRef.current])
            return
          }

          case 'question': {
            commitStreamingMessage()
            setPendingBatchId(payload.batchId)
            setPendingQuestions(payload.questions as QuestionData[])
            return
          }

          case 'auth-required': {
            setPendingAuth(payload.auth as any)
            return
          }

          case 'transient-retry': {
            setTransientRetry({
              attempt: payload.attempt,
              maxAttempts: payload.maxAttempts,
              backoffMs: payload.backoffMs,
              model: payload.model,
            })
            return
          }

          default:
            return
        }
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
        if (checkpoint && checkpoint.pendingReview) {
          // A draft was awaiting user review: resume straight into it without
          // re-running any model work.
          runIdRef.current = checkpoint.runId
          setRunId(checkpoint.runId)
          gateRef.current = createOnboardingEventGate(checkpoint.runId)
          setMessages(checkpoint.messages as any)
          setStreaming(false)
          setReview({
            runId: checkpoint.pendingReview.draftRunId,
            version: checkpoint.pendingReview.expectedVersion,
          })
          return
        }
        if (checkpoint && checkpoint.messages.length > 0) {
          runIdRef.current = checkpoint.runId
          setRunId(checkpoint.runId)
          // Reopen an unanswered questionnaire exactly as it was left.
          if (checkpoint.pendingQuestions?.length) {
            setPendingBatchId(checkpoint.pendingBatchId ?? null)
            setPendingQuestions(checkpoint.pendingQuestions as QuestionData[])
          }
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

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="max-w-3xl mx-auto w-full pt-16">
          {messages.map((msg, i) => (
            <Message key={i} from={msg.role}>
              <MessageContent>
                {msg.steps?.length ? (
                  <div className="flex flex-col gap-1.5 mb-2">
                    <MessageSegments steps={msg.steps} />
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
                    <MessageSegments steps={steps} working />
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
                      <Button
                        variant="ghost"
                        size="sm"
                        shape="round"
                        scaleOnPress
                        depthShadow
                        onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'abort'); setPendingAuth(null); onBack() }}
                        className="text-zinc-500 hover:text-white"
                      >
                        Back
                      </Button>

                      <div className="flex flex-wrap items-center gap-2.5">
                        {pendingAuth.canSkipReddit && (
                          <Button
                            variant="outline"
                            size="sm"
                            shape="round"
                            scaleOnPress
                            depthShadow
                            onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'skip_reddit'); setPendingAuth(null) }}
                          >
                            Continue with X only
                          </Button>
                        )}
                        {pendingAuth.canSkipTwitter && (
                          <Button
                            variant="outline"
                            size="sm"
                            shape="round"
                            scaleOnPress
                            depthShadow
                            onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'skip_twitter'); setPendingAuth(null) }}
                          >
                            Continue with Reddit only
                          </Button>
                        )}
                        <Button
                          variant="default"
                          size="sm"
                          shape="round"
                          scaleOnPress
                          depthShadow
                          onClick={() => { window.api.retryOnboardingAuth(pendingAuth.id, 'retry'); setPendingAuth(null) }}
                        >
                          Logged in
                          <ArrowRight className="size-3 stroke-[2.5]" />
                        </Button>
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
                <Button variant="default" size="sm" shape="round" scaleOnPress depthShadow onClick={retryOnboarding} className="shrink-0">
                  <RefreshCw className="size-3 stroke-[2.5]" /> Retry
                </Button>
              </div>
            )
          ) : complete ? (
            <Button
              variant="default"
              size="lg"
              shape="round"
              scaleOnPress
              depthShadow
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
              className="pointer-events-auto animate-in fade-in zoom-in-95 duration-500"
            >
              <span>Continue</span>
              <ArrowRight className="size-3 stroke-[2.5]" />
            </Button>
          ) : pendingQuestions ? (
            <QuestionInput questions={pendingQuestions} onSubmit={handleAllAnswers} />
          ) : null}

          {review && (
            <div className="pointer-events-auto w-full max-w-3xl mx-auto max-h-[65vh] overflow-y-auto">
              <StrategyReview
                runId={review.runId}
                initialVersion={review.version}
                onCommitted={async () => {
                  setReview(null)
                  setComplete(true)
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
                onError={(message) => {
                  if (message === 'saved-later') return // draft stays in review; resumable
                  setError(message)
                  setStreaming(false)
                }}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
