"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { parseServerDate } from "@/features/teacher/api";
import { INTEGRITY_QUOTES } from "@/lib/integrity-quotes";

interface DetectionProgressProps {
  status?: string | null;
  createdAt?: string | null;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function DetectionProgress({ status, createdAt }: DetectionProgressProps) {
  const localStart = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (INTEGRITY_QUOTES.length > 0) {
      setQuoteIndex(Math.floor(Math.random() * INTEGRITY_QUOTES.length));
    }

    const quoteInterval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % INTEGRITY_QUOTES.length);
    }, 5000);

    return () => clearInterval(quoteInterval);
  }, []);

  const serverTime = parseServerDate(createdAt)?.getTime();
  let startMs = serverTime ?? localStart.current;
  if (serverTime !== undefined && (serverTime > now || now - serverTime > SIX_HOURS_MS)) {
    startMs = localStart.current;
  }

  const elapsedSec = Math.max(0, Math.floor((now - startMs) / 1000));
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const formattedTime = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const isStarting = (status ?? "").toLowerCase() === "starting";
  const statusText = isStarting
    ? "Starting the plagiarism check..."
    : "Analysing submissions...";

  const currentQuote = INTEGRITY_QUOTES[quoteIndex] ?? INTEGRITY_QUOTES[0];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-4">
        <div
          role="status"
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600 motion-reduce:animate-none dark:text-blue-400 shrink-0" />
            <span className="text-base font-semibold text-slate-900 dark:text-white">
              {statusText}
            </span>
          </div>
          <span className="text-sm font-medium tabular-nums text-slate-500 dark:text-slate-400">
            Elapsed: {formattedTime}
          </span>
        </div>

        {elapsedSec >= 180 && (
          <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3">
            Still working. Larger classes take longer. You can leave this page and come back to this assignment; the result will open when it is ready.
          </p>
        )}

        <div
          aria-live="off"
          className="border-t border-slate-100 dark:border-slate-800 pt-3"
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
            Integrity tip
          </p>
          <p
            key={quoteIndex}
            className="italic text-sm text-slate-600 dark:text-slate-300 transition-opacity duration-500 motion-reduce:transition-none"
          >
            &ldquo;{currentQuote}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

export default DetectionProgress;
