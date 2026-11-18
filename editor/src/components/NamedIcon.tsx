// Ícone da interface pelo nome ("keyboard"), para o que vem de dados (o ícone de cada ação). Os das ações do app
// vêm do lucide-react (SVG, traço 1,75, como os outros ícones da interface); um nome que não está na lista (ícone
// de plugin de terceiros) usa o caractere da fonte Lucide, que tem todos. Lista curta de propósito: o mapa de
// todos os ícones do lucide-react pesa ~280 kB.
import {
  AppWindow, ArrowLeft, ArrowRight, AudioLines, Ban, CircleDot, Clapperboard, Code, Command, Eye, EyeOff, Flag, Headphones,
  Hourglass, Keyboard, Layers, LayoutGrid, Lightbulb, ListOrdered, Lock, LogIn, Megaphone, MessageCircle, MessageSquare, Mic,
  MicOff, Monitor, Music, Music2, Paintbrush, PhoneOff, Radio, Rewind, RotateCcw, Settings, Speech, Split, Sun, Terminal,
  TextCursorInput, Timer, ToggleRight, Video, VolumeX, Webhook, type LucideIcon,
} from "lucide-react";
import { Icon, ICON_SIZE, type IconSize } from "@/components/Icon";
import { useLucideIndex } from "@/components/IconPicker";
import { cn } from "@/core/cn";
import { luChar } from "@/core/icons/lucide";

const KNOWN: Record<string, LucideIcon> = {
  "app-window": AppWindow, ban: Ban, "circle-dot": CircleDot, code: Code, command: Command, eye: Eye, flag: Flag,
  headphones: Headphones, keyboard: Keyboard, layers: Layers, "layout-grid": LayoutGrid, "list-ordered": ListOrdered, mic: Mic,
  monitor: Monitor, music: Music, radio: Radio, rewind: Rewind, settings: Settings, split: Split, sun: Sun, terminal: Terminal,
  "text-cursor-input": TextCursorInput, timer: Timer, "toggle-right": ToggleRight, video: Video, "volume-x": VolumeX, webhook: Webhook,
  // as dos plugins que vêm com o app (OBS, Discord, luz, tempo)
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight, "audio-lines": AudioLines, clapperboard: Clapperboard, "eye-off": EyeOff,
  hourglass: Hourglass, lightbulb: Lightbulb, lock: Lock, "log-in": LogIn, megaphone: Megaphone, "message-circle": MessageCircle,
  "message-square": MessageSquare, "mic-off": MicOff, "music-2": Music2, paintbrush: Paintbrush, "phone-off": PhoneOff,
  "rotate-ccw": RotateCcw, speech: Speech,
};

export function NamedIcon({ name, size = "md", className }: { name: string; size?: IconSize; className?: string | undefined }) {
  const idx = useLucideIndex();
  const known = KNOWN[name];
  if (known) return <Icon icon={known} size={size} className={className} />;
  return (
    <span aria-hidden className={cn("grid flex-none place-items-center font-lucide leading-none", ICON_SIZE[size], className)}>
      {idx ? luChar(idx, name) || luChar(idx, "settings") : ""}
    </span>
  );
}
