import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { ThemeSwitcher } from '~/components/ThemeSwitcher'
import { UploadProgress } from '~/components/UploadProgress'
import { useAuth } from '~/components/auth/AuthProvider'

const navigation = [
  { name: 'Home', href: '/' },
  { name: 'Videos', href: '/videos' },
]

function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    setIsOpen(false)
    void navigate('/login')
  }

  if (!user) {
    return (
      <Link
        to="/login"
        className="rounded-lg px-3 py-2 text-sm font-medium text-olive-950 hover:bg-olive-950/10 dark:text-white dark:hover:bg-white/10"
      >
        Sign In
      </Link>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-olive-950 hover:bg-olive-950/10 dark:text-white dark:hover:bg-white/10"
      >
        <div className="h-8 w-8 rounded-full bg-olive-600 flex items-center justify-center text-white dark:bg-olive-400 dark:text-olive-950">
          {user.email?.[0]?.toUpperCase() ?? 'U'}
        </div>
        <span className="hidden sm:inline">{user.email}</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-olive-950/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-olive-900">
            <div className="px-4 py-2 text-sm text-olive-950 dark:text-white border-b border-olive-950/10 dark:border-white/10">
              <div className="font-medium truncate">{user.email}</div>
            </div>
            <button
              onClick={() => void handleSignOut()}
              className="flex w-full items-center gap-3 px-4 py-2 text-sm text-olive-950 hover:bg-olive-950/5 dark:text-white dark:hover:bg-white/5"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"
                />
              </svg>
              Sign Out
            </button>
          </div>
        </>
      )}
    </div>
  )
}

interface AppLayoutProps {
  children: React.ReactNode
  fullScreen?: boolean
}

export function AppLayout({ children, fullScreen = false }: AppLayoutProps) {
  const location = useLocation()
  const { session } = useAuth()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)

  // Fetch admin status client-side when user is authenticated
  useEffect(() => {
    async function checkAdminStatus() {
      if (!session?.access_token) {
        setIsPlatformAdmin(false)
        return
      }

      try {
        const response = await fetch('/api/auth/is-platform-admin', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        })
        const data = (await response.json()) as { isPlatformAdmin: boolean }
        setIsPlatformAdmin(data.isPlatformAdmin)
      } catch (error) {
        console.error('Failed to check admin status:', error)
        setIsPlatformAdmin(false)
      }
    }

    void checkAdminStatus()
  }, [session?.access_token])

  // Build navigation items dynamically
  const navItems = [...navigation]
  if (isPlatformAdmin) {
    navItems.push({ name: 'Admin', href: '/admin' })
  }

  return (
    <div
      className={`min-h-screen bg-olive-100 dark:bg-olive-950 ${fullScreen ? 'h-screen overflow-hidden' : ''}`}
    >
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-40 border-b border-olive-950/10 bg-white dark:border-white/10 dark:bg-olive-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo and Navigation */}
            <div className="flex items-center gap-8">
              <Link
                to="/"
                className="font-display text-xl font-bold text-olive-950 dark:text-white"
              >
                Caption<span className="font-semibold">A.cc</span>
              </Link>

              <div className="hidden md:flex md:gap-1">
                {navItems.map(item => {
                  const isActive = location.pathname === item.href
                  return (
                    <Link
                      key={item.name}
                      to={item.href}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-olive-950/10 text-olive-600 dark:bg-white/10 dark:text-olive-400'
                          : 'text-olive-950 hover:bg-olive-950/5 hover:text-olive-600 dark:text-white dark:hover:bg-white/5 dark:hover:text-olive-400'
                      }`}
                    >
                      {item.name}
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* Upload Progress, Theme Switcher & User Menu */}
            <div className="flex items-center gap-2">
              <UploadProgress />
              <ThemeSwitcher />
              <UserMenu />
            </div>
          </div>

          {/* Mobile Navigation */}
          <div className="flex gap-1 pb-3 md:hidden">
            {navItems.map(item => {
              const isActive = location.pathname === item.href
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-olive-950/10 text-olive-600 dark:bg-white/10 dark:text-olive-400'
                      : 'text-olive-950 hover:bg-olive-950/5 hover:text-olive-600 dark:text-white dark:hover:bg-white/5 dark:hover:text-olive-400'
                  }`}
                >
                  {item.name}
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className={fullScreen ? '' : 'py-8'}>
        <div className={fullScreen ? '' : 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8'}>{children}</div>
      </main>
    </div>
  )
}
