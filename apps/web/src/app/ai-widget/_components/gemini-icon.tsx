"use client";

import type { FC } from "react";

type GeminiIconProps = {
  className?: string;
};

export const GeminiIcon: FC<GeminiIconProps> = ({ className }) => {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 192 192"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#4285F4"
        d="M96 8c4.6 18.2 10.6 32.9 18.1 44.2 7.5 11.3 18.3 19.9 32.5 25.8 9.5 4 21.9 7.7 37.4 11.1-18.2 4.6-32.9 10.6-44.2 18.1-11.3 7.5-19.9 18.3-25.8 32.5-4 9.5-7.7 21.9-11.1 37.4-4.6-18.2-10.6-32.9-18.1-44.2-7.5-11.3-18.3-19.9-32.5-25.8-9.5-4-21.9-7.7-37.4-11.1 18.2-4.6 32.9-10.6 44.2-18.1 11.3-7.5 19.9-18.3 25.8-32.5C88.9 35.9 92.6 23.5 96 8Z"
      />
    </svg>
  );
};
