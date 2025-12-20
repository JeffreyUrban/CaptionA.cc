'use client'

import { useId, useState, forwardRef } from 'react'
import { MetaFunction } from 'react-router'
import { useForm } from 'react-hook-form'
import useWeb3Forms from '@web3forms/react'
import { SimpleLayout } from '~/components/SimpleLayout'
import { Button } from '~/components/Button'

const TextInput = forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<'input'> & { label: string }>(
    function TextInput({ label, ...props }, ref) {
        const id = useId()

        return (
            <div className="group relative z-0 transition-all focus-within:z-10">
                <input
                    type="text"
                    id={id}
                    ref={ref}
                    {...props}
                    placeholder=" "
                    className="peer block w-full border border-zinc-200 bg-transparent px-6 pb-4 pt-12 text-base text-zinc-900 ring-4 ring-transparent transition group-first:rounded-t-2xl group-last:rounded-b-2xl focus:border-teal-500 focus:outline-none focus:ring-teal-500/10 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-teal-400 dark:focus:ring-teal-400/10"
                />
                <label
                    htmlFor={id}
                    className="pointer-events-none absolute left-6 top-1/2 -mt-3 origin-left text-base text-zinc-500 transition-all duration-200 peer-not-placeholder-shown:-translate-y-4 peer-not-placeholder-shown:scale-75 peer-not-placeholder-shown:font-semibold peer-not-placeholder-shown:text-zinc-900 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:font-semibold peer-focus:text-zinc-900 dark:text-zinc-400 dark:peer-not-placeholder-shown:text-zinc-100 dark:peer-focus:text-zinc-100"
                >
                    {label}
                </label>
            </div>
        )
    }
)
TextInput.displayName = 'TextInput'

const TextArea = forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'> & { label: string }>(
    function TextArea({ label, ...props }, ref) {
        const id = useId()

        return (
            <div className="group relative z-0 transition-all focus-within:z-10">
                <textarea
                    id={id}
                    ref={ref}
                    {...props}
                    placeholder=" "
                    rows={4}
                    className="peer block w-full border border-zinc-200 bg-transparent px-6 pb-4 pt-12 text-base text-zinc-900 ring-4 ring-transparent transition group-first:rounded-t-2xl group-last:rounded-b-2xl focus:border-teal-500 focus:outline-none focus:ring-teal-500/10 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-teal-400 dark:focus:ring-teal-400/10"
                />
                <label
                    htmlFor={id}
                    className="pointer-events-none absolute left-6 top-8 origin-left text-base text-zinc-500 transition-all duration-200 peer-not-placeholder-shown:-translate-y-4 peer-not-placeholder-shown:scale-75 peer-not-placeholder-shown:font-semibold peer-not-placeholder-shown:text-zinc-900 peer-focus:-translate-y-4 peer-focus:scale-75 peer-focus:font-semibold peer-focus:text-zinc-900 dark:text-zinc-400 dark:peer-not-placeholder-shown:text-zinc-100 dark:peer-focus:text-zinc-100"
                >
                    {label}
                </label>
            </div>
        )
    }
)
TextArea.displayName = 'TextArea'

export const meta: MetaFunction = () => {
    return [
        {
            title: 'Contact',
            description: 'Get in touch.',
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

    // Replace with your own Web3Forms access key from https://web3forms.com
    const accessKey = 'YOUR_WEB3FORMS_ACCESS_KEY'

    const { submit: onSubmit } = useWeb3Forms({
        access_key: accessKey,
        settings: {
            from_name: 'Contact Form',
            subject: 'New Contact Form Submission',
        },
        onSuccess: (msg) => {
            setIsSuccess(true)
            setResult(msg)
            setIsSubmitting(false)
            reset()
        },
        onError: (msg) => {
            setIsSuccess(false)
            setResult(msg)
            setIsSubmitting(false)
        },
    })

    const handleFormSubmit = async (data: ContactFormData) => {
        setIsSubmitting(true)
        setResult(null)
        await onSubmit(data)
    }

    return (
        <SimpleLayout
            title="Get in touch"
            intro="Have a question or want to work together? Send me a message and I'll get back to you as soon as possible."
        >
            <div className="mt-16 sm:mt-20">
                <form onSubmit={handleSubmit(handleFormSubmit)} className="max-w-2xl">
                    <div className="isolate -space-y-px rounded-2xl bg-white/50 dark:bg-zinc-800/50">
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
                        <TextArea
                            label="Message"
                            {...register('message', { required: true })}
                        />
                    </div>
                    <Button type="submit" className="mt-8" disabled={isSubmitting}>
                        {isSubmitting ? 'Sending...' : 'Send message'}
                    </Button>
                </form>
                {result && (
                    <div
                        className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
                            isSuccess
                                ? 'border-teal-500/20 bg-teal-50 text-teal-900 dark:border-teal-400/20 dark:bg-teal-950/20 dark:text-teal-100'
                                : 'border-red-500/20 bg-red-50 text-red-900 dark:border-red-400/20 dark:bg-red-950/20 dark:text-red-100'
                        }`}
                    >
                        {result}
                    </div>
                )}
            </div>
        </SimpleLayout>
    )
}
