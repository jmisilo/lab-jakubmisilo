import { connection } from 'next/server';
import { LuArrowUpRight } from 'react-icons/lu';

import { Skeleton } from './skeleton';

export const Footer = async () => {
  await connection();

  return (
    <footer className="gap-x- flex items-center justify-between text-sm text-zinc-400">
      <div className="flex items-center gap-x-[0.5ch]">
        <a href="https://jakubmisilo.com" target="_blank" rel="noopener noreferrer">
          © Jakub Misiło
        </a>

        <span>{new Date().getFullYear()}</span>
      </div>

      <div className="gap-x- flex items-center">
        <a
          href="https://github.com/jmisilo/lab-jakubmisilo/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-400 transition-colors duration-125 ease-in-out hover:text-zinc-600"
        >
          <span>Code</span>

          <LuArrowUpRight className="inline-block text-base" />
        </a>
      </div>
    </footer>
  );
};

const FooterSkeleton = () => {
  return (
    <footer className="flex items-center gap-x-[0.5ch] text-sm text-zinc-400">
      <a href="https://jakubmisilo.com" target="_blank" rel="noopener noreferrer">
        © Jakub Misiło
      </a>
      <Skeleton className="inline-block h-4.5 w-10" />
    </footer>
  );
};

Footer.Skeleton = FooterSkeleton;
