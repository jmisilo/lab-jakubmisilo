import Link from "next/link";
import { AIWidget } from "./_components/ai-widget";
import { LuCornerUpLeft } from "react-icons/lu";
import { Suspense } from "react";
import { Skeleton } from "@/ui/skeleton";

const AIWidgetPage = () => {
  return (
    <>
      <div className="flex gap-x-1.5">
        <Link href="/" className="group inline-flex no-underline!">
          <span className="inline-flex transition-transform duration-200 ease-in-out group-active:scale-95">
            <span className="rounded-full py-2 px-3.5 flex items-center gap-x-1.5 bg-zinc-200/70 text-[#434242]! group-hover:bg-zinc-200/90 transition-colors duration-125 ease-in-out font-normal!">
              <LuCornerUpLeft className="size-3.5" />

              <span className="text-xs leading-none">Back</span>
            </span>
          </span>
        </Link>
      </div>

      <div className="fixed bottom-[min(16rem,12vh)] inset-x-0 w-full flex justify-center max-w-full px-5">
        <Suspense
          fallback={<Skeleton className="w-87.5 h-13.5 rounded-full!" />}
        >
          <AIWidget />
        </Suspense>
      </div>
    </>
  );
};

export default AIWidgetPage;
