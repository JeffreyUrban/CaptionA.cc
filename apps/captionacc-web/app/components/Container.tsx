import { forwardRef } from 'react'
// eslint-disable-next-line import/no-named-as-default
import clsx from 'clsx'

export const Container = forwardRef<
  React.ElementRef<'div'>,
  React.ComponentPropsWithoutRef<'div'>
>(function Container({ className, children, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={clsx('mx-auto max-w-7xl px-4 sm:px-6 lg:px-8', className)}
      {...props}
    >
      {children}
    </div>
  )
})

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
