/**
 * Login Form Component
 *
 * Provides email/password authentication with Supabase.
 */

import { useState } from 'react'

import { signIn } from '../../services/supabase-client'
import { Button } from '../Button'

interface LoginFormProps {
  onSuccess?: () => void
  onSwitchToSignUp?: () => void
}

export function LoginForm({ onSuccess: _onSuccess, onSwitchToSignUp }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await signIn(email, password)
      // Redirect to videos page after successful login
      window.location.href = '/videos'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white dark:bg-olive-900 shadow-md rounded-lg px-8 pt-6 pb-8 mb-4">
        <h2 className="text-2xl font-bold mb-6 text-center text-olive-950 dark:text-white">
          Sign In
        </h2>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 dark:bg-red-950/20 dark:border-red-400/20 dark:text-red-100">
            {error}
          </div>
        )}

        <form onSubmit={e => void handleSubmit(e)}>
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
              disabled={loading}
            />
          </div>

          <div className="flex items-center justify-between mb-4">
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </div>
        </form>

        {onSwitchToSignUp && (
          <div className="text-center">
            <button
              onClick={onSwitchToSignUp}
              className="text-olive-600 hover:text-olive-700 dark:text-olive-400 dark:hover:text-olive-300 text-sm"
              type="button"
            >
              Don&apos;t have an account? Sign up
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
