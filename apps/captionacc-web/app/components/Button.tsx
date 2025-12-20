import { Link } from 'react-router'
// eslint-disable-next-line import/no-named-as-default
import clsx from 'clsx'
import type React from 'react'

type ButtonPropsBase = {
  variant?: 'primary' | 'secondary'
  className?: string
}

type ButtonAsButton = ButtonPropsBase &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
    to?: never
  }

type ButtonAsLink = ButtonPropsBase &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
    to: string
  }

type ButtonProps = ButtonAsButton | ButtonAsLink

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2'

  const variantStyles = {
    primary: 'bg-teal-500 text-white hover:bg-teal-600 focus:ring-teal-500',
    secondary: 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 focus:ring-zinc-500 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
  }

  const combinedClassName = clsx(baseStyles, variantStyles[variant], className)

  if ('to' in props && props.to) {
    const { to, ...linkProps } = props
    return <Link to={to} {...linkProps} className={combinedClassName} />
  }

  return <button {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)} className={combinedClassName} />
}
