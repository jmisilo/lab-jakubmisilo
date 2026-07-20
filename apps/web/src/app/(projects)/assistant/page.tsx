import Image from 'next/image';

export default function AssistantPage() {
  return (
    <>
      <div className="flex flex-col gap-y-5">
        <div className="flex h-full w-full flex-col justify-center gap-y-3">
          <h1>Personal Assistant</h1>

          <p>
            Personal AI Agent, powered by AI SDK & Chat SDK, with custom context management layer &{' '}
            <a
              href="https://x.com/misilo_jakub/status/2077402569312186725?s=20"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-zinc-950 underline decoration-dotted decoration-[8.5%] underline-offset-[3.5px]"
            >
              knowledge tree
            </a>{' '}
            solution. Built-in functionalities like tasks scheduling, noting, and calendar
            management allow me to run big chunk of my operations from the agent itself. It lives in
            my{' '}
            <a
              href="https://imessage-sdk.dev"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-zinc-950 underline decoration-dotted decoration-[8.5%] underline-offset-[3.5px]"
            >
              iMessage
            </a>
            , powered by my{' '}
            <a
              href="https://imessage-sdk.dev"
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-zinc-950 underline decoration-dotted decoration-[8.5%] underline-offset-[3.5px]"
            >
              own iMessage SDK
            </a>
            .
          </p>
        </div>

        <div className="flex flex-col gap-y-5">
          <div className="grid gap-2 min-[460px]:grid-cols-2">
            <Image
              src="https://landing-storage.knmstudio.com/portfolio/lab/wc-tracking.PNG"
              alt="agent conversation preview"
              className="h-auto w-full"
              loading="lazy"
              width={1206}
              height={2622}
            />

            <Image
              src="https://landing-storage.knmstudio.com/portfolio/lab/personal-ai-agent.PNG"
              alt="agent conversation preview"
              className="h-auto w-full"
              loading="lazy"
              width={1206}
              height={2622}
            />
          </div>

          <p className="mb-0! text-center text-sm text-zinc-400 italic">
            Conversations preview. I switched to iMessage then 😉
          </p>
        </div>
      </div>
    </>
  );
}
