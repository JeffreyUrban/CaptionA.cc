import { Footer } from '~/components/Footer'
import { Header } from '~/components/Header'

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-zinc-900">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
