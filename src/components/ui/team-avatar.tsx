import type { CSSProperties } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function TeamAvatar({
  name,
  initials,
  avatarUrl,
  className,
  fallbackClassName,
  style,
}: {
  name: string;
  initials: string;
  avatarUrl?: string;
  className?: string;
  fallbackClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <Avatar className={cn("tb-hover-icon", className)} style={style}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} className="object-cover" />}
      <AvatarFallback className={cn("text-xs font-semibold", fallbackClassName)}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
