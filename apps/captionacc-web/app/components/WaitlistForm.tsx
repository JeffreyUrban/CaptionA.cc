'use client'

import useWeb3Forms from '@web3forms/react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

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
  const accessKey = import.meta.env['VITE_WEB3FORMS_ACCESS_KEY'] || ''

  const { submit: onSubmit } = useWeb3Forms({
    access_key: accessKey,
    settings: {
      from_name: 'CaptionA.cc Waitlist',
      subject: 'New Waitlist Signup - CaptionA.cc',
    },
    onSuccess: msg => {
      setIsSuccess(true)
      setResult("Thank you for joining our waitlist! We'll be in touch soon.")
      setIsSubmitting(false)
      reset()
    },
    onError: msg => {
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
    return (
      <div className="rounded-lg bg-white p-8 text-center shadow-sm dark:bg-olive-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
          <svg
            className="h-6 w-6 text-green-600 dark:text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg/7 font-semibold text-olive-950 dark:text-white">
          You're on the list!
        </h3>
        <p className="mt-2 text-sm/7 text-olive-700 dark:text-olive-400">{result}</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-8">
      {/* Required Fields */}
      <div className="space-y-6">
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-olive-950 dark:text-white"
          >
            Name *
          </label>
          <input
            {...register('name', { required: true })}
            type="text"
            id="name"
            className="mt-2 block w-full rounded-md border border-olive-950/10 px-4 py-3 text-olive-950 placeholder-gray-500 focus:border-olive-950 focus:outline-none focus:ring-1 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:text-white dark:placeholder-gray-400 dark:focus:border-olive-300 dark:focus:ring-olive-300"
            placeholder="Your name"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-olive-950 dark:text-white"
          >
            Email *
          </label>
          <input
            {...register('email', { required: true })}
            type="email"
            id="email"
            className="mt-2 block w-full rounded-md border border-olive-950/10 px-4 py-3 text-olive-950 placeholder-gray-500 focus:border-olive-950 focus:outline-none focus:ring-1 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:text-white dark:placeholder-gray-400 dark:focus:border-olive-300 dark:focus:ring-olive-300"
            placeholder="you@example.com"
          />
        </div>
      </div>

      {/* Optional Fields */}
      <div className="border-t border-olive-950/10 pt-8 dark:border-white/10">
        <h3 className="font-display mb-6 text-lg font-semibold text-olive-950 dark:text-white">
          Help us understand your needs (optional)
        </h3>

        <div className="space-y-6">
          {/* Primary Use Case */}
          <div>
            <label
              htmlFor="use_case"
              className="block text-sm font-medium text-olive-950 dark:text-white"
            >
              Primary use case
            </label>
            <select
              {...register('use_case')}
              id="use_case"
              className="mt-2 block w-full rounded-md border border-olive-950/10 px-4 py-3 text-olive-950 focus:border-olive-950 focus:outline-none focus:ring-1 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:text-white dark:focus:border-olive-300 dark:focus:ring-olive-300"
            >
              <option value="">Select an option...</option>
              <option value="translation">Translation/Localization</option>
              <option value="archive">Media Archive/Library</option>
              <option value="platform">Content Platform/Application</option>
              <option value="learning">Language Learning Tools</option>
              <option value="research">Research/Academic</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Character Sets */}
          <div>
            <label className="mb-3 block text-sm font-medium text-olive-950 dark:text-white">
              What character sets/scripts do your subtitles use? (select all that apply)
            </label>
            <div className="space-y-4">
              {/* East Asian Scripts */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-500">
                  East Asian Scripts
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Chinese (Simplified)"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Chinese (Simplified) - 简体中文
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Chinese (Traditional)"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Chinese (Traditional) - 繁體中文
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Japanese - Hiragana"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Japanese - Hiragana (ひらがな)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Japanese - Katakana"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Japanese - Katakana (カタカナ)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Japanese - Kanji"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Japanese - Kanji (漢字)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Korean - Hangul"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Korean - Hangul (한글)
                    </span>
                  </label>
                </div>
              </div>

              {/* Latin & European Scripts */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-500">
                  Latin & European Scripts
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Latin/Roman alphabet"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Latin/Roman alphabet
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Cyrillic"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Cyrillic (Russian, Ukrainian, etc.)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Greek"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Greek (Ελληνικά)
                    </span>
                  </label>
                </div>
              </div>

              {/* Middle Eastern & South Asian Scripts */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-500">
                  Middle Eastern & South Asian Scripts
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Arabic"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Arabic (العربية)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Hebrew"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Hebrew (עברית)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Devanagari"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Devanagari (Hindi, etc.)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Thai"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Thai (ไทย)
                    </span>
                  </label>
                </div>
              </div>

              {/* Other Scripts */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-500">
                  Other Scripts
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Vietnamese"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                      Vietnamese (Tiếng Việt)
                    </span>
                  </label>
                  <label className="flex items-center">
                    <input
                      {...register('character_sets')}
                      type="checkbox"
                      value="Other"
                      className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                    />
                    <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">Other</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Video Lengths */}
          <div>
            <label className="mb-3 block text-sm font-medium text-olive-950 dark:text-white">
              Typical video length(s) you work with (select all that apply)
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="Under 5 minutes"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">Under 5 min</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="5-15 minutes"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">5-15 min</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="15-30 minutes"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">15-30 min</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="30-60 minutes"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">30-60 min</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="1-2 hours"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">1-2 hours</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="2-4 hours"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">2-4 hours</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="4-8 hours"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">4-8 hours</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="8-10 hours"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">8-10 hours</span>
              </label>
              <label className="flex items-center">
                <input
                  {...register('video_lengths')}
                  type="checkbox"
                  value="10+ hours"
                  className="h-4 w-4 rounded border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">10+ hours</span>
              </label>
            </div>
          </div>

          {/* Timing Accuracy */}
          <div>
            <label className="mb-3 block text-sm font-medium text-olive-950 dark:text-white">
              How important is timing accuracy for your use case?
            </label>
            <div className="space-y-2">
              <label className="flex items-start">
                <input
                  {...register('timing_accuracy')}
                  type="radio"
                  value="Frame-accurate is critical"
                  className="mt-1 h-4 w-4 border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                  Frame-accurate timing is critical (e.g., for dubbing, precise synchronization)
                </span>
              </label>
              <label className="flex items-start">
                <input
                  {...register('timing_accuracy')}
                  type="radio"
                  value="Precise is important"
                  className="mt-1 h-4 w-4 border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                  Precise timing is important (within ~3-5 frames / 0.1-0.2 seconds)
                </span>
              </label>
              <label className="flex items-start">
                <input
                  {...register('timing_accuracy')}
                  type="radio"
                  value="Approximate is fine"
                  className="mt-1 h-4 w-4 border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                  Approximate timing is fine (within 0.5 seconds)
                </span>
              </label>
              <label className="flex items-start">
                <input
                  {...register('timing_accuracy')}
                  type="radio"
                  value="Timing doesn't matter much"
                  className="mt-1 h-4 w-4 border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                  Timing doesn't matter much (just need the text)
                </span>
              </label>
              <label className="flex items-start">
                <input
                  {...register('timing_accuracy')}
                  type="radio"
                  value="Not sure / depends"
                  className="mt-1 h-4 w-4 border-olive-950/10 text-olive-950 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:focus:ring-olive-300"
                />
                <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">
                  Not sure / depends on the project
                </span>
              </label>
            </div>
          </div>

          {/* Text Areas */}
          <div>
            <label
              htmlFor="needs"
              className="block text-sm font-medium text-olive-950 dark:text-white"
            >
              Tell us about your needs
            </label>
            <p className="mt-1 text-xs text-olive-600 dark:text-olive-500">
              What are you trying to accomplish? What's been frustrating about existing tools?
            </p>
            <textarea
              {...register('needs')}
              id="needs"
              rows={4}
              className="mt-2 block w-full rounded-md border border-olive-950/10 px-4 py-3 text-olive-950 placeholder-gray-500 focus:border-olive-950 focus:outline-none focus:ring-1 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:text-white dark:placeholder-gray-400 dark:focus:border-olive-300 dark:focus:ring-olive-300"
              placeholder="Share your thoughts..."
            />
          </div>

          <div>
            <label
              htmlFor="features"
              className="block text-sm font-medium text-olive-950 dark:text-white"
            >
              Interested in specific features or integrations?
            </label>
            <p className="mt-1 text-xs text-olive-600 dark:text-olive-500">
              For example: specific subtitle formats, API access, batch processing, study material
              exports, etc.
            </p>
            <textarea
              {...register('features')}
              id="features"
              rows={3}
              className="mt-2 block w-full rounded-md border border-olive-950/10 px-4 py-3 text-olive-950 placeholder-gray-500 focus:border-olive-950 focus:outline-none focus:ring-1 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:text-white dark:placeholder-gray-400 dark:focus:border-olive-300 dark:focus:ring-olive-300"
              placeholder="Any specific features you'd like to see..."
            />
          </div>

          <div>
            <label
              htmlFor="anything_else"
              className="block text-sm font-medium text-olive-950 dark:text-white"
            >
              Anything else we should know?
            </label>
            <p className="mt-1 text-xs text-olive-600 dark:text-olive-500">
              Any other context about your workflow, volume, or requirements?
            </p>
            <textarea
              {...register('anything_else')}
              id="anything_else"
              rows={3}
              className="mt-2 block w-full rounded-md border border-olive-950/10 px-4 py-3 text-olive-950 placeholder-gray-500 focus:border-olive-950 focus:outline-none focus:ring-1 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:text-white dark:placeholder-gray-400 dark:focus:border-olive-300 dark:focus:ring-olive-300"
              placeholder="Additional information..."
            />
          </div>

          {/* How did you hear */}
          <div>
            <label
              htmlFor="heard_from"
              className="block text-sm font-medium text-olive-950 dark:text-white"
            >
              How did you hear about us?
            </label>
            <select
              {...register('heard_from')}
              id="heard_from"
              className="mt-2 block w-full rounded-md border border-olive-950/10 px-4 py-3 text-olive-950 focus:border-olive-950 focus:outline-none focus:ring-1 focus:ring-olive-950 dark:border-white/10 dark:bg-olive-900 dark:text-white dark:focus:border-olive-300 dark:focus:ring-olive-300"
            >
              <option value="">Select an option...</option>
              <option value="search">Search engine</option>
              <option value="social">Social media</option>
              <option value="referral">Referral/Word of mouth</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      </div>

      {/* Privacy Note */}
      <div className="border-t border-olive-950/10 pt-6 dark:border-white/10">
        <p className="text-xs text-olive-600 dark:text-olive-500">
          We'll only use your email to contact you about early access. No spam, ever.
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
