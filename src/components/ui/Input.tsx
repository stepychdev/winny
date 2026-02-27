import React from 'react';
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}
export function Input({
  label,
  error,
  icon,
  className = '',
  ...props
}: InputProps) {
  return (
    <div className="w-full">
      {label &&
      <label className="block text-xs font-display font-medium text-gray-400 mb-1.5 uppercase tracking-wider">
          {label}
        </label>
      }
      <div className="relative group">
        {icon &&
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-purple-400 transition-colors">
            {icon}
          </div>
        }
        <input
          className={`
            w-full bg-[#0a0a12] border border-white/10 rounded-lg 
            ${icon ? 'pl-10' : 'pl-4'} pr-4 py-3
            text-white placeholder-gray-600 font-sans
            focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            ${error ? 'border-red-500/50 focus:border-red-500' : ''}
            ${className}
          `}
          {...props} />

      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>);

}