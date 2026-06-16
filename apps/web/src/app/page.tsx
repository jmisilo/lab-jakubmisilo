import { Suspense } from "react";

import { ApiStatus } from "./_components/api-status";

const HomePage = () => {
  return (
    <main className="relative mx-auto flex max-w-120 flex-col gap-y-11 overflow-hidden px-5 sm:max-w-140 md:max-w-152">
      <div className="flex flex-col gap-y-4">
        <header className="flex flex-col gap-y-1.5">
          <h1>Lab JM</h1>

          <p>Place to experiment.</p>
        </header>
        <Suspense fallback={<ApiStatus.Skeleton />}>
          <ApiStatus />
        </Suspense>
      </div>
    </main>
  );
};

export default HomePage;
