import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { UploadProgress } from '~/components/UploadProgress'
import { useAuth } from '~/components/auth/AuthProvider'

const navigation = [
  { name: 'Home', href: '/' },
  { name: 'Videos', href: '/videos' },
  { name: 'Admin', href: '/admin' },
]

function SunIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
      />
    </svg>
  )
}

function MoonIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
      />
    </svg>
  )
}

function ComputerIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
      />
    </svg>
  )
}

type Theme = 'light' | 'dark' | 'system'

function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>('system')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    // Get initial theme from localStorage or default to system
    const savedTheme = (localStorage.getItem('theme') as Theme) || 'system'
    setTheme(savedTheme)
    applyTheme(savedTheme)
  }, [])

  const applyTheme = (newTheme: Theme) => {
    const html = document.documentElement

    if (newTheme === 'system') {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      if (systemPrefersDark) {
        html.classList.add('dark')
      } else {
        html.classList.remove('dark')
      }
    } else if (newTheme === 'dark') {
      html.classList.add('dark')
    } else {
      html.classList.remove('dark')
    }
  }

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    applyTheme(newTheme)
    setIsOpen(false)
  }

  const themes = [
    { id: 'light' as Theme, name: 'Light', icon: SunIcon },
    { id: 'dark' as Theme, name: 'Dark', icon: MoonIcon },
    { id: 'system' as Theme, name: 'System', icon: ComputerIcon },
  ] as const

  const currentThemeData = themes.find((t) => t.id === theme) ?? themes[2]
  const CurrentIcon = currentThemeData.icon
  const currentName = currentThemeData.name

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-olive-950 hover:bg-olive-950/10 dark:text-white dark:hover:bg-white/10"
      >
        <CurrentIcon className="h-5 w-5" />
        <span className="hidden sm:inline">{currentName}</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-olive-950/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-olive-900">
            {themes.map((themeOption) => (
              <button
                key={themeOption.id}
                onClick={() => handleThemeChange(themeOption.id)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-sm hover:bg-olive-950/5 dark:hover:bg-white/5 ${
                  theme === themeOption.id
                    ? 'text-olive-600 dark:text-olive-400'
                    : 'text-olive-950 dark:text-white'
                }`}
              >
                <themeOption.icon className="h-5 w-5" />
                <span>{themeOption.name}</span>
                {theme === themeOption.id && (
                  <svg className="ml-auto h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)

  const handleSignOut = async () => {
    await signOut()
    setIsOpen(false)
    navigate('/login')
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
              <Link to="/" className="font-display text-xl font-bold text-olive-950 dark:text-white">
                Caption<span className="font-semibold">A.cc</span>
              </Link>

              <div className="hidden md:flex md:gap-1">
                {navigation.map((item) => {
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
            {navigation.map((item) => {
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
