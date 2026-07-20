import type { FC, PropsWithChildren } from 'react';

import Link from 'next/link';
import { LuCornerUpLeft } from 'react-icons/lu';

const ProjectsLayout: FC<PropsWithChildren> = ({ children }) => {
  return (
    <div className="relative mx-auto flex max-w-120 flex-col gap-y-11 overflow-hidden px-5 sm:max-w-140 md:max-w-152">
      <div className="flex gap-x-1.5">
        <Link href="/" className="group inline-flex no-underline!">
          <span className="inline-flex transition-transform duration-200 ease-in-out group-active:scale-95">
            <span className="flex items-center gap-x-1.5 rounded-full bg-zinc-200/70 px-3.5 py-2 font-normal! text-[#434242]! transition-colors duration-125 ease-in-out group-hover:bg-zinc-200/90">
              <LuCornerUpLeft className="size-3.5" />

              <span className="text-xs leading-none">Back</span>
            </span>
          </span>
        </Link>
      </div>

      {children}
    </div>
  );
};

export default ProjectsLayout;
