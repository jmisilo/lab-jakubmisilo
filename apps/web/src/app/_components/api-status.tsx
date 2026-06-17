import { apiClient } from "@/infrastructure/api";
import { Skeleton } from "@/ui/skeleton";
import { cn } from "@labjm/utilities";

export const ApiStatus = async () => {
  const apiStatus = await getApiStatus();

  return (
    <div className="flex items-center gap-x-[0.5ch] text-sm">
      <span>API Status:</span>
      <div
        className={cn("inline-block size-2 rounded-full", {
          "bg-[#52B371]": apiStatus === "ok",
          "bg-red-500": apiStatus === "failed",
        })}
      ></div>
    </div>
  );
};

const ApiStatusSkeleton = () => {
  return (
    <div className="flex items-center gap-x-[0.5ch] text-sm">
      <span>API Status:</span>

      <Skeleton className="size-2! rounded-full! inline-block" />
    </div>
  );
};

ApiStatus.Skeleton = ApiStatusSkeleton;

const getApiStatus = async (): Promise<"failed" | "ok"> => {
  try {
    const response = await apiClient.health.$get();

    if (!response.ok) {
      return "failed";
    }

    const data = await response.json();

    return data.status === "ok" ? "ok" : "failed";
  } catch {
    return "failed";
  }
};
