import clsx from 'clsx'
import { forwardRef } from 'react'

export const Container = forwardRef<React.ElementRef<'div'>, React.ComponentPropsWithoutRef<'div'>>(
  function Container({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={clsx('mx-auto max-w-7xl px-4 sm:px-6 lg:px-8', className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)

// Legacy exports for compatibility
export const ContainerOuter = Container
export const ContainerInner = forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'>
>(function ContainerInner({ className, children, ...props }, ref) {
  return (
    <div ref={ref} className={className} {...props}>
      {children}
    </div>
  )
})
