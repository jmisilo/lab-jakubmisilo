import { connection } from "next/server";
import { Skeleton } from "./skeleton";
import { LuArrowUpRight } from "react-icons/lu";

export const Footer = async () => {
  await connection();

  return (
    <footer className="text-sm text-zinc-400 flex items-center gap-x- justify-between">
      <div className="flex items-center gap-x-[0.5ch]">
        <a
          href="https://jakubmisilo.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          © Jakub Misiło
        </a>

        <span>{new Date().getFullYear()}</span>
      </div>

      <div className="flex items-center gap-x-">
        <a
          href="https://github.com/jmisilo/lab-jakubmisilo/"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors duration-125 ease-in-out text-zinc-400 hover:text-zinc-600"
        >
          <span>Code</span>

          <LuArrowUpRight className="text-base inline-block" />
        </a>
      </div>
    </footer>
  );
};

const FooterSkeleton = () => {
  return (
    <footer className="text-sm text-zinc-400 flex items-center gap-x-[0.5ch]">
      <a
        href="https://jakubmisilo.com"
        target="_blank"
        rel="noopener noreferrer"
      >
        © Jakub Misiło
      </a>
      <Skeleton className="h-4.5 w-10 inline-block" />
    </footer>
  );
};

Footer.Skeleton = FooterSkeleton;
