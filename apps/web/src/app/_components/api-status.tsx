import { apiClient } from "@/infrastructure/api";
import { Skeleton } from "@/ui/skeleton";

export const ApiStatus = async () => {
  const apiStatus = await getApiStatus();

  return <div>API Status: {apiStatus}</div>;
};

const ApiStatusSkeleton = () => {
  return (
    <div className="flex items-center gap-x-[0.5ch]">
      <span>API Status:</span> <Skeleton className="h-4.5 w-12  inline-block" />
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
