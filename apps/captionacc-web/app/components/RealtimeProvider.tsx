/**
 * Realtime Provider
 *
 * Sets up Supabase Realtime subscriptions that persist across navigation.
 * This component mounts once at app startup and maintains subscriptions
 * for the entire session.
 */

import { useEffect } from 'react'
import { useRevalidator } from 'react-router'
import { supabase } from '~/services/supabase-client'

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const revalidator = useRevalidator()

  useEffect(() => {
    console.log('[Realtime] Setting up Supabase Realtime subscriptions')

    // Subscribe to videos table changes
    const videosChannel = supabase
      .channel('videos-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'captionacc_prod',
          table: 'videos',
        },
        payload => {
          console.log(
            '[Realtime] Videos table change detected:',
            payload.eventType,
            payload.new?.id
          )
          // Revalidate to refetch data on current page
          void revalidator.revalidate()
        }
      )
      .subscribe(status => {
        console.log('[Realtime] Videos subscription status:', status)
      })

    return () => {
      console.log('[Realtime] Cleaning up Supabase Realtime subscriptions')
      void supabase.removeChannel(videosChannel)
    }
    // Empty deps - subscription persists for app lifetime, revalidator captured in closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <>{children}</>
}
