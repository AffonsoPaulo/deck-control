// Interruptor (Base UI) com o rótulo ao lado: o .switch / .toggle-row do editor atual (40x24, bolinha de 16).
import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { useId } from "react";
import { cn } from "@/core/cn";

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  hideLabel?: boolean; // só o interruptor (o rótulo vira o nome para o leitor de tela), como nas Automações
}

export function Switch({ label, checked, onChange, disabled, className, hideLabel }: SwitchProps) {
  const id = useId();
  return (
    <div className={cn("flex min-h-7.5 items-center gap-3 text-base font-semibold text-fg-label", className)}>
      {!hideLabel && (
        <label htmlFor={id} className="flex-1 cursor-pointer">
          {label}
        </label>
      )}
      <BaseSwitch.Root
        id={id}
        aria-label={hideLabel ? label : undefined}
        checked={checked}
        onCheckedChange={(on) => onChange(on)}
        disabled={disabled}
        className="relative h-control-xs w-10 flex-none cursor-pointer rounded-full bg-track data-checked:bg-accent data-disabled:cursor-default data-disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <BaseSwitch.Thumb className="absolute top-1 left-1 size-4 rounded-full bg-fg shadow-sm transition-transform duration-(--duration-fast) ease-out data-checked:translate-x-4 data-checked:bg-on-accent" />
      </BaseSwitch.Root>
    </div>
  );
}
