import { useCallback, useState } from 'react'

export type OnboardingFormData = Record<string, any>

const initialFormData: OnboardingFormData = {
  name: '',
  timezone: '',
  niche: '',
  superpower: '',
  primary_goal: '',
  voice_description: '',
  gemini_api_key: '',
  target_audience: '',
}

export function useOnboardingForm() {
  const [step, setStep] = useState(0)
  const [formData, setFormData] = useState<OnboardingFormData>(initialFormData)
  const update = useCallback((key: string, value: unknown) => {
    setFormData(previous => ({ ...previous, [key]: value }))
  }, [])

  return { step, setStep, formData, update }
}
