"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { GripVertical, RotateCcw } from "lucide-react";
import { Squircle } from "@squircle-js/react";
import {
  WebSearch,
  WebSearchAnswer,
  WebSearchCitation,
  type WebSource,
  type WebSearchStatus,
} from "@/components/ui/web-search";

const favicon = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

const SOURCES: WebSource[] = [
  {
    id: "motion",
    title: "Spring animations: physics based motion for React",
    url: "https://motion.dev/docs/react-transitions",
    snippet:
      "Springs simulate real physics, so motion keeps its velocity when it is interrupted and settles naturally.",
    favicon: favicon("motion.dev"),
  },
  {
    id: "mdn",
    title: "prefers-reduced-motion - CSS media feature",
    url: "https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-motion",
    snippet:
      "Detects if a user has enabled a setting on their device to minimize the amount of non-essential motion.",
    favicon: favicon("developer.mozilla.org"),
  },
  {
    id: "react",
    title: "useEffect: synchronizing with external systems",
    url: "https://react.dev/reference/react/useEffect",
    snippet:
      "useEffect is a React Hook that lets you synchronize a component with an external system.",
    favicon: favicon("react.dev"),
  },
  {
    id: "webdev",
    title: "Animations and performance on the web",
    url: "https://web.dev/articles/animations-and-performance",
    snippet:
      "Animating transform and opacity keeps work on the compositor, so frames stay smooth.",
    favicon: favicon("web.dev"),
  },
  {
    id: "github",
    title: "rare-ui: animated React components",
    url: "https://github.com/swamimalode07/rare-ui",
    favicon: favicon("github.com"),
  },
  {
    id: "vercel",
    title: "Building interfaces that feel fast",
    url: "https://vercel.com/blog",
    favicon: favicon("vercel.com"),
  },
];

const SQUIRCLE = { cornerRadius: 16, cornerSmoothing: 5 } as const;

// a slow network shouldn't hold the demo back for long
const PRELOAD_TIMEOUT = 3000;

const preload = (urls: string[]) =>
  Promise.race([
    Promise.all(
      urls.map(
        (src) =>
          new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = image.onerror = () => resolve();
            image.src = src;
          }),
      ),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, PRELOAD_TIMEOUT)),
  ]);

const ARRIVALS = [600, 1000, 1300, 1800, 2200, 2500];
const FINISH = 2900;

const [motionDev, mdn, react, webDev] = SOURCES;

export default function WebSearchPage() {
  const previewRef = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<WebSearchStatus>("searching");
  const [ready, setReady] = useState(false);

  // the favicons load before the search starts, so each one lands with its icon instead of popping in late
  useEffect(() => {
    let active = true;
    preload(SOURCES.flatMap((source) => source.favicon ?? [])).then(
      () => active && setReady(true),
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timers = [
      ...ARRIVALS.map((at, i) => window.setTimeout(() => setCount(i + 1), at)),
      window.setTimeout(() => setStatus("done"), FINISH),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [run, ready]);

  const replay = () => {
    setCount(0);
    setStatus("searching");
    setRun((n) => n + 1);
  };

  return (
    <div
      ref={previewRef}
      className="relative flex h-full flex-col items-center justify-center p-6 pb-20"
    >
      <div className="flex w-[560px] max-w-full flex-col gap-5">
        <WebSearch
          key={run}
          status={status}
          query="spring animations react"
          sources={SOURCES.slice(0, count)}
          linked={false}
        />

        <WebSearchAnswer key={`answer-${run}`} play={status === "done"}>
          Use a spring for anything the user can interrupt, since it keeps its
          velocity instead of restarting{" "}
          <WebSearchCitation linked={false} source={motionDev} />. Stick to
          transform and opacity so the work stays on the compositor{" "}
          <WebSearchCitation linked={false} source={webDev} />, and turn the
          motion off when the user asks for less{" "}
          <WebSearchCitation linked={false} source={mdn} />. Start the animation
          from an effect, not during render{" "}
          <WebSearchCitation linked={false} source={react} />.
        </WebSearchAnswer>
      </div>

      <Squircle asChild {...SQUIRCLE}>
        <motion.div
          drag
          dragConstraints={previewRef}
          dragMomentum={false}
          dragElastic={0}
          whileDrag={{ scale: 1.03 }}
          className="border-apple absolute inset-x-0 bottom-4 mx-auto flex w-fit items-center gap-1 bg-muted p-1 shadow-xl backdrop-blur"
        >
          <span
            className="cursor-grab pr-0.5 pl-1 text-foreground/30 transition-colors hover:text-foreground/60 active:cursor-grabbing"
            aria-hidden
          >
            <GripVertical className="h-5 w-5" />
          </span>
          <button
            type="button"
            onClick={replay}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-xl bg-background px-3.5 text-xs font-medium text-foreground shadow-sm outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-foreground/30"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Replay
          </button>
        </motion.div>
      </Squircle>
    </div>
  );
}
