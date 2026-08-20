import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ToastItem {
  id: number;
  message: string;
}

type Listener = (items: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let listeners: Listener[] = [];
let nextId = 0;

function emit() {
  listeners.forEach((listener) => listener(toasts));
}

// Minimal, dependency-free toast: a module-level queue plus a single
// <Toaster /> mounted once at the app root (see App.tsx). Call toast()
// from anywhere — no provider/context wiring needed.
export function toast(message: string, duration = 2200) {
  const id = nextId++;
  toasts = [...toasts, { id, message }];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, duration);
}

export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>(toasts);

  React.useEffect(() => {
    listeners.push(setItems);
    return () => {
      listeners = listeners.filter((listener) => listener !== setItems);
    };
  }, []);

  if (typeof document === "undefined" || items.length === 0) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-5 z-[100] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto rounded-full border border-white/10 bg-[#0c1715]/95 px-4 py-2 text-sm text-[#f2f5f3] shadow-[0_12px_24px_rgba(0,0,0,0.35)] backdrop-blur-sm"
          )}
        >
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  );
}
