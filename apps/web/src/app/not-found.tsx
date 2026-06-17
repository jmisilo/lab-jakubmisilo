import Link from "next/link";
import { LuUndo2 } from "react-icons/lu";

const NotFound = () => {
  return (
    <div className="flex justify-center">
      <h1 className="sr-only">Not found</h1>

      <div className="flex flex-col gap-y-3.5 items-center">
        <h2>Nothing is there</h2>

        <Link href="/" className="group inline-flex no-underline!">
          <span className="inline-flex transition-transform duration-200 ease-in-out group-active:scale-95">
            <span className="rounded-full py-2 px-3.5 flex items-center gap-x-1 bg-zinc-200/70 text-[#434242]! group-hover:bg-zinc-200/90 transition-colors duration-125 ease-in-out font-normal!">
              <span className="text-xs leading-none">Back</span>

              <LuUndo2 className="rotate-12 size-3.5 group-hover:translate-x-0.75 active:translate-x-px duration-200 ease-in-out" />
            </span>
          </span>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
