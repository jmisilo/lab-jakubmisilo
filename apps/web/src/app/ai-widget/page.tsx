import Link from 'next/link';
import { Suspense } from 'react';
import { LuCornerUpLeft } from 'react-icons/lu';

import { Skeleton } from '@/ui/skeleton';

import { AIWidget } from './_components/ai-widget';

const AIWidgetPage = () => {
  return (
    <>
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

      <div className="fixed inset-x-0 bottom-[min(16rem,12vh)] flex w-full max-w-full justify-center px-5">
        <Suspense fallback={<Skeleton className="h-13.5 w-87.5 rounded-full!" />}>
          <AIWidget />
        </Suspense>
      </div>
    </>
  );
};

export default AIWidgetPage;
