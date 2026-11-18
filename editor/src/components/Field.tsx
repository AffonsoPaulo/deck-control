// Campo com rótulo e dica (o .set-row / .set-label / .hint do editor atual) e o campo de texto (input).
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/core/cn";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
  className?: string;
}

/** Rótulo em cima, o controle e a dica embaixo. `children` recebe o id para ligar o rótulo ao controle. */
export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col items-start gap-2", className)}>
      <label htmlFor={id} className="text-base font-semibold text-fg-label">
        {label}
      </label>
      {children(id)}
      {hint && <p className="m-0 text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-control-lg w-full rounded-md border border-border-strong bg-sunken px-2.75 text-base text-fg outline-none",
        "placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent-ring disabled:opacity-45",
        className,
      )}
      {...rest}
    />
  );
});

/** Texto de várias linhas (o textarea do editor atual), com o mesmo visual do campo. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-md border border-border-strong bg-sunken px-2.75 py-2 text-base leading-(--text-md--line-height) text-fg outline-none",
        "placeholder:text-fg-subtle focus:border-accent focus:ring-3 focus:ring-accent-ring disabled:opacity-45",
        className,
      )}
      {...rest}
    />
  );
});
