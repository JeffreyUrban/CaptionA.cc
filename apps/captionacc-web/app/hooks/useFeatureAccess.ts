/**
 * Feature Access Hook
 *
 * Client-side hook for checking feature access based on user's access tier.
 * This is for UX only - actual enforcement happens server-side.
 */

import { useEffect, useState } from 'react'

import { useAuth } from '~/components/auth/AuthProvider'

/**
 * Check if current user has access to a feature
 * Updates when user or feature changes
 *
 * @param feature - Feature to check (annotation, export, upload)
 * @returns Object with hasAccess and loading state
 *
 * @example
 * const { hasAccess, loading } = useFeatureAccess('annotation')
 * if (!hasAccess) return <UpgradePrompt />
 */
export function useFeatureAccess(feature: string) {
  const { user } = useAuth()
  const [hasAccess, setHasAccess] = useState<boolean>(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setHasAccess(false)
      setLoading(false)
      return
    }

    const checkAccess = async () => {
      try {
        const response = await fetch(`/api/auth/feature-access?feature=${feature}`)
        const data = await response.json()
        setHasAccess(data.hasAccess ?? false)
      } catch (error) {
        console.error('Failed to check feature access:', error)
        setHasAccess(false)
      } finally {
        setLoading(false)
      }
    }

    void checkAccess()
  }, [user, feature])

  return { hasAccess, loading }
}
