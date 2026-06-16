import { connection } from "next/server";
import { Skeleton } from "./skeleton";

export const Footer = async () => {
  await connection();

  return (
    <footer className="text-sm text-zinc-400 flex items-center gap-x-[0.5ch]">
      <span>© Jakub Misiło</span> <span>{new Date().getFullYear()}</span>
    </footer>
  );
};

const FooterSkeleton = () => {
  return (
    <footer className="text-sm text-zinc-400 flex items-center gap-x-[0.5ch]">
      <span>© Jakub Misiło</span>{" "}
      <Skeleton className="h-4.5 w-10 inline-block" />
    </footer>
  );
};

Footer.Skeleton = FooterSkeleton;
