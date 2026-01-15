'use client'

import useWeb3Forms from '@web3forms/react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import {
  SuccessMessage,
  RequiredFieldsSection,
  UseCaseSection,
  CharacterSetsSection,
  VideoLengthsSection,
  TimingAccuracySection,
  TextAreasSection,
} from './WaitlistFormSections'

interface WaitlistFormData {
  name: string
  email: string
  use_case?: string
  character_sets?: string[]
  video_lengths?: string[]
  timing_accuracy?: string
  needs?: string
  features?: string
  anything_else?: string
  heard_from?: string
}

export function WaitlistForm() {
  const { register, handleSubmit, reset } = useForm<WaitlistFormData>()
  const [isSuccess, setIsSuccess] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get access key from environment variable
  const accessKey = import.meta.env['VITE_WEB3FORMS_ACCESS_KEY'] ?? ''

  const { submit: onSubmit } = useWeb3Forms({
    access_key: accessKey,
    settings: {
      from_name: 'CaptionA.cc Waitlist',
      subject: 'New Waitlist Signup - CaptionA.cc',
    },
    onSuccess: _msg => {
      setIsSuccess(true)
      setResult("Thank you for joining our waitlist! We'll be in touch soon.")
      setIsSubmitting(false)
      reset()
    },
    onError: _msg => {
      setIsSuccess(false)
      setResult('Something went wrong. Please try again or contact us directly.')
      setIsSubmitting(false)
    },
  })

  const handleFormSubmit = async (data: WaitlistFormData) => {
    setIsSubmitting(true)
    setResult(null)

    // Convert arrays to comma-separated strings for email
    const formattedData = {
      ...data,
      character_sets: data.character_sets?.join(', '),
      video_lengths: data.video_lengths?.join(', '),
    }

    await onSubmit(formattedData)
  }

  if (isSuccess && result) {
    return <SuccessMessage message={result} />
  }

  return (
    <form onSubmit={e => void handleSubmit(handleFormSubmit)(e)} className="space-y-8">
      {/* Required Fields */}
      <RequiredFieldsSection register={register} />

      {/* Optional Fields */}
      <div className="border-t border-olive-950/10 pt-8 dark:border-white/10">
        <h3 className="font-display mb-6 text-lg font-semibold text-olive-950 dark:text-white">
          Help us understand your needs (optional)
        </h3>

        <div className="space-y-6">
          <UseCaseSection register={register} />
          <CharacterSetsSection register={register} />
          <VideoLengthsSection register={register} />
          <TimingAccuracySection register={register} />
          <TextAreasSection register={register} />
        </div>
      </div>

      {/* Privacy Note */}
      <div className="border-t border-olive-950/10 pt-6 dark:border-white/10">
        <p className="text-xs text-olive-600 dark:text-olive-400">
          We&apos;ll only use your email to contact you about early access. No spam, ever.
        </p>
      </div>

      {/* Submit Button */}
      <div>
        <button
          type="submit"
          disabled={isSubmitting || !accessKey}
          className="w-full rounded-md bg-olive-950 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-olive-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-olive-950 dark:hover:bg-olive-200"
        >
          {isSubmitting ? 'Submitting...' : 'Join the Waitlist'}
        </button>
        {!accessKey && (
          <p className="mt-2 text-center text-xs text-red-600 dark:text-red-400">
            Form configuration is pending. Please check back soon or contact us directly.
          </p>
        )}
      </div>

      {/* Error Message */}
      {result && !isSuccess && (
        <div className="rounded-md bg-red-50 p-4 dark:bg-red-900/20">
          <p className="text-sm text-red-800 dark:text-red-400">{result}</p>
        </div>
      )}
    </form>
  )
}
