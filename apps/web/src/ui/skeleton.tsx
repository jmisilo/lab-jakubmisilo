import { cn } from 'cnfast';
import { type FC, type HTMLAttributes } from 'react';

type SkeletonProps = HTMLAttributes<HTMLDivElement> & { bgColor?: string };

export const Skeleton: FC<SkeletonProps> = (props) => {
  return (
    <div
      {...props}
      className={cn(props.className, props.bgColor ?? 'bg-black/6', 'animate-pulse rounded-sm')}
    />
  );
};
