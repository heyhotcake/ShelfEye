import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: 'ITEM_PRESENT' | 'EMPTY' | 'CHECKED_OUT' | 'TRAINING_ERROR' | 'OCCUPIED_NO_QR';
  className?: string;
  children?: React.ReactNode;
}

export function StatusBadge({ status, className, children }: StatusBadgeProps) {
  const variants = {
    'ITEM_PRESENT': 'bg-green-500/20 text-green-500 border-green-500/30',
    'EMPTY': 'bg-red-500/20 text-red-500 border-red-500/30', 
    'CHECKED_OUT': 'bg-blue-500/20 text-blue-500 border-blue-500/30',
    'TRAINING_ERROR': 'bg-purple-500/20 text-purple-500 border-purple-500/30',
    'OCCUPIED_NO_QR': 'bg-amber-500/20 text-amber-500 border-amber-500/30',
  };

  const labels = {
    'ITEM_PRESENT': 'Present',
    'EMPTY': 'Empty',
    'CHECKED_OUT': 'Checked Out', 
    'TRAINING_ERROR': 'Error',
    'OCCUPIED_NO_QR': 'Occupied No QR',
  };

  return (
    <span 
      className={cn(
        "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border",
        variants[status],
        className
      )}
      data-testid={`status-badge-${status.toLowerCase().replace(/_/g, '-')}`}
    >
      {children || labels[status]}
    </span>
  );
}
