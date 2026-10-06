import { AlertTriangle, Bot, CheckCircle2, XCircle } from "lucide-react";
import type * as React from "react";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "./toast.js";
import { useToast } from "./use-toast.js";

const variantIcons: Record<string, React.ReactNode> = {
  success: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />,
  warning: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />,
  destructive: <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />,
  agent: <Bot className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />,
};

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} {...props}>
          <div className="flex items-start gap-3">
            {props.variant ? variantIcons[props.variant] : null}
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
