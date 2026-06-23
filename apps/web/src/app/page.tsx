import Link from 'next/link';
import { Suspense } from 'react';
import { LuArrowUpRight } from 'react-icons/lu';

import { ApiStatus } from './_components/api-status';

const PROJECTS = [
  {
    title: 'Extendable AI Widget',
    headline: 'Extendable AI widget component',
    href: '/ai-widget',
    tag: 'latest',
  },
  {
    title: 'CLIPxGPT Captioner',
    headline: 'My Image Captioning Model based on CLIP & GPT-2',
    href: 'https://github.com/jmisilo/clip-gpt-captioning',
    tag: 'AI model',
  },
  {
    title: 'Pagey',
    headline: 'Fastest personal page builder',
    href: 'https://pagey.xyz?utm_source=lab.jakubmisilo.com',
    tag: 'worth checking!',
  },
  {
    title: 'knmstudio',
    headline: 'Product design & dev studio',
    href: 'https://knmstudio.com?utm_source=lab.jakubmisilo.com',
  },
  {
    title: 'AI SDK Directory',
    headline: 'List of Vercel AI SDK projects & tools',
    href: 'https://aisdk.directory?utm_source=lab.jakubmisilo.com',
  },
];

const HomePage = () => {
  return (
    <main className="relative mx-auto flex max-w-120 flex-col gap-y-11 overflow-hidden px-5 sm:max-w-140 md:max-w-152">
      <div className="flex flex-col gap-y-4">
        <header className="flex flex-col gap-y-1.5">
          <h1>Lab JM</h1>

          <p>
            Place to experiment.{' '}
            <a
              href="https://jakubmisilo.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-500 transition-colors duration-125 ease-in-out hover:text-zinc-700"
            >
              <span>My portfolio</span>

              <LuArrowUpRight className="inline-block text-lg" />
            </a>
          </p>
        </header>

        <Suspense fallback={<ApiStatus.Skeleton />}>
          <ApiStatus />
        </Suspense>

        <div className="h-px w-full bg-zinc-200" />

        <section>
          <h2 className="sr-only">Projects</h2>

          <ul className="flex flex-col gap-y-4 pt-2.5">
            {PROJECTS.map(({ title, headline, href, tag }, index) => (
              <li className="flex flex-col gap-y-0.5" key={index}>
                <div className="flex items-center justify-between">
                  {href.startsWith('/') ? (
                    <Link href={href} className="">
                      <span className="text-zinc-800 underline decoration-dotted decoration-[8.5%] underline-offset-[3.5px]">
                        {title}
                      </span>
                      &nbsp;
                      {tag && <span className="text-sm italic">({tag})</span>}
                    </Link>
                  ) : (
                    <a href={href} rel="noopener noreferrer" target="_blank" className="">
                      <span className="text-zinc-800 underline decoration-dotted decoration-[8.5%] underline-offset-[3.5px]">
                        {title}
                      </span>
                      &nbsp;
                      {tag && <span className="text-sm italic">({tag})</span>}
                    </a>
                  )}
                </div>

                <p className="text-sm text-zinc-400">{headline}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
};

export default HomePage;
