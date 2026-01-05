import { useEffect } from 'react'
import { useNavigate } from 'react-router'

import { useAuth } from '~/components/auth/AuthProvider'
import { LoginForm } from '~/components/auth/LoginForm'

export default function LoginPage() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  // Redirect to home if already logged in
  useEffect(() => {
    if (!loading && user) {
      void navigate('/')
    }
  }, [user, loading, navigate])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">CaptionA.cc</h1>
          <p className="text-gray-600 dark:text-gray-400">Caption Annotation Platform</p>
        </div>
        <LoginForm
          onSuccess={() => void navigate('/')}
          onSwitchToSignUp={() => void navigate('/signup')}
        />
      </div>
    </div>
  )
}
