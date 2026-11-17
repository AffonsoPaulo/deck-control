// Onde o aviso aparece (fica sempre montado: role=status avisa o leitor de tela quando o texto muda).
import { Icon } from "@/components/Icon";
import { cn } from "@/core/cn";
import { hideToast, pauseToast, resumeToast, useToast } from "@/core/toast";

export function Toaster() {
  const { current: item, leaving } = useToast();
  return (
    <div role="status" className="pointer-events-none fixed inset-x-4 bottom-6 z-(--z-toast) flex justify-center">
      {item && (
        <div
          key={item.id}
          data-leaving={leaving || undefined}
          onMouseEnter={pauseToast}
          onMouseLeave={resumeToast}
          className={cn(
            "group pointer-events-auto relative flex max-w-145 items-center gap-3.5 rounded-lg py-2.5 pr-3 pl-4 font-medium shadow-popover",
            item.bad ? "bg-danger-solid text-on-danger" : "bg-selected text-fg",
            item.long && "overflow-hidden",
            "data-leaving:translate-y-2 data-leaving:opacity-0",
            "motion-safe:transition motion-safe:duration-(--duration-slow) motion-safe:ease-out motion-safe:starting:translate-y-2.5 motion-safe:starting:opacity-0",
            "motion-safe:data-leaving:duration-(--duration-base) motion-safe:data-leaving:ease-in",
          )}
        >
          <span>{item.msg}</span>
          {item.buttons.map((b) => (
            <button
              key={b.label}
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-tint-line px-2.5 py-1.25 font-semibold text-fg focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => {
                hideToast();
                b.run();
              }}
            >
              {b.icon && <Icon icon={b.icon} size="sm" />}
              {b.label}
            </button>
          ))}
          {item.long && !item.sticky && (
            <i
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-0.75 origin-left animate-toast-time bg-fg-subtle group-hover:paused motion-reduce:hidden"
              style={{ animationDuration: `${item.ms}ms` }}
            />
          )}
        </div>
      )}
    </div>
  );
}
