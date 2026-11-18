// Aviso embaixo da tela (o toast() do editor atual): um por vez, o novo troca o anterior.
// Some sozinho (menos o fixo): 2,6 s; com erro ou botão, 6 s; o longo (algo grande apagado), 10 s com a
// barrinha do tempo. Com o mouse em cima o tempo para e, ao sair, volta com pelo menos 1,5 s.
import type { LucideIcon } from "lucide-react";
import { create } from "zustand";

export interface ToastButton {
  label: string;
  icon?: LucideIcon;
  run: () => void;
}

export interface ToastItem {
  id: number;
  msg: string;
  bad: boolean;
  long: boolean;
  sticky: boolean;
  ms: number;
  buttons: ToastButton[];
}

export interface ToastOptions {
  bad?: boolean;
  /** Botão "Desfazer" (quem mostra passa a ação, para este módulo não depender do config). */
  undo?: ToastButton;
  action?: ToastButton;
  sticky?: boolean;
  long?: boolean;
}

interface ToastStore {
  current: ToastItem | null;
  leaving: boolean;
}

export const useToast = create<ToastStore>()(() => ({ current: null, leaving: false }));

const LEAVE_MS = 160; // --duration-base
let timer: ReturnType<typeof setTimeout> | undefined;
let left = 0;
let started = 0;
let seq = 0;

function arm(ms: number) {
  clearTimeout(timer);
  left = ms;
  started = Date.now();
  timer = setTimeout(hideToast, ms);
}

export function toast(msg: string, { bad = false, undo, action, sticky = false, long = false }: ToastOptions = {}): void {
  const buttons = [action, undo].filter((b): b is ToastButton => b !== undefined);
  const ms = long ? 10000 : bad || buttons.length ? 6000 : 2600;
  clearTimeout(timer);
  left = 0;
  useToast.setState({ current: { id: ++seq, msg, bad, long, sticky, ms, buttons }, leaving: false });
  if (!sticky) arm(ms);
}

export function hideToast(): void {
  clearTimeout(timer);
  left = 0;
  const { current, leaving } = useToast.getState();
  if (!current || leaving) return;
  const id = current.id;
  useToast.setState({ leaving: true });
  setTimeout(() => {
    if (useToast.getState().current?.id === id) useToast.setState({ current: null, leaving: false });
  }, LEAVE_MS);
}

/** Mouse entrou: o tempo para. */
export function pauseToast(): void {
  if (left > 0) {
    clearTimeout(timer);
    left -= Date.now() - started;
  }
}

/** Mouse saiu: o tempo volta (com pelo menos 1,5 s). */
export function resumeToast(): void {
  if (left > 0) arm(Math.max(left, 1500));
}
