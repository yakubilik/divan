"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { GripVertical, RotateCcw } from "lucide-react";
import { Squircle } from "@squircle-js/react";
import { AiStatus, type AiStatusState } from "@/components/ui/ai-status";

const SQUIRCLE = { cornerRadius: 16, cornerSmoothing: 5 } as const;

// on small screens the command breaks at a space or before a slash, never inside a word
const COMMAND = [
  "npx shadcn@latest",
  "add",
  "swamimalode07",
  "/rare-ui",
  "/ai-status",
];

const STEPS: {
  at: number;
  state: AiStatusState;
  detail?: string;
  favicon?: string;
}[] = [
  { at: 0, state: "thinking" },
  {
    at: 2200,
    state: "researching",
    detail: "rareui.com",
    favicon: "/rareui/logos/Rareui.svg",
  },
  { at: 4600, state: "analyzing", detail: "Reading the registry" },
  { at: 6800, state: "writing" },
  { at: 9000, state: "done" },
];

export default function AiStatusPage() {
  const previewRef = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = STEPS.slice(1).map(({ at }, i) =>
      window.setTimeout(() => setStep(i + 1), at),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [run]);

  const replay = () => {
    setStep(0);
    setRun((n) => n + 1);
  };

  const { state, detail, favicon } = STEPS[step];

  return (
    <div
      ref={previewRef}
      className="relative flex h-full flex-col items-center justify-center p-6 pb-20"
    >
      <div className="flex w-[480px] max-w-full flex-col gap-6 font-runde">
        <p className="ml-auto w-fit max-w-[80%] rounded-[20px] bg-[#F4F4F9] px-4 py-2.5 text-[14px] font-medium text-black dark:bg-[#262626] dark:text-white">
          How do I add a Rare UI component to my project?
        </p>

        <div className="flex min-h-24 flex-col gap-2">
          <AiStatus key={run} state={state} detail={detail} favicon={favicon} />
          <AnimatePresence>
            {state === "done" && (
              <motion.p
                key={run}
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ type: "spring", duration: 0.6, bounce: 0 }}
                className="text-[14px] leading-relaxed text-black dark:text-white"
              >
                Run the shadcn CLI with the component&apos;s name, like{" "}
                <span className="sm:whitespace-nowrap">
                  <code className="box-decoration-clone rounded-md bg-[#F4F4F9] px-1.5 py-0.5 font-mono text-[13px] dark:bg-[#262626]">
                    {COMMAND.map((part, i) => (
                      <Fragment key={part}>
                        {i > 0 && (part.startsWith("/") ? <wbr /> : " ")}
                        <span className="whitespace-nowrap">{part}</span>
                      </Fragment>
                    ))}
                  </code>
                  .
                </span>{" "}
                The source lands in your components folder, so it&apos;s yours
                to tweak.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
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
