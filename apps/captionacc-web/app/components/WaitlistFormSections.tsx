/**
 * Sub-components for WaitlistForm
 * Extracted to reduce component complexity
 */

import type { UseFormRegister } from 'react-hook-form'

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

interface SuccessMessageProps {
  message: string
}

export function SuccessMessage({ message }: SuccessMessageProps) {
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
        You&apos;re on the list!
      </h3>
      <p className="mt-2 text-sm/7 text-olive-700 dark:text-olive-400">{message}</p>
    </div>
  )
}

interface RequiredFieldsProps {
  register: UseFormRegister<WaitlistFormData>
}

export function RequiredFieldsSection({ register }: RequiredFieldsProps) {
  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-olive-950 dark:text-white">
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
        <label htmlFor="email" className="block text-sm font-medium text-olive-950 dark:text-white">
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
  )
}

interface UseCaseSectionProps {
  register: UseFormRegister<WaitlistFormData>
}

export function UseCaseSection({ register }: UseCaseSectionProps) {
  return (
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
  )
}

interface TextAreasSectionProps {
  register: UseFormRegister<WaitlistFormData>
}

export function TextAreasSection({ register }: TextAreasSectionProps) {
  return (
    <>
      <div>
        <label htmlFor="needs" className="block text-sm font-medium text-olive-950 dark:text-white">
          Tell us about your needs
        </label>
        <p className="mt-1 text-xs text-olive-600 dark:text-olive-400">
          What are you trying to accomplish? What&apos;s been frustrating about existing tools?
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
        <p className="mt-1 text-xs text-olive-600 dark:text-olive-400">
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
        <p className="mt-1 text-xs text-olive-600 dark:text-olive-400">
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
    </>
  )
}

interface CharacterSetsProps {
  register: UseFormRegister<WaitlistFormData>
}

export function CharacterSetsSection({ register }: CharacterSetsProps) {
  return (
    <div>
      <label className="mb-3 block text-sm font-medium text-olive-950 dark:text-white">
        What character sets/scripts do your subtitles use? (select all that apply)
      </label>
      <div className="space-y-4">
        {/* East Asian Scripts */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-400">
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
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-400">
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
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-400">
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
              <span className="ml-2 text-sm text-olive-700 dark:text-olive-400">Thai (ไทย)</span>
            </label>
          </div>
        </div>

        {/* Other Scripts */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-olive-600 dark:text-olive-400">
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
  )
}

interface VideoLengthsProps {
  register: UseFormRegister<WaitlistFormData>
}

export function VideoLengthsSection({ register }: VideoLengthsProps) {
  return (
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
  )
}

interface TimingAccuracyProps {
  register: UseFormRegister<WaitlistFormData>
}

export function TimingAccuracySection({ register }: TimingAccuracyProps) {
  return (
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
            Timing doesn&apos;t matter much (just need the text)
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
  )
}
