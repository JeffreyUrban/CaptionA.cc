/**
 * Sign Up Form Component
 *
 * Provides user registration with email/password.
 */

import { useState } from 'react'

import { signUp } from '../../services/supabase-client'
import { Button } from '../Button'

interface SignUpFormProps {
  onSuccess?: () => void
  onSwitchToLogin?: () => void
}

export function SignUpForm({ onSuccess, onSwitchToLogin }: SignUpFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Validate invite code first
      if (!inviteCode || inviteCode.trim().length === 0) {
        throw new Error('Invite code is required')
      }

      // Sign up with Supabase Auth
      const { user } = await signUp(email, password, { full_name: fullName })

      if (!user) {
        throw new Error('Signup failed - no user returned')
      }

      // Complete signup with invite code (creates tenant and profile)
      const response = await fetch('/api/auth/complete-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          fullName,
          inviteCode: inviteCode.trim().toUpperCase(),
        }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to complete signup')
      }

      setSuccess(true)
      setTimeout(() => {
        onSuccess?.()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-white dark:bg-olive-900 shadow-md rounded-lg px-8 pt-6 pb-8">
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded dark:bg-green-950/20 dark:border-green-400/20 dark:text-green-100">
            <p className="font-bold">Success!</p>
            <p className="text-sm">Please check your email to confirm your account.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white dark:bg-olive-900 shadow-md rounded-lg px-8 pt-6 pb-8 mb-4">
        <h2 className="text-2xl font-bold mb-6 text-center text-olive-950 dark:text-white">
          Sign Up
        </h2>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 dark:bg-red-950/20 dark:border-red-400/20 dark:text-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-olive-950 dark:text-white text-sm font-bold mb-2" htmlFor="inviteCode">
              Invite Code
            </label>
            <input
              id="inviteCode"
              type="text"
              value={inviteCode}
              onChange={e => setInviteCode(e.target.value.toUpperCase())}
              className="shadow appearance-none border border-olive-950/10 dark:border-white/10 rounded w-full py-2 px-3 text-olive-950 dark:text-white bg-white dark:bg-olive-950 leading-tight focus:outline-none focus:border-olive-600 dark:focus:border-olive-400 font-mono"
              placeholder="PREVIEW-XXXXXXXX"
              required
              disabled={loading}
            />
            <p className="text-olive-700 dark:text-olive-400 text-xs mt-1">
              CaptionA.cc is currently invite-only. Enter your invite code to sign up.
            </p>
          </div>

          <div className="mb-4">
            <label
              className="block text-olive-950 dark:text-white text-sm font-bold mb-2"
              htmlFor="fullName"
            >
              Full Name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="shadow appearance-none border border-olive-950/10 dark:border-white/10 rounded w-full py-2 px-3 text-olive-950 dark:text-white bg-white dark:bg-olive-950 leading-tight focus:outline-none focus:border-olive-600 dark:focus:border-olive-400"
              placeholder="John Doe"
              required
              disabled={loading}
            />
          </div>

          <div className="mb-4">
            <label
              className="block text-olive-950 dark:text-white text-sm font-bold mb-2"
              htmlFor="email"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="shadow appearance-none border border-olive-950/10 dark:border-white/10 rounded w-full py-2 px-3 text-olive-950 dark:text-white bg-white dark:bg-olive-950 leading-tight focus:outline-none focus:border-olive-600 dark:focus:border-olive-400"
              placeholder="you@example.com"
              required
              disabled={loading}
            />
          </div>

          <div className="mb-6">
            <label
              className="block text-olive-950 dark:text-white text-sm font-bold mb-2"
              htmlFor="password"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="shadow appearance-none border border-olive-950/10 dark:border-white/10 rounded w-full py-2 px-3 text-olive-950 dark:text-white bg-white dark:bg-olive-950 leading-tight focus:outline-none focus:border-olive-600 dark:focus:border-olive-400"
              placeholder="••••••••"
              required
              minLength={6}
              disabled={loading}
            />
            <p className="text-olive-700 dark:text-olive-400 text-xs mt-1">
              Password must be at least 6 characters
            </p>
          </div>

          <div className="flex items-center justify-between mb-4">
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Creating account...' : 'Sign Up'}
            </Button>
          </div>
        </form>

        {onSwitchToLogin && (
          <div className="text-center">
            <button
              onClick={onSwitchToLogin}
              className="text-olive-600 hover:text-olive-700 dark:text-olive-400 dark:hover:text-olive-300 text-sm"
              type="button"
            >
              Already have an account? Sign in
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
