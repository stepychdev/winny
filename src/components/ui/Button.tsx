import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  glow?: boolean;
}

export function Button({
  children,
  className = '',
  variant = 'primary',
  size = 'md',
  isLoading = false,
  glow = false,
  disabled,
  ...props
}: ButtonProps) {
  const base =
    'relative inline-flex items-center justify-center font-bold transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary:
      'bg-primary text-white hover:bg-primary/90 rounded-xl shadow-lg shadow-primary/25',
    secondary:
      'bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-800 dark:hover:bg-slate-600 rounded-full',
    outline:
      'bg-transparent border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-full',
    ghost:
      'bg-transparent text-slate-500 dark:text-slate-400 hover:text-primary hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg',
    danger:
      'bg-red-600 text-white hover:bg-red-500 rounded-xl',
  };

  const sizes = {
    sm: 'px-4 py-2 text-xs',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-8 py-4 text-base',
  };

  const glowStyle = glow ? 'shadow-glow' : '';

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${glowStyle} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      <span className="flex items-center gap-2">{children}</span>
    </button>
  );
}
