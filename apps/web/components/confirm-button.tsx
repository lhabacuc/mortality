"use client";

import type { ButtonHTMLAttributes } from "react";

/** Botão de submissão que pede confirmação antes de uma ação destrutiva. */
export function ConfirmButton({ message, className = "danger sm", children, ...rest }: {
  message: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} type="submit" className={className}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
