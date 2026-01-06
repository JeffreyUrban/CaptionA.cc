'use client'

import useWeb3Forms from '@web3forms/react'
import { useId, useState, forwardRef } from 'react'
import { useForm } from 'react-hook-form'
import { MetaFunction } from 'react-router'

import { Container } from '~/components/oatmeal/elements/container'
import { Main } from '~/components/oatmeal/elements/main'
import {
  FooterWithLinkCategories,
  FooterCategory,
  FooterLink,
} from '~/components/oatmeal/sections/footer-with-link-categories'
import { NavbarWithLogoActionsAndLeftAlignedLinks } from '~/components/oatmeal/sections/navbar-with-logo-actions-and-left-aligned-links'
import { ButtonLink } from '~/components/oatmeal/elements/button'

const TextInput = forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<'input'> & { label: string }
>(function TextInput({ label, ...props }, ref) {
  const id = useId()

  return (
    <div className="group relative z-0 transition-all focus-within:z-10">
      <input
        type="text"
        id={id}
        ref={ref}
        {...props}
        placeholder=" "
        className="peer block w-full border border-olive-950/10 bg-transparent px-6 pb-4 pt-12 text-base text-olive-950 ring-4 ring-transparent transition group-first:rounded-t-2xl group-last:rounded-b-2xl focus:border-olive-600 focus:outline-none focus:ring-olive-600/10 dark:border-white/10 dark:text-white dark:focus:border-olive-400 dark:focus:ring-olive-400/10"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-6 top-1/2 -mt-3 origin-left text-base text-olive-700 transition-all duration-200 peer-not-placeholder-shown:-translate-y-4 peer-not-placeholder-shown:scale-75 peer-not-placeholder-shown:font-semibold peer-not-placeholder-shown:text-olive-950 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:font-semibold peer-focus:text-olive-950 dark:text-olive-400 dark:peer-not-placeholder-shown:text-white dark:peer-focus:text-white"
      >
        {label}
      </label>
    </div>
  )
})
TextInput.displayName = 'TextInput'

const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<'textarea'> & { label: string }
>(function TextArea({ label, ...props }, ref) {
  const id = useId()

  return (
    <div className="group relative z-0 transition-all focus-within:z-10">
      <textarea
        id={id}
        ref={ref}
        {...props}
        placeholder=" "
        rows={4}
        className="peer block w-full border border-olive-950/10 bg-transparent px-6 pb-4 pt-12 text-base text-olive-950 ring-4 ring-transparent transition group-first:rounded-t-2xl group-last:rounded-b-2xl focus:border-olive-600 focus:outline-none focus:ring-olive-600/10 dark:border-white/10 dark:text-white dark:focus:border-olive-400 dark:focus:ring-olive-400/10"
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-6 top-8 origin-left text-base text-olive-700 transition-all duration-200 peer-not-placeholder-shown:-translate-y-4 peer-not-placeholder-shown:scale-75 peer-not-placeholder-shown:font-semibold peer-not-placeholder-shown:text-olive-950 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:font-semibold peer-focus:text-olive-950 dark:text-olive-400 dark:peer-not-placeholder-shown:text-white dark:peer-focus:text-white"
      >
        {label}
      </label>
    </div>
  )
})
TextArea.displayName = 'TextArea'

export const meta: MetaFunction = () => {
  return [
    {
      title: 'Contact - CaptionA.cc',
      description: 'Get in touch with the CaptionA.cc team.',
    },
  ]
}

interface ContactFormData {
  name: string
  email: string
  company?: string
  message: string
}

export default function Contact() {
  const { register, reset, handleSubmit } = useForm<ContactFormData>()
  const [isSuccess, setIsSuccess] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Get access key from environment variable
  const accessKey = import.meta.env['VITE_WEB3FORMS_ACCESS_KEY'] || ''

  const { submit: onSubmit } = useWeb3Forms({
    access_key: accessKey,
    settings: {
      from_name: 'CaptionA.cc Contact Form',
      subject: 'New Contact Form Submission - CaptionA.cc',
    },
    onSuccess: (_msg) => {
      setIsSuccess(true)
      setResult('Thank you! Your message has been sent successfully.')
      setIsSubmitting(false)
      reset()
    },
    onError: (_msg) => {
      setIsSuccess(false)
      setResult('Sorry, there was an error sending your message. Please try again.')
      setIsSubmitting(false)
    },
  })

  const handleFormSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true)
    setResult(null)
    await onSubmit(data)
  }

  return (
    <>
      <NavbarWithLogoActionsAndLeftAlignedLinks
        logo={
          <a
            href="/"
            className="font-display text-xl font-medium tracking-tight text-olive-950 dark:text-white"
          >
            Caption<span className="font-semibold">A.cc</span>
          </a>
        }
        links={
          <>
            <a
              href="/#how-it-works"
              className="text-sm/7 font-medium text-olive-950 hover:bg-olive-950/10 rounded-full px-3 py-1 dark:text-white dark:hover:bg-white/10"
            >
              How It Works
            </a>
            <a
              href="/#features"
              className="text-sm/7 font-medium text-olive-950 hover:bg-olive-950/10 rounded-full px-3 py-1 dark:text-white dark:hover:bg-white/10"
            >
              Features
            </a>
            <a
              href="/#faq"
              className="text-sm/7 font-medium text-olive-950 hover:bg-olive-950/10 rounded-full px-3 py-1 dark:text-white dark:hover:bg-white/10"
            >
              FAQ
            </a>
          </>
        }
        actions={
          <ButtonLink href="/#waitlist-form" size="lg">
            Join Waitlist
          </ButtonLink>
        }
      />

      <Main>
        <Container className="mt-16 sm:mt-32">
          <header className="max-w-2xl">
            <h1 className="font-display text-4xl font-bold tracking-tight text-olive-950 sm:text-5xl dark:text-white">
              Get in touch
            </h1>
            <p className="mt-6 text-base text-olive-700 dark:text-olive-400">
              Have a question or want to work together? Send us a message and we'll get back to you
              as soon as possible.
            </p>
          </header>

          <div className="mt-16 sm:mt-20">
            <form
              onSubmit={(e) => {
                void handleSubmit(handleFormSubmit)(e)
              }}
              className="max-w-2xl"
            >
              <div className="isolate -space-y-px rounded-2xl bg-white/50 dark:bg-olive-900/50">
                <TextInput
                  label="Name"
                  {...register('name', { required: true })}
                  autoComplete="name"
                />
                <TextInput
                  label="Email"
                  type="email"
                  {...register('email', { required: true })}
                  autoComplete="email"
                />
                <TextInput
                  label="Company (optional)"
                  {...register('company', { required: false })}
                  autoComplete="organization"
                />
                <TextArea label="Message" {...register('message', { required: true })} />
              </div>
              <button
                type="submit"
                className="mt-8 rounded-md bg-olive-950 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-olive-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-950 disabled:opacity-50 dark:bg-olive-300 dark:text-olive-950 dark:hover:bg-olive-200"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Sending...' : 'Send message'}
              </button>
            </form>
            {result && (
              <div
                className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
                  isSuccess
                    ? 'border-olive-500/20 bg-olive-50 text-olive-900 dark:border-olive-400/20 dark:bg-olive-950/20 dark:text-olive-100'
                    : 'border-red-500/20 bg-red-50 text-red-900 dark:border-red-400/20 dark:bg-red-950/20 dark:text-red-100'
                }`}
              >
                {result}
              </div>
            )}
          </div>
        </Container>

        {/* Footer */}
        <FooterWithLinkCategories
          links={
            <>
              <FooterCategory title="Product">
                <FooterLink href="/#features">Features</FooterLink>
                <FooterLink href="/#how-it-works">How It Works</FooterLink>
                <FooterLink href="/#faq">FAQ</FooterLink>
              </FooterCategory>
              <FooterCategory title="Company">
                <FooterLink href="/contact">Contact</FooterLink>
              </FooterCategory>
            </>
          }
          fineprint={
            <>
              <div className="font-display text-xl font-medium tracking-tight text-olive-950 dark:text-white mb-4">
                Caption<span className="font-semibold">A.cc</span>
              </div>
              <p>© 2026 CaptionA.cc. All rights reserved.</p>
            </>
          }
        />
      </Main>
    </>
  )
}
