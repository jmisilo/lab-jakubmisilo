'use client';

import type { CSSProperties, FC } from 'react';

import { useEffect, useState } from 'react';

import { cn } from '@labjm/utilities/cn';

import styles from './loading-text.module.css';

type LoadingTextProps = {
  children: string;
  totalAmountOfDots?: number;
  color?: `#${string}`;
};

const ANIMATION_INTERVAL_DURATION = 750;

export const LoadingText: FC<LoadingTextProps> = ({
  children,
  totalAmountOfDots = 3,
  color = '#333333',
}) => {
  const [amountOfDots, setAmountOfDots] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setAmountOfDots((prev) => {
        if (prev < totalAmountOfDots) {
          return prev + 1;
        }

        return 0;
      });
    }, ANIMATION_INTERVAL_DURATION);

    return () => clearInterval(interval);
  }, [totalAmountOfDots]);

  return (
    <div
      className={cn(styles.animatedGradientText, 'text-sm font-medium')}
      style={
        {
          animationDuration: `${2 * ANIMATION_INTERVAL_DURATION * (totalAmountOfDots + 1)}ms`,
          '--text-primary': color,
        } as CSSProperties
      }
    >
      <span>{children}</span>

      {Array(totalAmountOfDots)
        .fill(0)
        .map((_, index) => (
          <span
            key={`dot-${index}`}
            className={cn('tracking-wide', {
              'opacity-0': index >= amountOfDots,
            })}
          >
            .
          </span>
        ))}
    </div>
  );
};
