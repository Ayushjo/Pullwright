import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, ChevronDown, RefreshCw } from "lucide-react";
import type { WalletGuide, WalletKey } from "../../api/client";
import Badge from "../ui/Badge";
import UndoDelete from "../fx/UndoDelete";
import { HandArrow, HandUnderline } from "../hand/Scribbles";
import { PROVIDER_MONO, PROVIDER_TINT } from "./detect";
import { cn } from "../../lib/cn";

const usd = (n: number) =>
  n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2).replace(/\.00$/, "")}`;

function KeyFacts({ k }: { k: WalletKey }) {
  const m = k.meta ?? {};
  const facts: string[] = [];
  if (k.provider === "vercel" && typeof m.usedUsd === "number") {
    // Vercel's `balance` doesn't move as you spend; `total_used` does (measured), so show used of the $5 grant.
    const left = Math.max(0, 5 - m.usedUsd);
    facts.push(`${usd(left)} of $5 free credit left this month`);
  }
  if (k.provider === "openrouter") {
    if (m.freeRequestsToday)
      facts.push(
        `${m.freeRequestsToday.remaining} of ${m.freeRequestsToday.limit} free requests left today`,
      );
    if (typeof m.limitRemainingUsd === "number")
      facts.push(`${usd(m.limitRemainingUsd)} left on this key`);
  }
  if (k.lastUsedAt)
    facts.push(`last used ${new Date(k.lastUsedAt).toLocaleDateString()}`);
  if (!facts.length) return null;
  return (
    <p className="text-xs text-muted-foreground mt-1.5">{facts.join(" · ")}</p>
  );
}

function TierBadge({ k }: { k: WalletKey }) {
  if (k.status === "revoked")
    return (
      <Badge tone="danger" dot>
        Rejected — replace it
      </Badge>
    );
  if (k.status === "out_of_funds")
    return (
      <Badge tone="warning" dot>
        Out of funds
      </Badge>
    );
  if (k.tier === "free")
    return (
      <Badge tone="success" dot>
        Free
      </Badge>
    );
  if (k.tier === "free_credit")
    return (
      <Badge tone="success" dot>
        Free credit
      </Badge>
    );
  if (k.tier === "paid")
    return (
      <Badge tone="primary" dot>
        Paid · used last
      </Badge>
    );
  return <Badge dot>Checked</Badge>;
}

export default function ProviderCard({
  guide,
  saved,
  startHere,
  onAddClick,
  onRecheck,
  onRemove,
}: {
  guide: WalletGuide;
  saved?: WalletKey;
  startHere?: boolean;
  onAddClick: () => void;
  onRecheck: () => Promise<void>;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(Boolean(startHere));
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (startHere) setOpen(true);
  }, [startHere]);
  const pointer = startHere && !saved;

  return (
    <div className={cn("relative", pointer && "pt-12")}>
      {pointer && (
        <div
          className="pointer-events-none absolute top-0 right-3 sm:right-8 flex items-end text-primary select-none"
          aria-hidden
        >
          <span className="font-hand text-xl font-semibold leading-none -mr-1 mb-6 rotate-[-4deg]">
            start here
          </span>
          <HandArrow className="w-14 h-11 -scale-x-100" delay={0.5} />
        </div>
      )}
      <motion.div
        layout
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          layout: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
          duration: 0.25,
        }}
        className={cn(
          "relative rounded-xl border bg-card p-4 transition-shadow",
          saved
            ? "border-border"
            : "border-border hover:shadow-[0_2px_12px_rgba(0,0,0,0.05)]",
          pointer && "border-primary/40 ring-4 ring-primary/5",
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "w-10 h-10 shrink-0 rounded-lg border flex items-center justify-center text-sm font-bold",
              PROVIDER_TINT[guide.id],
            )}
          >
            {PROVIDER_MONO[guide.id]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[15px] font-semibold text-foreground">
                {guide.name}
              </h3>
              {saved ? (
                <TierBadge k={saved} />
              ) : guide.free ? (
                <Badge tone="success">Free · no card</Badge>
              ) : (
                <Badge>Paid</Badge>
              )}
              {saved?.dataPolicy === "trains" && (
                <Badge tone="warning" className="!py-0.5">
                  Public repos only
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{guide.role}</p>
            {saved && (
              <>
                <p className="text-xs font-mono text-foreground/80 mt-1.5">
                  ••••{saved.last4}
                </p>
                <KeyFacts k={saved} />
              </>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {saved ? (
            <>
              <button
                type="button"
                disabled={checking}
                onClick={async () => {
                  setChecking(true);
                  try {
                    await onRecheck();
                  } finally {
                    setChecking(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-button px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-ring disabled:opacity-60"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", checking && "animate-spin")}
                />
                {checking ? "Checking…" : "Check again"}
              </button>
              <span className="ml-auto">
                <UndoDelete onConfirm={onRemove} />
              </span>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="inline-flex items-center gap-1 rounded-button px-2.5 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-muted/70 transition-colors focus-ring"
              >
                How to get one
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-200",
                    open && "rotate-180",
                  )}
                />
              </button>
              <a
                href={guide.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-button px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors focus-ring"
              >
                Open {guide.name.split(" ")[0]}
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </>
          )}
        </div>

        <AnimatePresence initial={false}>
          {!saved && open && (
            <motion.div
              key="steps"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden"
            >
              <ol className="mt-3 space-y-0 border-l border-dashed border-border ml-3.5">
                {guide.steps.map((s, i) => (
                  <motion.li
                    key={s}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 + i * 0.07 }}
                    className="relative pl-6 py-1.5 text-sm text-foreground"
                  >
                    <span className="absolute -left-[11px] top-1.5 w-[22px] h-[22px] rounded-full bg-card border border-border text-[11px] font-semibold text-muted-foreground flex items-center justify-center">
                      {i + 1}
                    </span>
                    {i === guide.steps.length - 1 ? (
                      <button
                        type="button"
                        onClick={onAddClick}
                        className="relative text-left text-primary font-medium hover:underline underline-offset-2 focus-ring rounded"
                      >
                        {s}
                      </button>
                    ) : i === 0 ? (
                      <a
                        href={guide.keyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary"
                      >
                        {s}
                      </a>
                    ) : (
                      s
                    )}
                  </motion.li>
                ))}
              </ol>
              {startHere && (
                <p className="mt-2 ml-1 text-xs text-muted-foreground">
                  Takes about a minute. This one key is{" "}
                  <span className="relative inline-block font-medium text-foreground">
                    all you need
                    <HandUnderline
                      className="text-primary/60"
                      strokeWidth={2.5}
                      delay={0.3}
                    />
                  </span>{" "}
                  to start.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
