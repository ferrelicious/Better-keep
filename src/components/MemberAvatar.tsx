import { getInitials } from '../services/profiles';

interface MemberAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<MemberAvatarProps['size']>, string> = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-7 h-7 text-[11px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-14 h-14 text-base',
};

export function MemberAvatar({
  name,
  avatarUrl,
  size = 'sm',
  className = '',
}: MemberAvatarProps) {
  const sizeClass = SIZE_CLASSES[size];
  const initials = getInitials(name);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${sizeClass} rounded-full object-cover shrink-0 border border-[#18221C]/15 dark:border-[#E3EAE5]/20 bg-[#ECEFE9] dark:bg-[#212723] ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${sizeClass} rounded-full shrink-0 inline-flex items-center justify-center font-bold bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9] border border-[#2E6B4E]/15 dark:border-[#8FD4AE]/20 select-none ${className}`}
    >
      {initials}
    </span>
  );
}
