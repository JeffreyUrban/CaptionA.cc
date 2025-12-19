import { Link } from 'react-router'
import { Container } from '~/components/Container'
import featureFlags from "~/config/featureFlags"

export function Footer() {
  return (
    <footer className="mt-32 border-t border-zinc-200 dark:border-zinc-800">
      <Container>
        <div className="flex flex-col items-center justify-between gap-4 py-8 sm:flex-row">
          {/* Navigation Links */}
          {(featureFlags.showContact) && (
            <nav className="flex gap-6">
              <Link
                to="/"
                className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Home
              </Link>
              {featureFlags.showContact && (
                <Link
                  to="/contact"
                  className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Contact
                </Link>
              )}
            </nav>
          )}

          {/* Copyright */}
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            &copy; {new Date().getFullYear()} All rights reserved.
          </p>
        </div>
      </Container>
    </footer>
  )
}
