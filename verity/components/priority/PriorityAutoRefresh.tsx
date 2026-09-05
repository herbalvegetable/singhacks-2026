"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

let priorityLoad: Promise<boolean> | null = null;

async function ensurePriorities(): Promise<boolean> {
  const currentResponse = await fetch("/api/priorities", {
    cache: "no-store",
  });
  if (!currentResponse.ok) {
    throw new Error(`Unable to load priorities (${currentResponse.status})`);
  }
  const current = (await currentResponse.json()) as {
    priorities?: unknown[];
  };
  if ((current.priorities?.length ?? 0) > 0) return true;

  const generationResponse = await fetch("/api/priorities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!generationResponse.ok) {
    throw new Error(
      `Unable to generate priorities (${generationResponse.status})`,
    );
  }
  const generated = (await generationResponse.json()) as {
    priorities?: unknown[];
  };
  return (generated.priorities?.length ?? 0) > 0;
}

export function PriorityAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      priorityLoad ??= ensurePriorities().finally(() => {
        priorityLoad = null;
      });
      try {
        const hasPriorities = await priorityLoad;
        if (!cancelled && hasPriorities) router.refresh();
      } catch (error) {
        console.error("Risk priority refresh failed:", error);
        if (!cancelled) retryTimer = setTimeout(load, 10_000);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [router]);

  return null;
}
