import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  dark?: boolean;
}

export function Card({
  children,
  className = '',
  hover = false,
  dark = false,
  ...props
}: CardProps) {
  const base = 'rounded-xl overflow-hidden transition-all duration-200';
  const bg = dark
    ? 'bg-slate-900 text-white'
    : 'bento-card shadow-soft border border-slate-100 dark:border-slate-700';
  const hoverStyle = hover
    ? 'hover:-translate-y-1 hover:shadow-glow'
    : '';

  return (
    <div className={`${base} ${bg} ${hoverStyle} ${className}`} {...props}>
      {children}
    </div>
  );
}
