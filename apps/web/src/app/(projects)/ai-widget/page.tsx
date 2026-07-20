import { Suspense } from 'react';

import { Skeleton } from '@/ui/skeleton';

import { AIWidget } from './_components/ai-widget';

const AIWidgetPage = () => {
  return (
    <div className="fixed inset-x-0 bottom-[min(16rem,12vh)] flex w-full max-w-full justify-center px-5">
      <Suspense fallback={<Skeleton className="h-13.5 w-87.5 rounded-full!" />}>
        <AIWidget />
      </Suspense>
    </div>
  );
};

export default AIWidgetPage;
