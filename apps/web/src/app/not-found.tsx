import Link from 'next/link';
import { LuUndo2 } from 'react-icons/lu';

const NotFound = () => {
  return (
    <div className="flex justify-center">
      <h1 className="sr-only">Not found</h1>

      <div className="flex flex-col items-center gap-y-3.5">
        <h2>Nothing is there</h2>

        <Link href="/" className="group inline-flex no-underline!">
          <span className="inline-flex transition-transform duration-200 ease-in-out group-active:scale-95">
            <span className="flex items-center gap-x-1 rounded-full bg-zinc-200/70 px-3.5 py-2 font-normal! text-[#434242]! transition-colors duration-125 ease-in-out group-hover:bg-zinc-200/90">
              <span className="text-xs leading-none">Back</span>

              <LuUndo2 className="size-3.5 rotate-12 duration-200 ease-in-out group-hover:translate-x-0.75 active:translate-x-px" />
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
