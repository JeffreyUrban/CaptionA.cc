import { Link } from 'react-router'
import { useTheme } from "~/providers"
import { Container } from '~/components/Container'
import featureFlags from "~/config/featureFlags"

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}

export function Header() {
  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <Container>
        <div className="flex items-center justify-between py-4">
          {/* Logo/Home Link */}
          <Link
            to="/"
            className="text-xl font-bold text-zinc-900 dark:text-zinc-100 hover:text-teal-500 dark:hover:text-teal-400"
          >
            Logo
          </Link>

          {/* Navigation */}
          <nav className="flex items-center gap-6">
            <Link
              to="/"
              className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Home
            </Link>
            {featureFlags.showContact && (
              <Link
                to="/contact"
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Contact
              </Link>
            )}
            <ThemeToggle />
          </nav>
        </div>
      </Container>
    </header>
  )
}
