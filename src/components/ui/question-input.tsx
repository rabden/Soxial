import { useState, useEffect, useRef } from "react"
import { cn } from "src/lib/utils"
import { Check, ChevronLeft, ChevronRight } from "lucide-react"

export interface QuestionData {
  id: string
  text: string
  type: 'single' | 'multi' | 'text'
  options?: string[]
}

export interface QuestionInputProps {
  questions: QuestionData[]
  onSubmit: (answers: { id: string; answer: string | string[] }[]) => void
  disabled?: boolean
}

function ArrowUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5"
        stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function defaultFor(type: string): string | string[] {
  return type === 'multi' ? [] : ''
}

function isAnswered(val: string | string[] | undefined, type: string): boolean {
  if (val === undefined) return false
  if (type === 'multi') return Array.isArray(val) && val.length > 0
  if (type === 'text') return typeof val === 'string' && val.trim() !== ''
  return typeof val === 'string' && val !== ''
}

function isCustomOption(option: string): boolean {
  return /^(something else|other)(?:\b|\.)/i.test(option.trim())
}

export function QuestionInput({ questions, onSubmit, disabled }: QuestionInputProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [selected, setSelected] = useState<string | string[]>(defaultFor(questions[0]?.type || 'text'))
  const [customInput, setCustomInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  const question = questions[currentIndex]
  const isFirst = currentIndex === 0
  const isLast = currentIndex === questions.length - 1
  const options = question.options?.filter(opt => !isCustomOption(opt)) || []
  const customPlaceholder = question.options?.find(isCustomOption) || (question.type === 'multi' ? 'Add your own...' : 'Something else...')
  const customSingleValue = typeof selected === 'string' && !options.includes(selected) ? selected : ''
  const currentAnswer = question.type === 'multi' && customInput.trim()
    ? [...new Set([...(Array.isArray(selected) ? selected : []), customInput.trim()])]
    : selected

  useEffect(() => {
    const existing = answers[question.id]
    setSelected(existing !== undefined ? existing : defaultFor(question.type))
    setCustomInput('')
    if (question.type === 'text') {
      const t = setTimeout(() => textareaRef.current?.focus(), 200)
      return () => clearTimeout(t)
    }
  }, [currentIndex])

  const canAdvance = isAnswered(currentAnswer, question.type)
  const allAnswered = questions.every(q => isAnswered(q.id === question.id ? currentAnswer : answers[q.id], q.type))

  const saveCurrent = () => {
    setAnswers(prev => ({ ...prev, [question.id]: currentAnswer }))
  }

  const handleNext = () => {
    if (!canAdvance) return
    saveCurrent()
    if (isLast) {
      const final = { ...answers, [question.id]: currentAnswer }
      onSubmit(questions.map(q => ({ id: q.id, answer: final[q.id] })))
    } else {
      setCurrentIndex(i => i + 1)
    }
  }

  const handlePrev = () => {
    saveCurrent()
    if (!isFirst) setCurrentIndex(i => i - 1)
  }

  const toggleMulti = (opt: string) => {
    const list = Array.isArray(selected) ? selected : []
    setSelected(list.includes(opt) ? list.filter(x => x !== opt) : [...list, opt])
  }

  return (
    <div
      className="relative flex flex-col w-full pointer-events-auto animate-in fade-in slide-in-from-bottom-4 zoom-in-95 duration-500"
      style={{ maxWidth: 680 }}
    >
      <div
        style={{ borderRadius: 24 }}
        className="bg-card relative w-full border border-border shadow-sm focus-within:border-border/40 focus-within:ring-1 focus-within:ring-ring/20 overflow-hidden"
      >
        <div className="px-4 pt-3 pb-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wide">
              Question {currentIndex + 1} of {questions.length}
            </span>
            {isLast && (
              <span className={cn("text-[11px] font-medium", allAnswered ? "text-primary" : "text-muted-foreground/60")}>
                {allAnswered ? "Ready to submit" : "Answer all to submit"}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{question.text}</p>
        </div>

        <div className={cn("px-3", question.type === 'text' ? 'pb-2' : 'pb-3')}>
          {question.type === 'single' && (
            <div className="space-y-1">
              {options.map((opt, i) => (
                <button
                  key={opt}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelected(opt)}
                  style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'backwards' }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all animate-in fade-in slide-in-from-left-2 duration-300",
                    selected === opt
                      ? "bg-primary/10 text-foreground font-medium ring-1 ring-primary/30"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {opt}
                </button>
              ))}
              <div className={cn(
                "flex items-center mt-1 px-3 py-2.5 rounded-xl border transition-all",
                customSingleValue
                  ? "border-primary/30 bg-primary/10 ring-1 ring-primary/30"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10]"
              )}>
                <input
                  ref={customInputRef}
                  type="text"
                  value={customSingleValue}
                  disabled={disabled}
                  onChange={(e) => setSelected(e.target.value)}
                  placeholder={customPlaceholder}
                  className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
                />
              </div>
            </div>
          )}

          {question.type === 'multi' && (
            <div className="space-y-1">
              {options.map((opt, i) => {
                const list = Array.isArray(selected) ? selected : []
                const isSelected = list.includes(opt)
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleMulti(opt)}
                    style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'backwards' }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center justify-between animate-in fade-in slide-in-from-left-2 duration-300",
                      isSelected
                        ? "bg-primary/10 text-foreground font-medium ring-1 ring-primary/30"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span>{opt}</span>
                    {isSelected && <Check className="size-4 text-primary" />}
                  </button>
                )
              })}
              <div className="flex items-center gap-2 mt-1 px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] transition-all focus-within:border-primary/30 focus-within:bg-primary/10 focus-within:ring-1 focus-within:ring-primary/30">
                <input
                  ref={customInputRef}
                  type="text"
                  value={customInput}
                  disabled={disabled}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customInput.trim()) {
                      e.preventDefault()
                      const value = customInput.trim()
                      const list = Array.isArray(selected) ? selected : []
                      if (!list.includes(value)) setSelected([...list, value])
                      setCustomInput('')
                    }
                  }}
                  placeholder={customPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/80"
                />
                {customInput.trim() && <span className="text-[10px] text-muted-foreground/50 shrink-0">Enter to add</span>}
              </div>
              {(Array.isArray(selected) ? selected : [])
                .filter(value => !options.includes(value))
                .map(value => (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled}
                    onClick={() => setSelected((Array.isArray(selected) ? selected : []).filter(item => item !== value))}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center justify-between bg-primary/10 text-foreground font-medium ring-1 ring-primary/30"
                  >
                    <span>{value}</span>
                    <Check className="size-4 text-primary" />
                  </button>
                ))}
            </div>
          )}

          {question.type === 'text' && (
            <textarea
              ref={textareaRef}
              value={typeof selected === 'string' ? selected : ''}
              onChange={(e) => setSelected(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && isLast && canAdvance && allAnswered) {
                  e.preventDefault()
                  handleNext()
                }
              }}
              placeholder="Type your answer..."
              rows={2}
              className="w-full resize-none bg-transparent px-1 py-2 text-sm leading-[22px] text-foreground outline-none placeholder:text-muted-foreground/80"
            />
          )}
        </div>

        {/* Navigation bar */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
          <button
            type="button"
            onClick={handlePrev}
            disabled={isFirst || disabled}
            className={cn(
              "flex h-8 items-center gap-0.5 px-3 rounded-full text-xs font-medium transition-all",
              isFirst
                ? "opacity-0 pointer-events-none"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <ChevronLeft className="size-3.5" /> Prev
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={!canAdvance || disabled || (isLast && !allAnswered)}
            className={cn(
              "flex h-8 items-center gap-1.5 px-3 rounded-full text-xs font-medium transition-all",
              isLast
                ? "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
                : "bg-muted/60 text-foreground hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
            )}
          >
            {isLast ? (
              <>Submit All <ArrowUpIcon /></>
            ) : (
              <>Next <ChevronRight className="size-3.5" /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
