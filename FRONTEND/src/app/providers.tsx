"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { meKey } from "@/lib/auth/use-me";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    // Any request refused for maintenance re-reads /auth/me at once, which swaps in the maintenance screen.
    const onError = (err: unknown) => {
      if (err instanceof ApiError && err.code === "MAINTENANCE") void client.invalidateQueries({ queryKey: meKey });
    };
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          retry: (count, err) => !(err instanceof ApiError && err.status < 500) && !(err instanceof ApiError && err.code === "MAINTENANCE") && count < 2,
        },
      },
    });
    return client;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
