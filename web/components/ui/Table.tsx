import type { HTMLAttributes, TableHTMLAttributes } from 'react'

export function Table({ className = '', children, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={`w-full border-collapse text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  )
}

export function THead({ className = '', children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`text-left text-xs uppercase tracking-wide text-slate-500 ${className}`} {...props}>
      {children}
    </thead>
  )
}

export function TBody({ className = '', children, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={`divide-y divide-slate-800 ${className}`} {...props}>
      {children}
    </tbody>
  )
}

export function TR({ className = '', children, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`hover:bg-slate-800/40 ${className}`} {...props}>
      {children}
    </tr>
  )
}

export function TH({ className = '', children, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`px-3 py-2.5 font-medium ${className}`} {...props}>
      {children}
    </th>
  )
}

export function TD({ className = '', children, ...props }: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-3 py-2.5 text-slate-300 ${className}`} {...props}>
      {children}
    </td>
  )
}

export default Table
